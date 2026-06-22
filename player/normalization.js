const TARGET_LOUDNESS_LUFS = -14;
const TRUE_PEAK_CEILING_DBTP = -1;

function createBiquad(type, sampleRate, frequency, q, gain = 0) {
  const a = 10 ** (gain / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha =
    type === 'highshelf'
      ? (Math.sin(omega) / 2) * Math.sqrt((a + 1 / a) * (1 / q - 1) + 2)
      : Math.sin(omega) / (2 * q);
  const beta = 2 * Math.sqrt(a) * alpha;
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;

  if (type === 'highshelf') {
    b0 = a * ((a + 1) + (a - 1) * cosine + beta);
    b1 = -2 * a * ((a - 1) + (a + 1) * cosine);
    b2 = a * ((a + 1) + (a - 1) * cosine - beta);
    a0 = (a + 1) - (a - 1) * cosine + beta;
    a1 = 2 * ((a - 1) - (a + 1) * cosine);
    a2 = (a + 1) - (a - 1) * cosine - beta;
  } else {
    b0 = (1 + cosine) / 2;
    b1 = -(1 + cosine);
    b2 = b0;
    a0 = 1 + alpha;
    a1 = -2 * cosine;
    a2 = 1 - alpha;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function filterSample(sample, filter, state) {
  const output =
    filter.b0 * sample + filter.b1 * state.x1 + filter.b2 * state.x2 -
    filter.a1 * state.y1 - filter.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = sample;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

export function analyzeNormalization(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const shelf = createBiquad(
    'highshelf',
    sampleRate,
    1681.974450955533,
    0.7071752369554196,
    3.999843853973347
  );
  const highpass = createBiquad(
    'highpass',
    sampleRate,
    38.13547087602444,
    0.5003270373238773
  );
  const channelData = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channelIndex) => audioBuffer.getChannelData(channelIndex)
  );
  const states = channelData.map(() => [
    { x1: 0, x2: 0, y1: 0, y2: 0 },
    { x1: 0, x2: 0, y1: 0, y2: 0 },
  ]);
  const windowSamples = Math.round(sampleRate * 0.4);
  const hopSamples = Math.round(sampleRate * 0.1);
  const energyWindow = new Float64Array(windowSamples);
  const blockEnergies = [];
  let windowEnergy = 0;
  let truePeak = 0;

  for (let sampleIndex = 0; sampleIndex < audioBuffer.length; sampleIndex += 1) {
    let sampleEnergy = 0;

    for (let channelIndex = 0; channelIndex < channelData.length; channelIndex += 1) {
      const samples = channelData[channelIndex];
      const filtered = filterSample(
        filterSample(samples[sampleIndex], shelf, states[channelIndex][0]),
        highpass,
        states[channelIndex][1]
      );
      sampleEnergy += filtered * filtered;

      const p0 = samples[Math.max(0, sampleIndex - 1)];
      const p1 = samples[sampleIndex];
      const p2 = samples[Math.min(samples.length - 1, sampleIndex + 1)];
      const p3 = samples[Math.min(samples.length - 1, sampleIndex + 2)];

      for (let quarter = 0; quarter < 4; quarter += 1) {
        const t = quarter / 4;
        const interpolated =
          p1 +
          0.5 * t *
            (p2 - p0 +
              t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
        truePeak = Math.max(truePeak, Math.abs(interpolated));
      }
    }

    const windowIndex = sampleIndex % windowSamples;
    windowEnergy += sampleEnergy - energyWindow[windowIndex];
    energyWindow[windowIndex] = sampleEnergy;

    if (sampleIndex + 1 >= windowSamples && (sampleIndex + 1 - windowSamples) % hopSamples === 0) {
      blockEnergies.push(windowEnergy / windowSamples);
    }
  }

  const absoluteGated = blockEnergies.filter(
    energy => -0.691 + 10 * Math.log10(energy) >= -70
  );
  const averageEnergy =
    absoluteGated.reduce((sum, energy) => sum + energy, 0) / absoluteGated.length;
  const relativeGate = -0.691 + 10 * Math.log10(averageEnergy) - 10;
  const gated = absoluteGated.filter(
    energy => -0.691 + 10 * Math.log10(energy) >= relativeGate
  );
  const gatedEnergy = gated.reduce((sum, energy) => sum + energy, 0) / gated.length;
  const loudness = -0.691 + 10 * Math.log10(gatedEnergy);
  const loudnessGain = 10 ** ((TARGET_LOUDNESS_LUFS - loudness) / 20);
  const peakGain = 10 ** (TRUE_PEAK_CEILING_DBTP / 20) / truePeak;
  const gain = Math.min(loudnessGain, peakGain, 10);

  return Number.isFinite(gain) ? 1 / gain : null;
}

const SILENCE_THRESHOLD = 0.0025;
const MIN_NON_SILENT_DURATION_SECONDS = 0.02;
const START_DETECTION_WINDOW_SECONDS = 0.005;
const MIN_AUTO_START_OFFSET_SECONDS = 0.05;

function analyzeLeadingStartOffset(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const minConsecutiveSamples = Math.max(
    1,
    Math.floor(sampleRate * MIN_NON_SILENT_DURATION_SECONDS)
  );
  const windowSamples = Math.max(
    1,
    Math.floor(sampleRate * START_DETECTION_WINDOW_SECONDS)
  );
  const totalSamples = audioBuffer.length;
  const channelDataByIndex = [];
  let consecutiveSamples = 0;
  let startSampleIndex = 0;

  for (
    let channelIndex = 0;
    channelIndex < audioBuffer.numberOfChannels;
    channelIndex += 1
  ) {
    channelDataByIndex.push(audioBuffer.getChannelData(channelIndex));
  }

  for (
    let sampleIndex = 0;
    sampleIndex < totalSamples;
    sampleIndex += windowSamples
  ) {
    const endSampleIndex = Math.min(totalSamples, sampleIndex + windowSamples);
    let maxAbsoluteSample = 0;

    for (
      let channelIndex = 0;
      channelIndex < channelDataByIndex.length;
      channelIndex += 1
    ) {
      const channelData = channelDataByIndex[channelIndex];

      for (
        let windowSampleIndex = sampleIndex;
        windowSampleIndex < endSampleIndex;
        windowSampleIndex += 1
      ) {
        const absoluteSample = Math.abs(channelData[windowSampleIndex]);

        if (absoluteSample > maxAbsoluteSample) {
          maxAbsoluteSample = absoluteSample;
        }
      }
    }

    if (maxAbsoluteSample >= SILENCE_THRESHOLD) {
      if (consecutiveSamples === 0) {
        startSampleIndex = sampleIndex;
      }

      consecutiveSamples += endSampleIndex - sampleIndex;

      if (consecutiveSamples >= minConsecutiveSamples) {
        return Math.max(0, startSampleIndex / sampleRate);
      }
    } else {
      consecutiveSamples = 0;
    }
  }

  return 0;
}

async function analyzeTrackWithWebAudio(file, analyzeGain = true) {
  try {
    const AnalysisAudioContext = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AnalysisAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await new Promise((resolve, reject) =>
      audioContext.decodeAudioData(arrayBuffer, resolve, reject)
    );
    const peak = analyzeGain ? analyzeNormalization(audioBuffer) : null;
    const startOffset = analyzeLeadingStartOffset(audioBuffer);

    try {
      await audioContext.close();
    } catch (error) {
      console.warn('Failed to close analysis audio context:', error);
    }

    return {
      peak,
      startOffset,
    };
  } catch (error) {
    console.error('Failed to analyze peak with Web Audio:', error);
    return null;
  }
}

export function createNormalizationService({
  lookupFileByKey,
  loadNormInfo,
  loadTrackGain,
  loadTrackStartTime,
  saveNormInfo,
  saveTrackStartTime,
  onTrackAnalyzed,
}) {
  const analysisQueue = [];
  let isAnalyzing = false;

  function needsNormalization(trackKey) {
    return !(loadNormInfo(trackKey) > 0) && loadTrackGain(trackKey) === null;
  }

  async function processAnalysisQueue() {
    if (isAnalyzing || analysisQueue.length === 0) {
      return;
    }

    isAnalyzing = true;

    while (analysisQueue.length > 0) {
      const trackKey = analysisQueue.shift();
      if (!needsNormalization(trackKey)) {
        continue;
      }

      const existingStartOffset = loadTrackStartTime(trackKey);

      const file = lookupFileByKey(trackKey);

      if (!file) {
        console.warn(`Skipping normalization analysis for missing file "${trackKey}"`);
        continue;
      }

      const analysisResult = await analyzeTrackWithWebAudio(file);

      if (
        needsNormalization(trackKey) &&
        analysisResult?.peak > 0
      ) {
        saveNormInfo(trackKey, analysisResult.peak);
      }

      const shouldAutoSetStartOffset =
        !(existingStartOffset > 0) &&
        Number.isFinite(analysisResult?.startOffset) &&
        analysisResult.startOffset >= MIN_AUTO_START_OFFSET_SECONDS;

      if (shouldAutoSetStartOffset) {
        saveTrackStartTime(trackKey, analysisResult.startOffset);
      }

      if (
        (typeof analysisResult?.peak === 'number' && analysisResult.peak > 0) ||
        shouldAutoSetStartOffset
      ) {
        onTrackAnalyzed?.(
          trackKey,
          analysisResult?.peak ?? null,
          shouldAutoSetStartOffset ? analysisResult.startOffset : 0
        );
      }
    }

    isAnalyzing = false;

    if (analysisQueue.length > 0) {
      void processAnalysisQueue();
    }
  }

  function queueTracksForAnalysis(trackKeys) {
    const pendingKeys = trackKeys.filter(trackKey => {
      if (!trackKey) {
        return false;
      }

      return needsNormalization(trackKey) && !analysisQueue.includes(trackKey);
    });

    analysisQueue.push(...pendingKeys);
    void processAnalysisQueue();
  }

  async function reanalyzeTrack(trackKey) {
    if (!trackKey) {
      return null;
    }

    const file = lookupFileByKey(trackKey);

    if (!file) {
      console.warn(`Skipping normalization reanalysis for missing file "${trackKey}"`);
      return null;
    }

    const analysisResult = await analyzeTrackWithWebAudio(
      file,
      needsNormalization(trackKey)
    );

    if (analysisResult?.peak > 0) {
      saveNormInfo(trackKey, analysisResult.peak);
    }

    const nextStartOffset =
      Number.isFinite(analysisResult?.startOffset) &&
      analysisResult.startOffset >= MIN_AUTO_START_OFFSET_SECONDS
        ? analysisResult.startOffset
        : 0;

    saveTrackStartTime(trackKey, nextStartOffset);
    onTrackAnalyzed?.(
      trackKey,
      analysisResult?.peak ?? null,
      nextStartOffset
    );

    return {
      peak: analysisResult?.peak ?? null,
      startOffset: nextStartOffset,
    };
  }

  return {
    queueTracksForAnalysis,
    reanalyzeTrack,
  };
}
