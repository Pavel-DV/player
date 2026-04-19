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

async function analyzePeakWithWebAudio(file) {
  try {
    const audioContext = new window.AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await new Promise((resolve, reject) =>
      audioContext.decodeAudioData(arrayBuffer, resolve, reject)
    );
    const peak = analyzePeak(audioBuffer);

    try {
      await audioContext.close();
    } catch (error) {
      console.warn('Failed to close analysis audio context:', error);
    }

    return peak;
  } catch (error) {
    console.error('Failed to analyze peak with Web Audio:', error);
    return null;
  }
}

export function createNormalizationService({
  lookupFileByKey,
  loadNormInfo,
  saveNormInfo,
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

      if (typeof cachedPeak === 'number' && cachedPeak > 0) {
        continue;
      }

      const file = lookupFileByKey(trackKey);

      if (!file) {
        console.warn(`Skipping normalization analysis for missing file "${trackKey}"`);
        continue;
      }

      const peak = await analyzePeakWithWebAudio(file);

      if (typeof peak === 'number' && peak > 0) {
        saveNormInfo(trackKey, peak);
        onTrackAnalyzed?.(trackKey, peak);
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
