import {
  buildDefaultArtwork,
  getPlaylistItemOrder,
  setFileKey,
} from './shared.js';
import { analyzeNormalization } from './normalization.js';

const PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS = 3;
const START_OFFSET_END_TOLERANCE_SECONDS = 0.25;

function getMaxTrackStartOffset(duration) {
  if (!(Number.isFinite(duration) && duration > 0)) {
    return 0;
  }

  return Math.max(0, duration - START_OFFSET_END_TOLERANCE_SECONDS);
}

function getMinTrackEndTime(duration, startOffset = 0) {
  if (!(Number.isFinite(duration) && duration > 0)) {
    return Math.max(0, startOffset);
  }

  return Math.min(
    duration,
    Math.max(0, startOffset) + START_OFFSET_END_TOLERANCE_SECONDS
  );
}

export function createPlaybackController({
  state,
  dom,
  ui,
  getFileKey,
  getDisplayName,
  getQueueIndices,
  loadNormInfo,
  loadTrackEndTime,
  loadTrackGain,
  loadTrackRepeatCount,
  loadTrackStartTime,
  saveNormInfo,
  saveSettings,
  savePlayerState,
}) {
  let currentSourceTrackKey = null;
  let currentSourceNormalize = false;
  let cachedNormalizedBlob = null;
  let cachedNormalizedMultiplier = 1;
  let cachedNormalizedTrackKey = null;
  let mp3GainWorker = null;
  let mp3GainWorkerRequestId = 0;
  const mp3GainWorkerRequests = new Map();
  let hasLoggedPlaybackAudioSessionReady = false;
  let hasLoggedPlaybackAudioSessionUnavailable = false;
  let mediaSessionRevision = 0;
  let testToneAudioContext = null;
  let testToneAudio = null;

  function isTrackAllowed(trackKey) {
    return state.allowExplicit || !state.explicitTrackKeys.has(trackKey);
  }

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

  function tracePlayback(event, details = {}) {
    if (Object.keys(details).length > 0) {
      console.log(`[player] ${event} ${JSON.stringify(details)}`);
      return;
    }

    console.log(`[player] ${event}`);
  }

  function ensureTestTonePlayback() {
    if (!testToneAudioContext) {
      testToneAudioContext = new window.AudioContext();

      const oscillator = testToneAudioContext.createOscillator();
      const gain = testToneAudioContext.createGain();
      const streamDestination = testToneAudioContext.createMediaStreamDestination();

      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(streamDestination);
      oscillator.start();

      testToneAudio = new Audio();
      testToneAudio.srcObject = streamDestination.stream;
      testToneAudio.play()
    }
  }

  tracePlayback('controller.created', {
    buildId: window.__playerBuildId ?? null,
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  });

  function getDerivedTrackGain(trackKey) {
    const gainOverride = loadTrackGain?.(trackKey);

    if (Number.isFinite(gainOverride) && gainOverride >= 0) {
      return Math.max(0, gainOverride);
    }

    const peak = loadNormInfo(trackKey);

    if (typeof peak === 'number' && peak > 0) {
      return Math.min(1 / peak, 10);
    }

    return 1;
  }

  function ensurePlaybackAudioSession(reason = 'unknown') {
    if (!('audioSession' in navigator) || !navigator.audioSession) {
      if (!hasLoggedPlaybackAudioSessionUnavailable) {
        hasLoggedPlaybackAudioSessionUnavailable = true;
        tracePlayback('audioSession.unavailable', { reason });
      }
      return;
    }

    try {
      const previousType = navigator.audioSession.type;

      if (previousType !== 'playback') {
        navigator.audioSession.type = 'playback';
      }

      if (!hasLoggedPlaybackAudioSessionReady || previousType !== 'playback') {
        hasLoggedPlaybackAudioSessionReady = true;
        tracePlayback('audioSession.type.ready', {
          reason,
          type: navigator.audioSession.type,
        });
      }
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
        });
      } else {
        tracePlayback('mediaSession.position.skipped', {
          duration: Number.isFinite(duration) ? Number(duration.toFixed(3)) : null,
          hasSetPositionState:
            typeof navigator.mediaSession.setPositionState === 'function',
          reason,
        });
      }
    } catch (error) {
      console.error('Failed to sync Media Session position state:', error);
      tracePlayback('mediaSession.position.failed', {
        error: summarizeError(error),
        reason,
      });
    }

    try {
      navigator.mediaSession.playbackState = state.isPlaying
        ? 'playing'
        : 'paused';
      tracePlayback('mediaSession.playbackState.updated', {
        playbackState: navigator.mediaSession.playbackState,
        reason,
      });
    } catch (error) {
      console.error('Failed to sync Media Session playback state:', error);
      tracePlayback('mediaSession.playbackState.failed', {
        error: summarizeError(error),
        reason,
      });
    }
  }

  function syncMediaSessionPosition(reason = 'unknown') {
    if (!('mediaSession' in navigator) || !dom.audioElement) {
      return;
    }

    const duration =
      Number.isFinite(dom.audioElement.duration) && dom.audioElement.duration > 0
        ? dom.audioElement.duration
        : 0;

    if (!(duration > 0) || typeof navigator.mediaSession.setPositionState !== 'function') {
      return;
    }

    const position =
      Number.isFinite(dom.audioElement.currentTime) &&
      dom.audioElement.currentTime >= 0
        ? dom.audioElement.currentTime
        : 0;
    const playbackRate = dom.audioElement.playbackRate || 1;

    try {
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
      });
    } catch (error) {
      console.error('Failed to sync Media Session position state:', error);
      tracePlayback('mediaSession.position.failed', {
        error: summarizeError(error),
        reason,
      });
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
    const artworkSessionSource = `${artworkSource}${
      artworkSource.includes('#') ? '&' : '#'
    }ms=${mediaSessionRevision}`;
    const artworkType = artworkSource.match(/^data:([^;,]+)/)?.[1] ?? null;
    const mediaMetadataPayload = {
      album: playlistName,
      artist: metadata.artist || playlistName,
      artwork: [
        {
          src: artworkSessionSource,
          sizes: '512x512',
          ...(artworkType ? { type: artworkType } : {}),
        },
      ],
      title: metadata.title || getDisplayName(trackKey),
    };
    const mediaSessionSignature = JSON.stringify({
      trackKey,
      title: mediaMetadataPayload.title,
      artist: mediaMetadataPayload.artist,
      album: mediaMetadataPayload.album,
      artworkSessionSource,
    });

    if (state.mediaSessionSignature === mediaSessionSignature) {
      return;
    }

    state.mediaSessionSignature = mediaSessionSignature;
    navigator.mediaSession.metadata = new MediaMetadata(mediaMetadataPayload);
    tracePlayback('mediaSession.metadata.updated', {
      artist: mediaMetadataPayload.artist,
      mediaSessionRevision,
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

  function normalizeStartOffset(offset, duration) {
    if (!(Number.isFinite(offset) && offset > 0)) {
      return 0;
    }

    if (Number.isFinite(duration) && duration > 0) {
      return Math.min(offset, getMaxTrackStartOffset(duration));
    }

    return offset;
  }

  function getTrackStartOffset(file) {
    if (!file) {
      return 0;
    }

    const trackStartOffset = loadTrackStartTime(getFileKey(file));
    return Number.isFinite(trackStartOffset) && trackStartOffset > 0
      ? trackStartOffset
      : 0;
  }

  function getTrackEndTime(file, duration = NaN) {
    if (!file) {
      return 0;
    }

    const trackStartOffset = getTrackStartOffset(file);
    const endOffset = loadTrackEndTime(getFileKey(file));

    if (!(Number.isFinite(duration) && duration > 0 && Number.isFinite(endOffset) && endOffset > 0)) {
      return 0;
    }

    return Math.max(getMinTrackEndTime(duration, trackStartOffset), duration - endOffset);
  }

  function getTrackPlaybackEndTime(file, duration = NaN) {
    if (!(Number.isFinite(duration) && duration > 0)) {
      return Infinity;
    }

    const trackEndTime = getTrackEndTime(file, duration);
    return trackEndTime > 0 ? trackEndTime : duration;
  }

  function clearPreviewEndTarget() {
    state.previewEndTime = null;
    state.previewEndTrackKey = null;
  }

  function nowMs() {
    return Date.now();
  }

  function getStartOffsetForPlayback(file, requestedOffset, duration = NaN) {
    const nextOffset =
      Number.isFinite(requestedOffset) && requestedOffset > 0
        ? requestedOffset
        : getTrackStartOffset(file);

    return normalizeStartOffset(nextOffset, duration);
  }

  function syncRepeatForCurrentTrack({ force = false } = {}) {
    const file = state.files[state.index];
    const trackKey = file ? getFileKey(file) : null;

    if (!trackKey) {
      state.repeatTrackKey = null;
      state.repeatRemaining = null;
      return;
    }

    if (!force && state.repeatTrackKey === trackKey && typeof state.repeatRemaining === 'number') {
      return;
    }

    const repeatCount = loadTrackRepeatCount?.(trackKey) ?? 1;
    state.repeatTrackKey = trackKey;
    state.repeatRemaining = Math.max(0, (Number.isFinite(repeatCount) ? repeatCount : 1) - 1);
  }

  function syncPendingStartOffset(reason = 'unknown') {
    if (!dom.audioElement) {
      return;
    }

    if (!(typeof state.pendingStartOffset === 'number')) {
      state.pendingStartOffset = null;
      return;
    }

    const nextOffset = normalizeStartOffset(
      state.pendingStartOffset,
      dom.audioElement.duration
    );

    if (nextOffset !== state.pendingStartOffset) {
      tracePlayback('audio.start-offset.normalized', {
        duration: Number.isFinite(dom.audioElement.duration)
          ? Number(dom.audioElement.duration.toFixed(3))
          : null,
        normalizedOffset: nextOffset,
        previousOffset: state.pendingStartOffset,
        reason,
      });
      state.pendingStartOffset = nextOffset;
      state.offset = nextOffset;
    }
  }

  function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator) || !dom.audioElement) {
      tracePlayback('mediaSession.handlers.skipped', {
        hasAudioElement: Boolean(dom.audioElement),
        hasMediaSession: 'mediaSession' in navigator,
      });
      return;
    }

    // iPhone Safari may drop lock-screen prev/next controls after source changes
    // unless Media Session handlers are re-registered during playback transitions.
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

  function getMp3GainWorker() {
    if (mp3GainWorker) {
      return mp3GainWorker;
    }

    const workerUrl = new URL('./mp3-gain-worker.js', import.meta.url);
    workerUrl.searchParams.set('build', window.__playerBuildId ?? 'dev');
    mp3GainWorker = new Worker(workerUrl, { type: 'module' });
    mp3GainWorker.addEventListener('message', event => {
      const { buffer, changedFrameCount, error, requestId } = event.data ?? {};
      const request = mp3GainWorkerRequests.get(requestId);

      if (!request) {
        return;
      }

      mp3GainWorkerRequests.delete(requestId);

      if (error) {
        request.reject(new Error(error));
        return;
      }

      request.resolve({ buffer, changedFrameCount });
    });
    return mp3GainWorker;
  }

  async function rewriteMp3GlobalGain(file, multiplier) {
    const trackKey = getFileKey(file);
    const gainStepDelta = Math.floor(Math.log2(multiplier) * 4);

    if (!Number.isFinite(gainStepDelta) || gainStepDelta === 0) {
      return {
        changedFrameCount: 0,
        source: file,
      };
    }

    const buffer = await file.arrayBuffer();
    const requestId = ++mp3GainWorkerRequestId;
    const result = new Promise((resolve, reject) => {
      mp3GainWorkerRequests.set(requestId, { reject, resolve });
    });
    getMp3GainWorker().postMessage({ buffer, gainStepDelta, requestId }, [buffer]);
    const { buffer: outputBuffer, changedFrameCount } = await result;

    if (changedFrameCount === 0) {
      return {
        changedFrameCount,
        source: file,
      };
    }

    tracePlayback('audio.source.mp3.global-gain.rewritten', {
      changedFrameCount,
      gainStepDelta,
      trackKey,
    });

    return {
      changedFrameCount,
      source: setFileKey(
        new Blob([outputBuffer], { type: file.type || 'audio/mpeg' }),
        trackKey
      ),
    };
  }

  async function buildPreparedSource(file) {
    const trackKey = getFileKey(file);

    if (!state.normalize || !/\.mp3$/i.test(trackKey)) {
      return file;
    }

    const peak = loadNormInfo(trackKey);

    if (!(peak > 0) && loadTrackGain(trackKey) === null) {
      const DecodeAudioContext = window.AudioContext || window.webkitAudioContext;
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

      const normalization = analyzeNormalization(audioBuffer);

      if (normalization > 0) {
        saveNormInfo?.(trackKey, normalization);
      }
    }

    const multiplier = getDerivedTrackGain(trackKey);

    if (
      cachedNormalizedBlob &&
      cachedNormalizedTrackKey === trackKey &&
      Math.abs(cachedNormalizedMultiplier - multiplier) < 0.0005
    ) {
      return cachedNormalizedBlob;
    }

    if (Math.abs(multiplier - 1) < 0.001) {
      return file;
    }

    const { changedFrameCount, source } = await rewriteMp3GlobalGain(file, multiplier);

    if (changedFrameCount === 0) {
      return file;
    }

    cachedNormalizedBlob = source;
    cachedNormalizedMultiplier = multiplier;
    cachedNormalizedTrackKey = trackKey;

    return source;
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

    currentSourceTrackKey = null;
    currentSourceNormalize = false;
  }

  function playForSequence(sequenceId, errorLabel) {
    if (!dom.audioElement) {
      return Promise.resolve(false);
    }

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
        const isSuperseded = state.playSequence !== sequenceId;

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

  function resumeCurrentSourceOrReload(file, sequenceId, errorLabel, fallbackReason) {
    return playForSequence(sequenceId, errorLabel).then(didStartPlayback => {
      const trackKey = file ? getFileKey(file) : null;
      const isStillCurrentSource =
        trackKey &&
        sequenceId === state.playSequence &&
        currentSourceTrackKey === trackKey &&
        currentSourceNormalize === state.normalize;

      if (didStartPlayback || !isStillCurrentSource) {
        return didStartPlayback;
      }

      state.offset = dom.audioElement.currentTime || state.offset || 0;
      tracePlayback('playback.play.resume-existing-source.reload', {
        fallbackReason,
        offset: Number(state.offset.toFixed(3)),
        sequenceId,
        trackKey,
      });

      return reloadCurrentTrackSource({
        reason: fallbackReason,
        resumePlayback: true,
      });
    });
  }

  function setAudioSource(file, { markInternalTransition = true } = {}) {
    if (!dom.audioElement) {
      return;
    }

    if (markInternalTransition) {
      state.isInternalTransition = true;
    }

    const previousObjectUrl = state.currentObjectUrl;
    state.currentObjectUrl = URL.createObjectURL(file);
    dom.audioElement.src = state.currentObjectUrl;
    currentSourceTrackKey = getFileKey(file);
    currentSourceNormalize = state.normalize;
    setupMediaSessionHandlers();
    tracePlayback('audio.source.set', {
      hadPreviousObjectUrl: Boolean(previousObjectUrl),
      markInternalTransition,
      trackKey: getFileKey(file),
    });

    if (previousObjectUrl && previousObjectUrl !== state.currentObjectUrl) {
      queueObjectUrlForRevoke(previousObjectUrl);
    }
  }

  function reloadCurrentTrackSource({
    reason = 'unknown',
    resumePlayback = false,
  } = {}) {
    const file = state.files[state.index];

    if (!file || !dom.audioElement) {
      return Promise.resolve(false);
    }

    if (resumePlayback) {
      state.offset = dom.audioElement.currentTime || state.offset || 0;
      state.pendingStartOffset = null;
      state.isInternalTransition = true;
      dom.audioElement.pause();
      state.isPlaying = false;
      tracePlayback('audio.source.reload.begin', {
        offset: Number(state.offset.toFixed(3)),
        reason,
        resumePlayback,
        trackKey: getFileKey(file),
      });
    }

    return buildPreparedSource(file)
      .then(source => {
        setAudioSource(source);
        state.pendingStartOffset = getStartOffsetForPlayback(file, state.offset);
        tracePlayback('audio.source.reload.success', {
          pendingStartOffset: state.pendingStartOffset,
          reason,
          resumePlayback,
          trackKey: getFileKey(file),
        });

        if (resumePlayback) {
          const sequenceId = ++state.playSequence;
          bindEndedHandler(sequenceId, 'audio.source.reload.resume');
          void playForSequence(sequenceId, 'Failed to resume playback after reload:');
        }

        return true;
      })
      .catch(error => {
        console.error('Failed to reload current track source:', error);
        tracePlayback('audio.source.reload.failed', {
          error: summarizeError(error),
          reason,
          resumePlayback,
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

    if (!isTrackAllowed(getFileKey(file))) {
      tracePlayback('audio.source.prime.skipped', {
        reason: 'explicit-disabled',
        trackKey: getFileKey(file),
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
      currentSourceNormalize === state.normalize;

    if (hasMatchingExistingSource) {
      tracePlayback('audio.source.prime.skipped', {
        reason: 'existing-source',
        trackKey: getFileKey(file),
      });
      return Promise.resolve(true);
    }

    return buildPreparedSource(file)
      .then(source => {
        setAudioSource(source, { markInternalTransition: false });
        state.pendingStartOffset = getStartOffsetForPlayback(file, state.offset);
        dom.audioElement.load();
        state.isInternalTransition = false;
        tracePlayback('audio.source.prime.success', {
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
      clearPreviewEndTarget();
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

      state.offset = 0;
      void ui.highlight();

      const currentFile = state.files[state.index];
      const currentTrackKey = currentFile ? getFileKey(currentFile) : null;
      const suppressAutoNext =
        Boolean(currentTrackKey) &&
        state.suppressAutoNextTrackKey === currentTrackKey &&
        state.suppressAutoNextUntil > nowMs();

      if (suppressAutoNext) {
        tracePlayback('audio.onended.suppressed', {
          until: state.suppressAutoNextUntil,
          now: nowMs(),
          trackKey: currentTrackKey,
        });
        state.suppressAutoNextUntil = 0;
        state.suppressAutoNextTrackKey = null;
        pause();
        return;
      }

      if (
        currentTrackKey &&
        state.repeatTrackKey === currentTrackKey &&
        typeof state.repeatRemaining === 'number' &&
        state.repeatRemaining > 0
      ) {
        state.repeatRemaining -= 1;
        tracePlayback('audio.onended.repeat', {
          remaining: state.repeatRemaining,
          trackKey: currentTrackKey,
        });
        state.isPlaying = false;
        play();
        return;
      }

      state.repeatTrackKey = null;
      state.repeatRemaining = null;
      next({ forceContinuePlaying: true });
    };

    tracePlayback('audio.onended.bound', {
      sequenceId,
      source,
    });
  }

  function cancelPlaybackRequest() {
    state.pendingStartOffset = null;
    clearPreviewEndTarget();
    state.playSequence += 1;

    if (dom.audioElement) {
      state.isInternalTransition = true;
    }
  }

  function clearAudioSource() {
    if (dom.audioElement) {
      dom.audioElement.pause();
      dom.audioElement.src = '';
    }

    revokeCurrentObjectUrl();
  }

  function kill() {
    tracePlayback('playback.kill.begin');
    state.isPlaying = false;
    cancelPlaybackRequest();
    clearAudioSource();
    tracePlayback('playback.kill.end');
  }

  function applyVolumeForCurrentTrack({ commit = false, forceVisible = false } = {}) {
    const file = state.files[state.index];

    if (!file) {
      if (dom.gainInfoEl) {
        dom.gainInfoEl.classList.remove('active');
        dom.gainInfoEl.textContent = '';
      }
      return;
    }

    const trackKey = getFileKey(file);
    const normalizedGain = getDerivedTrackGain(trackKey);

    if (dom.gainInfoEl) {
      const shouldShowGain = forceVisible || state.normalize;
      dom.gainInfoEl.classList.toggle('active', forceVisible);
      dom.gainInfoEl.textContent = shouldShowGain
        ? `Gain: ${normalizedGain.toFixed(2)}x`
        : '';
    }

    if (commit && state.normalize) {
      void reloadCurrentTrackSource({
        reason: 'trackGainCommit',
        resumePlayback: state.isPlaying,
      });
    }
  }

  function play() {
    if (!dom.audioElement) {
      tracePlayback('playback.play.skipped', {
        hasAudioElement: Boolean(dom.audioElement),
        isPlaying: state.isPlaying,
      });
      return;
    }

    const file = state.files[state.index];
    const trackKey = file ? getFileKey(file) : null;
    const alreadyPlayingCurrentSource =
      state.isPlaying &&
      trackKey &&
      currentSourceTrackKey === trackKey &&
      currentSourceNormalize === state.normalize;

    if (alreadyPlayingCurrentSource) {
      tracePlayback('playback.play.skipped', {
        hasAudioElement: true,
        isPlaying: state.isPlaying,
      });
      return;
    }

    syncRepeatForCurrentTrack();
    ensurePlaybackAudioSession('playback.play');

    if (!file) {
      console.error(`Cannot play because there is no file at index ${state.index}`);
      tracePlayback('playback.play.failed', {
        reason: 'missing-file',
      });
      return;
    }

    if (!isTrackAllowed(getFileKey(file))) {
      tracePlayback('playback.play.failed', {
        reason: 'explicit-disabled',
        trackKey: getFileKey(file),
      });
      state.isPlaying = false;
      state.offset = 0;
      state.pendingStartOffset = null;
      void ui.highlight();
      ui.updatePlaylistsButtons();
      savePlayerState();
      return;
    }

    ensureTestTonePlayback();

    tracePlayback('playback.play.begin', {
      trackKey: getFileKey(file),
    });

    const hasBlobSource =
      dom.audioElement.src && dom.audioElement.src.startsWith('blob:');
    const canResumeExistingSource =
      hasBlobSource &&
      dom.audioElement.paused &&
      !dom.audioElement.ended &&
      currentSourceTrackKey === getFileKey(file) &&
      currentSourceNormalize === state.normalize;

    if (canResumeExistingSource) {
      tracePlayback('playback.play.resume-existing-source', {
        hasBlobSource,
      });

      void resumeCurrentSourceOrReload(
        file,
        state.playSequence,
        'Failed to resume playback:',
        'resumeExistingSourceFailed'
      );
      return;
    }

    mediaSessionRevision += 1;
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

    const sequenceId = ++state.playSequence;
    const requestedOffset = state.offset;
    void buildPreparedSource(file)
      .then(source => {
        if (sequenceId !== state.playSequence || !dom.audioElement) {
          tracePlayback('playback.play.new-source.skipped', {
            reason: 'sequence-mismatch',
            sequenceId,
            statePlaySequence: state.playSequence,
            trackKey: getFileKey(file),
          });
          return;
        }

        setAudioSource(source);
        state.pendingStartOffset = getStartOffsetForPlayback(file, requestedOffset);
        tracePlayback('playback.play.new-source', {
          pendingStartOffset: state.pendingStartOffset,
          sequenceId,
          trackKey: getFileKey(file),
        });
        bindEndedHandler(sequenceId, 'playback.play.new-source');
        void playForSequence(sequenceId, 'Failed to start playback:');
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

  function pause() {
    if (!dom.audioElement) {
      return;
    }

    dom.audioElement.pause();
    state.offset = dom.audioElement.currentTime || 0;
    state.pendingStartOffset = null;
    clearPreviewEndTarget();
    state.isPlaying = false;
    tracePlayback('playback.pause', {
      offset: Number(state.offset.toFixed(3)),
    });
    ui.syncArtworkPlaybackState();
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
    const file = state.files[trackIndex];
    state.index = trackIndex;
    state.offset = 0;
    syncRepeatForCurrentTrack({ force: true });
    kill();

    if (!file || !isTrackAllowed(getFileKey(file))) {
      void ui.highlight();
      ui.updatePlaylistsButtons();
      savePlayerState();
      return;
    }

    ui.resetArtworkSpin();
    play();
  }

  function previewStartOffset(offset) {
    const file = state.files[state.index];

    if (!file || !dom.audioElement) {
      tracePlayback('playback.preview-start-offset.skipped', {
        hasAudioElement: Boolean(dom.audioElement),
        hasFile: Boolean(file),
      });
      return;
    }

    const nextOffset = getStartOffsetForPlayback(
      file,
      offset,
      dom.audioElement.duration
    );

    clearPreviewEndTarget();

    state.offset = nextOffset;
    state.pendingStartOffset = nextOffset;
    tracePlayback('playback.preview-start-offset', {
      offset: Number(nextOffset.toFixed(3)),
      trackKey: getFileKey(file),
    });

    const hasPlayableCurrentSource =
      Boolean(dom.audioElement.src) && dom.audioElement.src !== window.location.href;
    const hasMatchingActiveSource =
      hasPlayableCurrentSource && currentSourceTrackKey === getFileKey(file);

    if (hasMatchingActiveSource) {
      try {
        dom.audioElement.currentTime = nextOffset;
        state.pendingStartOffset = null;
      } catch (error) {
        tracePlayback('playback.preview-start-offset.seek-failed', {
          error: summarizeError(error),
          offset: Number(nextOffset.toFixed(3)),
          trackKey: getFileKey(file),
        });
      }

      syncMediaSession('playback.preview-start-offset');

      if (dom.audioElement.paused) {
        ensurePlaybackAudioSession('playback.preview-start-offset');
        setupMediaSessionHandlers();
        bindEndedHandler(
          state.playSequence,
          'playback.preview-start-offset.resume-existing-source'
        );
        void playForSequence(state.playSequence, 'Failed to preview playback:');
      }

      return;
    }

    play();
  }

  function previewEndOffset(endOffset) {
    const file = state.files[state.index];

    if (!file || !dom.audioElement) {
      return;
    }

    const trackStartOffset = getTrackStartOffset(file);
    const duration = dom.audioElement.duration;
    const minEndTime = getMinTrackEndTime(duration, trackStartOffset);
    const nextEndTime =
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(endOffset) &&
      endOffset > 0
        ? Math.max(minEndTime, duration - endOffset)
        : duration;

    const previewStartTime = Math.max(
      trackStartOffset,
      nextEndTime - 1
    );

    clearPreviewEndTarget();

    if (!(Number.isFinite(nextEndTime) && nextEndTime > 0)) {
      return;
    }

    state.previewEndTime = nextEndTime;
    state.previewEndTrackKey = getFileKey(file);
    state.suppressAutoNextTrackKey = state.previewEndTrackKey;
    state.suppressAutoNextUntil = nowMs() + 2500;
    state.offset = previewStartTime;
    state.pendingStartOffset = previewStartTime;

    tracePlayback('playback.preview-end-offset', {
      endTime: Number(nextEndTime.toFixed(3)),
      previewStartTime: Number(previewStartTime.toFixed(3)),
      trackKey: getFileKey(file),
    });

    const hasPlayableCurrentSource =
      Boolean(dom.audioElement.src) && dom.audioElement.src !== window.location.href;
    const hasMatchingActiveSource =
      hasPlayableCurrentSource && currentSourceTrackKey === getFileKey(file);

    if (hasMatchingActiveSource) {
      try {
        dom.audioElement.currentTime = previewStartTime;
        state.pendingStartOffset = null;
      } catch (error) {
        tracePlayback('playback.preview-end-offset.seek-failed', {
          endTime: Number(nextEndTime.toFixed(3)),
          error: summarizeError(error),
          previewStartTime: Number(previewStartTime.toFixed(3)),
          trackKey: getFileKey(file),
        });
      }

      syncMediaSession('playback.preview-end-offset');
      ensurePlaybackAudioSession('playback.preview-end-offset');
      setupMediaSessionHandlers();
      bindEndedHandler(
        state.playSequence,
        'playback.preview-end-offset.resume-existing-source'
      );
      void playForSequence(state.playSequence, 'Failed to preview end playback:');
      return;
    }

    play();
  }

  function findAdjacentPlayableTrackIndex(direction) {
    const queue = getQueueIndices(state);

    if (queue.length === 0) {
      return null;
    }

    const currentPosition = queue.indexOf(state.index);

    if (currentPosition >= 0) {
      const step = direction === 'prev' ? -1 : 1;
      return queue[(currentPosition + step + queue.length) % queue.length];
    }

    const currentTrackKey = state.files[state.index]
      ? getFileKey(state.files[state.index])
      : null;
    const playlist = state.playlists.find(item => item.id === state.currentPlaylistId);

    if (playlist && Array.isArray(playlist.items) && playlist.items.length > 0) {
      const orderedKeys = getPlaylistItemOrder(state, playlist.id);
      const currentKeyPosition = currentTrackKey
        ? orderedKeys.indexOf(currentTrackKey)
        : -1;

      if (currentKeyPosition >= 0) {
        const step = direction === 'prev' ? -1 : 1;

        for (let offset = 1; offset <= orderedKeys.length; offset += 1) {
          const candidatePosition =
            (currentKeyPosition + step * offset + orderedKeys.length) %
            orderedKeys.length;
          const candidateKey = orderedKeys[candidatePosition];
          const candidateIndex = state.fileIndexByKey.get(candidateKey);

          if (
            typeof candidateIndex === 'number' &&
            isTrackAllowed(candidateKey)
          ) {
            return candidateIndex;
          }
        }
      }
    }

    const step = direction === 'prev' ? -1 : 1;

    for (let offset = 1; offset <= state.files.length; offset += 1) {
      const candidateIndex =
        (state.index + step * offset + state.files.length) % state.files.length;
      const candidateFile = state.files[candidateIndex];
      const candidateKey = candidateFile ? getFileKey(candidateFile) : null;

      if (candidateKey && isTrackAllowed(candidateKey)) {
        return candidateIndex;
      }
    }
  }

  function next({ forceContinuePlaying = false } = {}) {
    const queue = getQueueIndices(state);
    const shouldContinuePlaying =
      forceContinuePlaying ||
      state.isPlaying ||
      Boolean(dom.audioElement && !dom.audioElement.paused);

    tracePlayback('playback.next.begin', {
      forceContinuePlaying,
      queueLength: queue.length,
      shouldContinuePlaying,
    });

    if (queue.length === 0) {
      console.warn('Cannot skip to the next track because the queue is empty');
      tracePlayback('playback.next.skipped', {
        reason: 'empty-queue',
      });
      return;
    }

    const nextIndex = findAdjacentPlayableTrackIndex('next');

    if (typeof nextIndex !== 'number') {
      tracePlayback('playback.next.skipped', {
        reason: 'missing-next-index',
      });
      return;
    }

    cancelPlaybackRequest();
    state.index = nextIndex;
    state.offset = 0;
    syncRepeatForCurrentTrack({ force: true });
    tracePlayback('playback.next.selected', {
      nextIndex: state.index,
      queue,
    });

    if (shouldContinuePlaying) {
      ui.resetArtworkSpin();
      play();
      return;
    }

    void primeCurrentTrackSource();
    void ui.highlight();
    ui.updatePlaylistsButtons();
    savePlayerState();
  }

  function prev() {
    const queue = getQueueIndices(state);
    const shouldContinuePlaying =
      state.isPlaying ||
      Boolean(dom.audioElement && !dom.audioElement.paused);

    ui.resetArtworkSpin();

    tracePlayback('playback.prev.begin', {
      queueLength: queue.length,
      shouldContinuePlaying,
    });

    if (queue.length === 0) {
      console.warn('Cannot go to the previous track because the queue is empty');
      tracePlayback('playback.prev.skipped', {
        reason: 'empty-queue',
      });
      return;
    }

    const currentTrackKey = state.files[state.index]
      ? getFileKey(state.files[state.index])
      : null;
    const canRestartCurrentTrack =
      currentTrackKey && isTrackAllowed(currentTrackKey);
    const currentOffset = dom.audioElement
      ? dom.audioElement.currentTime || state.offset || 0
      : state.offset || 0;

    if (
      canRestartCurrentTrack &&
      currentOffset > PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS
    ) {
      state.offset = 0;
      state.pendingStartOffset = null;

      if (
        dom.audioElement &&
        dom.audioElement.src &&
        dom.audioElement.src !== window.location.href
      ) {
        try {
          dom.audioElement.currentTime = 0;
        } catch (error) {
          tracePlayback('playback.prev.restart-current.failed', {
            error: summarizeError(error),
          });
        }
      }

      tracePlayback('playback.prev.restart-current', {
        currentOffset: Number(currentOffset.toFixed(3)),
        threshold: PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS,
      });
      savePlayerState();
      syncMediaSession('playback.prev.restart-current');
      void ui.highlight();
      return;
    }

    const previousIndex = findAdjacentPlayableTrackIndex('prev');

    if (typeof previousIndex !== 'number') {
      tracePlayback('playback.prev.skipped', {
        reason: 'missing-previous-index',
      });
      return;
    }

    cancelPlaybackRequest();
    state.index = previousIndex;
    state.offset = 0;
    syncRepeatForCurrentTrack({ force: true });
    tracePlayback('playback.prev.selected', {
      previousIndex: state.index,
      queue,
    });

    if (shouldContinuePlaying) {
      play();
      return;
    }

    void primeCurrentTrackSource();
    void ui.highlight();
    ui.updatePlaylistsButtons();
    savePlayerState();
  }

  function setShuffle(enabled) {
    const nextShuffleState = Boolean(enabled);
    const currentPlaylistId = state.currentPlaylistId;

    if (nextShuffleState && !state.shuffle && currentPlaylistId) {
      state.shuffledPlaylistItemsById.delete(currentPlaylistId);
    }

    state.shuffle = nextShuffleState;
    dom.shuffleBtn?.classList.toggle('on', state.shuffle);
  }

  function toggleShuffle() {
    setShuffle(!state.shuffle);
    saveSettings({
      shuffle: state.shuffle,
      normalize: state.normalize,
      allowExplicit: state.allowExplicit,
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
      allowExplicit: state.allowExplicit,
    });
    void reloadCurrentTrackSource({
      reason: 'toggleNormalize',
      resumePlayback: state.isPlaying,
    });
  }

  function setAllowExplicit(enabled) {
    state.allowExplicit = Boolean(enabled);
    dom.explicitBtn?.classList.toggle('on', state.allowExplicit);
  }

  function toggleAllowExplicit() {
    setAllowExplicit(!state.allowExplicit);
    saveSettings({
      shuffle: state.shuffle,
      normalize: state.normalize,
      allowExplicit: state.allowExplicit,
    });
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

      if (hasPlayableSource && !state.isPlaying) {
        ensurePlaybackAudioSession('audio.event.play.active-source');
        applyVolumeForCurrentTrack();
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
      syncPendingStartOffset('audio.playing');

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
      ui.syncArtworkPlaybackState();
      void ui.highlight();
      ui.updatePlaylistsButtons();
      syncMediaSession('audio.playing');

    });

    dom.audioElement.addEventListener('pause', () => {
      if (dom.audioElement.seeking) {
        return;
      }

      tracePlayback('audio.event.pause');
      if (state.isInternalTransition) {
        state.isInternalTransition = false;
        tracePlayback('audio.event.pause.internal-transition');
        return;
      }

      state.isPlaying = false;
      ui.syncArtworkPlaybackState();
      void ui.highlight();
      ui.updatePlaylistsButtons();
      savePlayerState();
      syncMediaSession('audio.pause');
    });

    dom.audioElement.addEventListener('loadedmetadata', () => {
      syncPendingStartOffset('audio.loadedmetadata');

      if (
        typeof state.pendingStartOffset === 'number' &&
        state.pendingStartOffset > 0 &&
        Math.abs((dom.audioElement.currentTime || 0) - state.pendingStartOffset) > 0.25
      ) {
        try {
          dom.audioElement.currentTime = state.pendingStartOffset;
          tracePlayback('audio.event.loadedmetadata.offset-applied', {
            pendingStartOffset: state.pendingStartOffset,
          });
        } catch (error) {
          tracePlayback('audio.event.loadedmetadata.offset-failed', {
            error: summarizeError(error),
            pendingStartOffset: state.pendingStartOffset,
          });
        }
      }

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

    dom.audioElement.addEventListener('seeked', () => {
      tracePlayback('audio.event.seeked');
      state.offset = dom.audioElement.currentTime || 0;
      syncMediaSessionPosition('audio.seeked');
    });

    dom.audioElement.addEventListener('timeupdate', () => {
      state.offset = dom.audioElement.currentTime || 0;

      const file = state.files[state.index];
      const currentTrackKey = file ? getFileKey(file) : null;

      if (
        file &&
        state.previewEndTrackKey === currentTrackKey &&
        Number.isFinite(state.previewEndTime) &&
        state.offset >= state.previewEndTime
      ) {
        try {
          dom.audioElement.currentTime = state.previewEndTime;
        } catch (error) {
          tracePlayback('audio.event.timeupdate.preview-end.seek-failed', {
            error: summarizeError(error),
            previewEndTime: Number(state.previewEndTime.toFixed(3)),
            trackKey: currentTrackKey,
          });
        }

        tracePlayback('audio.event.timeupdate.preview-end.pause', {
          previewEndTime: Number(state.previewEndTime.toFixed(3)),
          trackKey: currentTrackKey,
        });
        state.suppressAutoNextTrackKey = currentTrackKey;
        state.suppressAutoNextUntil = nowMs() + 2500;
        clearPreviewEndTarget();
        pause();
        return;
      }

      const effectiveEndTime = file
        ? getTrackPlaybackEndTime(file, dom.audioElement.duration)
        : Infinity;

      if (
        file &&
        state.isPlaying &&
        Number.isFinite(effectiveEndTime) &&
        effectiveEndTime > 0 &&
        state.offset >= effectiveEndTime
      ) {
        tracePlayback('audio.event.timeupdate.end-threshold', {
          effectiveEndTime: Number(effectiveEndTime.toFixed(3)),
          offset: Number(state.offset.toFixed(3)),
          trackKey: getFileKey(file),
        });
        dom.audioElement.onended?.();
      }
    });
  }

  function bindVisibilityEvents() {
    if (!dom.audioElement) {
      return;
    }

    const persistPlaybackPosition = () => {
      const hasPlayableSource =
        Boolean(dom.audioElement.src) && dom.audioElement.src !== window.location.href;

      if (!hasPlayableSource && !state.isPlaying) {
        return;
      }

      state.offset = dom.audioElement.currentTime || state.offset || 0;
      savePlayerState();
    };

    tracePlayback('visibility.events.bind');

    document.addEventListener('visibilitychange', () => {
      tracePlayback('document.visibilitychange', {
        hidden: document.hidden,
      });

      if (document.hidden) {
        persistPlaybackPosition();
      }

      const hasPlayableSource =
        Boolean(dom.audioElement.src) && dom.audioElement.src !== window.location.href;

      if (state.isPlaying || hasPlayableSource) {
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

    window.addEventListener('pagehide', persistPlaybackPosition);
  }

  return {
    applyVolumeForCurrentTrack,
    bindAudioEvents,
    bindVisibilityEvents,
    isTrackAllowed,
    kill,
    next,
    pause,
    play,
    previewEndOffset,
    prev,
    previewStartOffset,
    refreshAudioElementLayout,
    primeCurrentTrackSource,
    setAllowExplicit,
    setNormalize,
    setShuffle,
    startTrack,
    syncMediaMetadata,
    toggleAllowExplicit,
    toggleNormalize,
    toggleShuffle,
  };
}
