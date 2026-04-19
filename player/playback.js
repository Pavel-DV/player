import {
  RESUME_DELAY_MS,
  buildDefaultArtwork,
  setFileKey,
} from './shared.js';

function setMediaSessionPlaybackState(state) {
  if (!('mediaSession' in navigator)) {
    return;
  }

  try {
    navigator.mediaSession.playbackState = state;
  } catch (error) {
    console.error('Failed to update Media Session playback state:', error);
  }
}

export function createPlaybackController({
  state,
  dom,
  navigation,
  ui,
  getFileKey,
  getDisplayName,
  getQueueIndices,
  loadNormInfo,
  saveNormInfo,
  saveSettings,
  savePlayerState,
}) {
  let lastTimeupdateTraceAt = 0;
  let currentSourceIsNormalized = false;
  let currentSourceTrackKey = null;
  let cachedNormalizedBlob = null;
  let cachedNormalizedTrackKey = null;

  function summarizeError(error) {
    if (!error) {
      return null;
    }

    return {
      code: error.code ?? null,
      message: error.message ?? String(error),
      name: error.name ?? 'Error',
    };
  }

  function tracePlayback(event, details = {}, { throttleTimeupdate = false } = {}) {
    const now = Date.now();

    if (throttleTimeupdate) {
      if (now - lastTimeupdateTraceAt < 1000) {
        return;
      }

      lastTimeupdateTraceAt = now;
    }

    if (Object.keys(details).length > 0) {
      console.log(`[player] ${event} ${JSON.stringify(details)}`);
      return;
    }

    console.log(`[player] ${event}`);
  }

  tracePlayback('controller.created', {
    buildId: window.__playerBuildId ?? null,
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  });

  function ensurePlaybackAudioSession(reason = 'unknown') {
    if (!('audioSession' in navigator) || !navigator.audioSession) {
      tracePlayback('audioSession.unavailable', { reason });
      return;
    }

    try {
      if (navigator.audioSession.type !== 'playback') {
        navigator.audioSession.type = 'playback';
      }

      tracePlayback('audioSession.type.ready', {
        reason,
        type: navigator.audioSession.type,
      });
    } catch (error) {
      console.error('Failed to configure audio session:', error);
      tracePlayback('audioSession.type.failed', {
        error: summarizeError(error),
        reason,
      });
    }
  }

  ensurePlaybackAudioSession('controller.created');

  function refreshAudioElementLayout() {
    if (!dom.audioElement) {
      return;
    }

    dom.audioElement.style.visibility = 'hidden';

    window.requestAnimationFrame(() => {
      dom.audioElement.style.visibility = '';
    });
  }

  function syncMediaSession(reason = 'unknown') {
    if (!('mediaSession' in navigator) || !dom.audioElement) {
      tracePlayback('mediaSession.sync.skipped', {
        hasAudioElement: Boolean(dom.audioElement),
        hasMediaSession: 'mediaSession' in navigator,
        reason,
      });
      return;
    }

    const traceOptions = {
      throttleTimeupdate: reason === 'timeupdate',
    };
    const duration =
      Number.isFinite(dom.audioElement.duration) && dom.audioElement.duration > 0
        ? dom.audioElement.duration
        : 0;
    const position =
      Number.isFinite(dom.audioElement.currentTime) &&
      dom.audioElement.currentTime >= 0
        ? dom.audioElement.currentTime
        : 0;
    const playbackRate = dom.audioElement.playbackRate || 1;

    try {
      if (duration > 0 && typeof navigator.mediaSession.setPositionState === 'function') {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, duration),
          playbackRate: Math.max(0.1, playbackRate),
          position: Math.min(position, duration),
        });

        tracePlayback('mediaSession.position.updated', {
          duration: Number(duration.toFixed(3)),
          playbackRate,
          position: Number(Math.min(position, duration).toFixed(3)),
          reason,
        }, traceOptions);
      } else {
        tracePlayback('mediaSession.position.skipped', {
          duration: Number.isFinite(duration) ? Number(duration.toFixed(3)) : null,
          hasSetPositionState:
            typeof navigator.mediaSession.setPositionState === 'function',
          reason,
        }, traceOptions);
      }
    } catch (error) {
      console.error('Failed to sync Media Session position state:', error);
      tracePlayback('mediaSession.position.failed', {
        error: summarizeError(error),
        reason,
      }, traceOptions);
    }

    try {
      navigator.mediaSession.playbackState = dom.audioElement.paused
        ? 'paused'
        : 'playing';
      tracePlayback('mediaSession.playbackState.updated', {
        playbackState: navigator.mediaSession.playbackState,
        reason,
      }, traceOptions);
    } catch (error) {
      console.error('Failed to sync Media Session playback state:', error);
      tracePlayback('mediaSession.playbackState.failed', {
        error: summarizeError(error),
        reason,
      }, traceOptions);
    }
  }

  function syncMediaMetadata(file, metadata, playlistName, source = 'unknown') {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      tracePlayback('mediaSession.metadata.skipped', {
        hasMediaMetadata: typeof MediaMetadata !== 'undefined',
        hasMediaSession: 'mediaSession' in navigator,
        source,
      });
      return;
    }

    if (!file) {
      navigator.mediaSession.metadata = null;
      state.mediaSessionSignature = null;
      tracePlayback('mediaSession.metadata.cleared', { source });
      return;
    }

    const trackKey = getFileKey(file);
    const artworkSource = metadata.artwork || buildDefaultArtwork();
    const mediaMetadataPayload = {
      album: playlistName,
      artist: metadata.artist || playlistName,
      artwork: [
        {
          src: artworkSource,
          sizes: '512x512',
          type: metadata.artwork ? 'image/jpeg' : 'image/svg+xml',
        },
      ],
      title: metadata.title || getDisplayName(trackKey),
    };
    const mediaSessionSignature = JSON.stringify({
      trackKey,
      title: mediaMetadataPayload.title,
      artist: mediaMetadataPayload.artist,
      album: mediaMetadataPayload.album,
      artworkSource,
    });

    if (state.mediaSessionSignature === mediaSessionSignature) {
      tracePlayback('mediaSession.metadata.unchanged', {
        source,
        trackKey,
      });
      return;
    }

    state.mediaSessionSignature = mediaSessionSignature;
    navigator.mediaSession.metadata = new MediaMetadata(mediaMetadataPayload);
    tracePlayback('mediaSession.metadata.updated', {
      artist: mediaMetadataPayload.artist,
      source,
      title: mediaMetadataPayload.title,
      trackKey,
    });
  }

  function getCurrentPlaylistName() {
    return (
      state.playlists.find(playlist => playlist.id === state.currentPlaylistId)?.name ??
      'no playlist'
    );
  }

  function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator) || !dom.audioElement) {
      tracePlayback('mediaSession.handlers.skipped', {
        hasAudioElement: Boolean(dom.audioElement),
        hasMediaSession: 'mediaSession' in navigator,
      });
      return;
    }

    tracePlayback('mediaSession.handlers.setup.begin');

    const safeSetHandler = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
        tracePlayback('mediaSession.handler.registered', { action });
      } catch (error) {
        console.warn(`Media Session action "${action}" is not supported:`, error);
        tracePlayback('mediaSession.handler.failed', {
          action,
          error: summarizeError(error),
        });
      }
    };

    const safeClearHandler = action => {
      try {
        navigator.mediaSession.setActionHandler(action, null);
        tracePlayback('mediaSession.handler.cleared', { action });
      } catch (error) {
        tracePlayback('mediaSession.handler.clear-failed', {
          action,
          error: summarizeError(error),
        });
      }
    };

    safeClearHandler('seekbackward');
    safeClearHandler('seekforward');
    safeClearHandler('skipad');

    safeSetHandler('play', () => {
      tracePlayback('mediaSession.action.play');
      play();
    });

    safeSetHandler('pause', () => {
      tracePlayback('mediaSession.action.pause');
      pause();
    });

    safeSetHandler('previoustrack', () => {
      tracePlayback('mediaSession.action.previoustrack');
      prev();
    });

    safeSetHandler('nexttrack', () => {
      tracePlayback('mediaSession.action.nexttrack');
      next();
    });

    safeSetHandler('stop', () => {
      tracePlayback('mediaSession.action.stop');
      pause();
    });

    safeSetHandler('seekto', event => {
      tracePlayback('mediaSession.action.seekto', {
        fastSeek: event.fastSeek ?? null,
        seekTime:
          typeof event.seekTime === 'number' ? Number(event.seekTime.toFixed(3)) : null,
      });

      if (typeof event.seekTime === 'number') {
        state.offset = Math.max(0, event.seekTime);
        state.pendingStartOffset = null;
        dom.audioElement.currentTime = state.offset;
        syncMediaSession('action.seekto');
      }
    });

    tracePlayback('mediaSession.handlers.setup.end');
  }

  function analyzePeak(audioBuffer) {
    let peak = 0;

    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
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

  function encodeAudioBufferAsWav(audioBuffer) {
    const channelCount = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const sampleCount = audioBuffer.length;
    const bytesPerSample = 2;
    const dataLength = sampleCount * channelCount * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    let offset = 0;

    const writeString = value => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset, value.charCodeAt(index));
        offset += 1;
      }
    };

    const writeUint16 = value => {
      view.setUint16(offset, value, true);
      offset += 2;
    };

    const writeUint32 = value => {
      view.setUint32(offset, value, true);
      offset += 4;
    };

    writeString('RIFF');
    writeUint32(36 + dataLength);
    writeString('WAVE');
    writeString('fmt ');
    writeUint32(16);
    writeUint16(1);
    writeUint16(channelCount);
    writeUint32(sampleRate);
    writeUint32(sampleRate * channelCount * bytesPerSample);
    writeUint16(channelCount * bytesPerSample);
    writeUint16(bytesPerSample * 8);
    writeString('data');
    writeUint32(dataLength);

    const channelData = Array.from({ length: channelCount }, (_, index) =>
      audioBuffer.getChannelData(index)
    );

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channelIndex][sampleIndex]));
        view.setInt16(
          offset,
          sample < 0 ? sample * 0x8000 : sample * 0x7fff,
          true
        );
        offset += bytesPerSample;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function buildPreparedSource(file) {
    const trackKey = getFileKey(file);

    if (!state.normalize) {
      return {
        isNormalized: false,
        source: file,
      };
    }

    if (cachedNormalizedBlob && cachedNormalizedTrackKey === trackKey) {
      return {
        isNormalized: true,
        source: cachedNormalizedBlob,
      };
    }

    const DecodeAudioContext =
      window.AudioContext || window.webkitAudioContext;
    const RenderAudioContext =
      window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decodeAudioContext = new DecodeAudioContext();
    let audioBuffer = null;

    try {
      const arrayBuffer = await file.arrayBuffer();
      audioBuffer = await new Promise((resolve, reject) =>
        decodeAudioContext.decodeAudioData(arrayBuffer, resolve, reject)
      );
    } finally {
      try {
        await decodeAudioContext.close();
      } catch (error) {
        tracePlayback('audioContext.decode.close.failed', {
          error: summarizeError(error),
        });
      }
    }

    let peak = loadNormInfo(trackKey);

    if (!(typeof peak === 'number' && peak > 0)) {
      peak = analyzePeak(audioBuffer);

      if (typeof peak === 'number' && peak > 0) {
        saveNormInfo?.(trackKey, peak);
      }
    }

    const multiplier =
      typeof peak === 'number' && peak > 0 ? Math.min(1 / peak, 10) : 1;

    if (!(multiplier > 1.001)) {
      return {
        isNormalized: false,
        source: file,
      };
    }

    const offlineAudioContext = new RenderAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );
    const sourceNode = offlineAudioContext.createBufferSource();
    const gainNode = offlineAudioContext.createGain();

    sourceNode.buffer = audioBuffer;
    gainNode.gain.value = multiplier;
    sourceNode.connect(gainNode);
    gainNode.connect(offlineAudioContext.destination);
    sourceNode.start(0);

    const renderedAudioBuffer = await offlineAudioContext.startRendering();
    const normalizedBlob = setFileKey(
      encodeAudioBufferAsWav(renderedAudioBuffer),
      trackKey
    );

    cachedNormalizedBlob = normalizedBlob;
    cachedNormalizedTrackKey = trackKey;

    return {
      isNormalized: true,
      source: normalizedBlob,
    };
  }

  function queueObjectUrlForRevoke(objectUrl) {
    if (!objectUrl) {
      return;
    }

    state.objectUrlsPendingRevoke.push(objectUrl);
    tracePlayback('objectUrl.revoke.queued', {
      pending: state.objectUrlsPendingRevoke.length,
    });

    window.setTimeout(() => {
      const pendingIndex = state.objectUrlsPendingRevoke.indexOf(objectUrl);

      if (pendingIndex >= 0) {
        state.objectUrlsPendingRevoke.splice(pendingIndex, 1);
      }

      URL.revokeObjectURL(objectUrl);
      tracePlayback('objectUrl.revoked', {
        pending: state.objectUrlsPendingRevoke.length,
      });
    }, 1500);
  }

  function revokeCurrentObjectUrl() {
    if (state.currentObjectUrl) {
      tracePlayback('objectUrl.current.revoke', {
        hasCurrentObjectUrl: true,
      });
      queueObjectUrlForRevoke(state.currentObjectUrl);
      state.currentObjectUrl = null;
    }

    currentSourceIsNormalized = false;
    currentSourceTrackKey = null;
  }

  function playForSequence(sequenceId, errorLabel) {
    if (!dom.audioElement) {
      return Promise.resolve(false);
    }

    state.pendingPlaySequence = sequenceId;
    tracePlayback('playForSequence.begin', {
      errorLabel,
      sequenceId,
    });

    return dom.audioElement
      .play()
      .then(() => {
        tracePlayback('playForSequence.success', {
          sequenceId,
        });
        return true;
      })
      .catch(error => {
        const isAbortError = error?.name === 'AbortError';
        const isSuperseded = state.pendingPlaySequence !== sequenceId;

        if (!isAbortError || !isSuperseded) {
          console.error(errorLabel, error);
        }

        tracePlayback('playForSequence.failed', {
          error: summarizeError(error),
          errorLabel,
          isAbortError,
          isSuperseded,
          sequenceId,
        });

        return false;
      });
  }

  function playWhenSourceReady(sequenceId, errorLabel) {
    if (!dom.audioElement) {
      return;
    }

    let hasStarted = false;
    tracePlayback('playWhenSourceReady.begin', {
      errorLabel,
      sequenceId,
    });

    const startPlayback = () => {
      if (hasStarted) {
        tracePlayback('playWhenSourceReady.start.skipped', {
          reason: 'already-started',
          sequenceId,
        });
        return;
      }

      hasStarted = true;
      dom.audioElement?.removeEventListener('loadedmetadata', handleReady);
      dom.audioElement?.removeEventListener('canplay', handleReady);

      if (sequenceId !== state.playSequence) {
        tracePlayback('playWhenSourceReady.start.skipped', {
          reason: 'sequence-mismatch',
          sequenceId,
          statePlaySequence: state.playSequence,
        });
        return;
      }

      tracePlayback('playWhenSourceReady.start', {
        sequenceId,
      });
      void playForSequence(sequenceId, errorLabel);
    };

    const handleReady = readyEvent => {
      tracePlayback('playWhenSourceReady.ready', {
        eventType: readyEvent?.type ?? 'unknown',
        sequenceId,
      });
      window.setTimeout(startPlayback, 0);
    };

    if (dom.audioElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
      tracePlayback('playWhenSourceReady.immediate', {
        readyState: dom.audioElement.readyState,
        sequenceId,
      });
      window.setTimeout(startPlayback, 0);
      return;
    }

    dom.audioElement.addEventListener('loadedmetadata', handleReady, {
      once: true,
    });
    dom.audioElement.addEventListener('canplay', handleReady, {
      once: true,
    });
    dom.audioElement.load();
    tracePlayback('playWhenSourceReady.load.called', {
      sequenceId,
    });
    window.setTimeout(() => {
      tracePlayback('playWhenSourceReady.timeout', {
        sequenceId,
      });
      startPlayback();
    }, 250);
  }

  function setAudioSource(
    file,
    { isNormalizedSource = false, markInternalTransition = true } = {}
  ) {
    if (!dom.audioElement) {
      return;
    }

    if (markInternalTransition) {
      state.isInternalTransition = true;
    }

    const previousObjectUrl = state.currentObjectUrl;
    state.currentObjectUrl = URL.createObjectURL(file);
    dom.audioElement.src = state.currentObjectUrl;
    currentSourceIsNormalized = isNormalizedSource;
    currentSourceTrackKey = getFileKey(file);
    tracePlayback('audio.source.set', {
      hadPreviousObjectUrl: Boolean(previousObjectUrl),
      isNormalizedSource,
      markInternalTransition,
      trackKey: getFileKey(file),
    });

    if (previousObjectUrl && previousObjectUrl !== state.currentObjectUrl) {
      queueObjectUrlForRevoke(previousObjectUrl);
    }
  }

  function restoreCurrentTrackSource() {
    const file = state.files[state.index];

    if (!file || !dom.audioElement) {
      return Promise.resolve(false);
    }

    return buildPreparedSource(file)
      .then(({ isNormalized, source }) => {
        setAudioSource(source, { isNormalizedSource: isNormalized });
        state.pendingStartOffset = Number.isFinite(state.offset) ? state.offset : 0;
        tracePlayback('audio.source.restore.success', {
          isNormalizedSource: isNormalized,
          pendingStartOffset: state.pendingStartOffset,
          trackKey: getFileKey(file),
        });
        return true;
      })
      .catch(error => {
        console.error('Failed to restore current track source:', error);
        tracePlayback('audio.source.restore.failed', {
          error: summarizeError(error),
        });
        return false;
      });
  }

  function primeCurrentTrackSource() {
    const file = state.files[state.index];

    if (!file || !dom.audioElement) {
      tracePlayback('audio.source.prime.skipped', {
        hasAudioElement: Boolean(dom.audioElement),
        hasFile: Boolean(file),
        reason: 'missing-target',
      });
      return Promise.resolve(false);
    }

    if (state.isPlaying) {
      tracePlayback('audio.source.prime.skipped', {
        reason: 'already-playing',
        trackKey: getFileKey(file),
      });
      return Promise.resolve(false);
    }

    const hasExistingSource =
      Boolean(dom.audioElement.src) && dom.audioElement.src !== window.location.href;
    const hasMatchingExistingSource =
      hasExistingSource &&
      state.currentObjectUrl &&
      currentSourceTrackKey === getFileKey(file) &&
      currentSourceIsNormalized === state.normalize;

    if (hasMatchingExistingSource) {
      tracePlayback('audio.source.prime.skipped', {
        reason: 'existing-source',
        isNormalizedSource: currentSourceIsNormalized,
        trackKey: getFileKey(file),
      });
      return Promise.resolve(true);
    }

    return buildPreparedSource(file)
      .then(({ isNormalized, source }) => {
        setAudioSource(source, {
          isNormalizedSource: isNormalized,
          markInternalTransition: false,
        });
        state.pendingStartOffset = Number.isFinite(state.offset) ? state.offset : 0;
        state.isInternalTransition = false;
        tracePlayback('audio.source.prime.success', {
          isNormalizedSource: isNormalized,
          pendingStartOffset: state.pendingStartOffset,
          trackKey: getFileKey(file),
        });
        return true;
      })
      .catch(error => {
        console.error('Failed to prime current track source:', error);
        tracePlayback('audio.source.prime.failed', {
          error: summarizeError(error),
        });
        return false;
      });
  }

  function bindEndedHandler(sequenceId, source = 'unknown') {
    if (!dom.audioElement) {
      return;
    }

    dom.audioElement.onended = () => {
      tracePlayback('audio.onended', {
        sequenceId,
        source,
      });

      if (sequenceId !== state.playSequence) {
        tracePlayback('audio.onended.skipped', {
          sequenceId,
          source,
          statePlaySequence: state.playSequence,
        });
        return;
      }

      state.isPlaying = false;
      state.offset = 0;
      setMediaSessionPlaybackState('paused');
      void ui.highlight();
      next();
    };

    tracePlayback('audio.onended.bound', {
      sequenceId,
      source,
    });
  }

  function kill() {
    tracePlayback('playback.kill.begin');
    state.isPlaying = false;
    state.pendingStartOffset = null;
    state.pendingPlaySequence = ++state.playSequence;

    if (dom.audioElement) {
      state.isInternalTransition = true;
      dom.audioElement.pause();
      dom.audioElement.src = '';
    }

    revokeCurrentObjectUrl();
    tracePlayback('playback.kill.end');
  }

  function applyVolumeForCurrentTrack() {
    const file = state.files[state.index];

    if (!file) {
      if (dom.gainInfoEl) {
        dom.gainInfoEl.textContent = '';
      }

      console.warn(`Cannot apply volume because there is no file at index ${state.index}`);
      return;
    }

    const trackKey = getFileKey(file);

    if (!state.normalize) {
      if (dom.gainInfoEl) {
        dom.gainInfoEl.textContent = '';
      }

      return;
    }

    const peak = loadNormInfo(trackKey);

    if (typeof peak === 'number' && peak > 0) {
      const multiplier = Math.min(1 / peak, 10);

      if (dom.gainInfoEl) {
        dom.gainInfoEl.textContent = `Gain: ${multiplier.toFixed(2)}x`;
      }

      return;
    }

    if (dom.gainInfoEl) {
      dom.gainInfoEl.textContent = '';
    }
  }

  function play() {
    if (state.isPlaying || !dom.audioElement) {
      tracePlayback('playback.play.skipped', {
        hasAudioElement: Boolean(dom.audioElement),
        isPlaying: state.isPlaying,
      });
      return;
    }

    ensurePlaybackAudioSession('playback.play');
    setupMediaSessionHandlers();

    const file = state.files[state.index];

    if (!file) {
      console.error(`Cannot play because there is no file at index ${state.index}`);
      tracePlayback('playback.play.failed', {
        reason: 'missing-file',
      });
      return;
    }

    tracePlayback('playback.play.begin', {
      trackKey: getFileKey(file),
    });

    syncMediaMetadata(
      file,
      {
        title: getDisplayName(getFileKey(file)),
        artist: null,
        artwork: null,
      },
      getCurrentPlaylistName(),
      'playback.play.fallback'
    );

    const hasBlobSource =
      dom.audioElement.src && dom.audioElement.src.startsWith('blob:');
    const canResumeExistingSource =
      hasBlobSource &&
      dom.audioElement.paused &&
      !dom.audioElement.ended &&
      currentSourceTrackKey === getFileKey(file) &&
      (!state.normalize || currentSourceIsNormalized);

    if (canResumeExistingSource) {
      tracePlayback('playback.play.resume-existing-source', {
        hasBlobSource,
        isNormalizedSource: currentSourceIsNormalized,
      });
      bindEndedHandler(state.playSequence, 'playback.play.resume-existing-source');
      try {
        dom.audioElement.currentTime = Number.isFinite(state.offset)
          ? state.offset
          : dom.audioElement.currentTime || 0;
      } catch (error) {
        console.error('Failed to restore current time:', error);
        tracePlayback('playback.play.restore-time.failed', {
          error: summarizeError(error),
        });
      }

      void playForSequence(state.playSequence, 'Failed to resume playback:');
      return;
    }

    const sequenceId = ++state.playSequence;
    void buildPreparedSource(file)
      .then(({ isNormalized, source }) => {
        if (sequenceId !== state.playSequence || !dom.audioElement) {
          tracePlayback('playback.play.new-source.skipped', {
            reason: 'sequence-mismatch',
            sequenceId,
            statePlaySequence: state.playSequence,
            trackKey: getFileKey(file),
          });
          return;
        }

        setAudioSource(source, { isNormalizedSource: isNormalized });
        state.pendingStartOffset = Number.isFinite(state.offset) ? state.offset : 0;
        tracePlayback('playback.play.new-source', {
          isNormalizedSource: isNormalized,
          pendingStartOffset: state.pendingStartOffset,
          sequenceId,
          trackKey: getFileKey(file),
        });
        bindEndedHandler(sequenceId, 'playback.play.new-source');
        playWhenSourceReady(sequenceId, 'Failed to start playback:');
      })
      .catch(error => {
        console.error('Failed to prepare playback source:', error);
        tracePlayback('playback.play.new-source.failed', {
          error: summarizeError(error),
          sequenceId,
          trackKey: getFileKey(file),
        });
      });
  }

  function pauseSoft() {
    if (!dom.audioElement) {
      return;
    }

    dom.audioElement.pause();
    state.offset = dom.audioElement.currentTime || 0;
    state.pendingStartOffset = null;
    tracePlayback('playback.pauseSoft', {
      offset: Number(state.offset.toFixed(3)),
    });

    window.setTimeout(() => {
      restoreCurrentTrackSource();
    }, RESUME_DELAY_MS);
  }

  function pause() {
    if (!dom.audioElement) {
      return;
    }

    dom.audioElement.pause();
    state.offset = dom.audioElement.currentTime || 0;
    state.pendingStartOffset = null;
    state.isPlaying = false;
    tracePlayback('playback.pause', {
      offset: Number(state.offset.toFixed(3)),
    });
    void ui.highlight();
    ui.updatePlaylistsButtons();
    savePlayerState();
    syncMediaSession('pause');
  }

  function startTrack(trackIndex) {
    if (typeof trackIndex !== 'number') {
      console.error('Cannot start track because the index is invalid:', trackIndex);
      tracePlayback('playback.startTrack.failed', {
        trackIndex,
      });
      return;
    }

    tracePlayback('playback.startTrack', {
      trackIndex,
    });
    state.index = trackIndex;
    state.offset = 0;
    kill();
    play();
  }

  function next() {
    const queue = getQueueIndices(state);
    tracePlayback('playback.next.begin', {
      queueLength: queue.length,
    });

    if (queue.length === 0) {
      console.warn('Cannot skip to the next track because the queue is empty');
      tracePlayback('playback.next.skipped', {
        reason: 'empty-queue',
      });
      return;
    }

    kill();
    const currentPosition = queue.indexOf(state.index);

    if (state.shuffle) {
      let nextPosition = Math.floor(Math.random() * queue.length);

      if (queue.length > 1 && nextPosition === currentPosition) {
        nextPosition = (nextPosition + 1) % queue.length;
      }

      state.index = queue[nextPosition];
    } else {
      const nextPosition = currentPosition >= 0 ? (currentPosition + 1) % queue.length : 0;
      state.index = queue[nextPosition];
    }

    state.offset = 0;
    tracePlayback('playback.next.selected', {
      nextIndex: state.index,
      queue,
    });
    play();
  }

  function prev() {
    const queue = getQueueIndices(state);
    tracePlayback('playback.prev.begin', {
      queueLength: queue.length,
    });

    if (queue.length === 0) {
      console.warn('Cannot go to the previous track because the queue is empty');
      tracePlayback('playback.prev.skipped', {
        reason: 'empty-queue',
      });
      return;
    }

    kill();
    const currentPosition = queue.indexOf(state.index);
    const previousPosition =
      currentPosition >= 0
        ? (currentPosition - 1 + queue.length) % queue.length
        : 0;

    state.index = queue[previousPosition];
    state.offset = 0;
    tracePlayback('playback.prev.selected', {
      previousIndex: state.index,
      queue,
    });
    play();
  }

  function setShuffle(enabled) {
    state.shuffle = Boolean(enabled);
    dom.shuffleBtn?.classList.toggle('on', state.shuffle);
  }

  function toggleShuffle() {
    setShuffle(!state.shuffle);
    saveSettings({
      shuffle: state.shuffle,
      normalize: state.normalize,
    });
  }

  function setNormalize(enabled) {
    state.normalize = Boolean(enabled);
    dom.normalizeBtn?.classList.toggle('on', state.normalize);
    applyVolumeForCurrentTrack();
  }

  function toggleNormalize() {
    setNormalize(!state.normalize);
    saveSettings({
      shuffle: state.shuffle,
      normalize: state.normalize,
    });

    if (!state.isPlaying && dom.audioElement?.src) {
      void restoreCurrentTrackSource();
    }
  }

  function goToLibrary() {
    navigation.setScreen(1);
  }

  function bindAudioEvents() {
    if (!dom.audioElement) {
      return;
    }

    tracePlayback('audio.events.bind');

    dom.audioElement.addEventListener('play', () => {
      tracePlayback('audio.event.play');
      const hasPlayableSource =
        Boolean(dom.audioElement.src) && dom.audioElement.src !== window.location.href;

      if (hasPlayableSource) {
        ensurePlaybackAudioSession('audio.event.play.active-source');
        applyVolumeForCurrentTrack();
        setupMediaSessionHandlers();
        bindEndedHandler(state.playSequence, 'audio.event.play.active-source');
      }

      if (!dom.audioElement.src || dom.audioElement.src === window.location.href) {
        const file = state.files[state.index];

        if (file && !state.isSettingSrc) {
          tracePlayback('audio.event.play.bootstrap-source', {
            trackKey: getFileKey(file),
          });
          state.isSettingSrc = true;
          tracePlayback('audio.event.play.bootstrap-source.redirect');

          try {
            play();
            tracePlayback('audio.event.play.bootstrap-source.success');
          } catch (error) {
            console.error('Failed to play from the play event:', error);
            tracePlayback('audio.event.play.bootstrap-source.failed', {
              error: summarizeError(error),
            });
          } finally {
            state.isSettingSrc = false;
          }
        }
      }
    });

    dom.audioElement.addEventListener('playing', () => {
      tracePlayback('audio.event.playing');
      state.isInternalTransition = false;

      if (
        typeof state.pendingStartOffset === 'number' &&
        state.pendingStartOffset > 0 &&
        Math.abs((dom.audioElement.currentTime || 0) - state.pendingStartOffset) > 0.25
      ) {
        try {
          dom.audioElement.currentTime = state.pendingStartOffset;
          tracePlayback('audio.event.playing.offset-applied', {
            pendingStartOffset: state.pendingStartOffset,
          });
        } catch (error) {
          tracePlayback('audio.event.playing.offset-failed', {
            error: summarizeError(error),
            pendingStartOffset: state.pendingStartOffset,
          });
        }
      }

      state.pendingStartOffset = null;
      applyVolumeForCurrentTrack();
      state.isPlaying = true;
      void ui.highlight();
      ui.updatePlaylistsButtons();
      syncMediaSession('audio.playing');
    });

    dom.audioElement.addEventListener('pause', () => {
      tracePlayback('audio.event.pause');
      if (state.isInternalTransition) {
        state.isInternalTransition = false;
        tracePlayback('audio.event.pause.internal-transition');
        return;
      }

      state.isPlaying = false;
      void ui.highlight();
      ui.updatePlaylistsButtons();
      savePlayerState();
      syncMediaSession('audio.pause');
    });

    dom.audioElement.addEventListener('loadedmetadata', () => {
      tracePlayback('audio.event.loadedmetadata');
      tracePlayback('audio.event.loadedmetadata.offset-pending', {
        pendingStartOffset: state.pendingStartOffset,
      });

      syncMediaSession('audio.loadedmetadata');
    });

    dom.audioElement.addEventListener('durationchange', () => {
      tracePlayback('audio.event.durationchange');
      syncMediaSession('audio.durationchange');
    });

    dom.audioElement.addEventListener('canplay', () => {
      tracePlayback('audio.event.canplay');
    });

    dom.audioElement.addEventListener('ratechange', () => {
      tracePlayback('audio.event.ratechange');
      syncMediaSession('audio.ratechange');
    });

    dom.audioElement.addEventListener('seeked', () => {
      tracePlayback('audio.event.seeked');
      state.offset = dom.audioElement.currentTime || 0;
      syncMediaSession('audio.seeked');
    });

    dom.audioElement.addEventListener('timeupdate', () => {
      state.offset = dom.audioElement.currentTime || 0;
      tracePlayback(
        'audio.event.timeupdate',
        {
          offset: Number(state.offset.toFixed(3)),
        },
        { throttleTimeupdate: true }
      );
      syncMediaSession('timeupdate');
    });
  }

  function bindVisibilityEvents() {
    if (!dom.audioElement) {
      return;
    }

    tracePlayback('visibility.events.bind');

    document.addEventListener('visibilitychange', () => {
      tracePlayback('document.visibilitychange', {
        hidden: document.hidden,
      });

      if (state.isPlaying) {
        ensurePlaybackAudioSession(
          document.hidden
            ? 'document.visibilitychange.hidden'
            : 'document.visibilitychange.visible'
        );
        syncMediaSession(
          document.hidden
            ? 'document.visibilitychange.hidden'
            : 'document.visibilitychange.visible'
        );
      }

    });
  }

  return {
    applyVolumeForCurrentTrack,
    bindAudioEvents,
    bindVisibilityEvents,
    goToLibrary,
    kill,
    next,
    pause,
    pauseSoft,
    play,
    prev,
    refreshAudioElementLayout,
    primeCurrentTrackSource,
    setNormalize,
    setShuffle,
    setupMediaSessionHandlers,
    startTrack,
    syncMediaMetadata,
    toggleNormalize,
    toggleShuffle,
  };
}
