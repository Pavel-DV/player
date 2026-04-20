function analyzePeak(audioBuffer) {
  let peak = 0;

  for (
    let channelIndex = 0;
    channelIndex < audioBuffer.numberOfChannels;
    channelIndex += 1
  ) {
    const channelData = audioBuffer.getChannelData(channelIndex);

    for (let sampleIndex = 0; sampleIndex < channelData.length; sampleIndex += 1) {
      const absoluteSample = Math.abs(channelData[sampleIndex]);
      if (absoluteSample > peak) {
        peak = absoluteSample;
      }
    }
  }

  return peak;
}

const SILENCE_THRESHOLD = 0.0025;
const MIN_NON_SILENT_DURATION_SECONDS = 0.02;
const MIN_AUTO_START_OFFSET_SECONDS = 0.05;

function analyzeLeadingStartOffset(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const minConsecutiveSamples = Math.max(
    1,
    Math.floor(sampleRate * MIN_NON_SILENT_DURATION_SECONDS)
  );
  const totalSamples = audioBuffer.length;
  const channelDataByIndex = [];
  let consecutiveSamples = 0;

  for (
    let channelIndex = 0;
    channelIndex < audioBuffer.numberOfChannels;
    channelIndex += 1
  ) {
    channelDataByIndex.push(audioBuffer.getChannelData(channelIndex));
  }

  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    let maxAbsoluteSample = 0;

    for (
      let channelIndex = 0;
      channelIndex < channelDataByIndex.length;
      channelIndex += 1
    ) {
      const absoluteSample = Math.abs(channelDataByIndex[channelIndex][sampleIndex]);

      if (absoluteSample > maxAbsoluteSample) {
        maxAbsoluteSample = absoluteSample;
      }
    }

    if (maxAbsoluteSample >= SILENCE_THRESHOLD) {
      consecutiveSamples += 1;

      if (consecutiveSamples >= minConsecutiveSamples) {
        const startSampleIndex = sampleIndex - consecutiveSamples + 1;
        return Math.max(0, startSampleIndex / sampleRate);
      }
    } else {
      consecutiveSamples = 0;
    }
  }

  return 0;
}

async function analyzeTrackWithWebAudio(file) {
  try {
    const AnalysisAudioContext = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AnalysisAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await new Promise((resolve, reject) =>
      audioContext.decodeAudioData(arrayBuffer, resolve, reject)
    );
    const peak = analyzePeak(audioBuffer);
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
  loadTrackStartTime,
  saveNormInfo,
  saveTrackStartTime,
  onTrackAnalyzed,
}) {
  const analysisQueue = [];
  let isAnalyzing = false;

  async function processAnalysisQueue() {
    if (isAnalyzing || analysisQueue.length === 0) {
      return;
    }

    isAnalyzing = true;

    while (analysisQueue.length > 0) {
      const trackKey = analysisQueue.shift();
      const cachedPeak = loadNormInfo(trackKey);
      const existingStartOffset = loadTrackStartTime(trackKey);

      if (typeof cachedPeak === 'number' && cachedPeak > 0) {
        continue;
      }

      const file = lookupFileByKey(trackKey);

      if (!file) {
        console.warn(`Skipping normalization analysis for missing file "${trackKey}"`);
        continue;
      }

      const analysisResult = await analyzeTrackWithWebAudio(file);

      if (typeof analysisResult?.peak === 'number' && analysisResult.peak > 0) {
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

      const cachedPeak = loadNormInfo(trackKey);
      return (
        !(typeof cachedPeak === 'number' && cachedPeak > 0) &&
        !analysisQueue.includes(trackKey)
      );
    });

    analysisQueue.push(...pendingKeys);
    void processAnalysisQueue();
  }

  return {
    queueTracksForAnalysis,
  };
}
