import { getPlayerDom } from './player/dom.js';
import { createLibraryController } from './player/library.js';
import { createMetadataReader } from './player/metadata.js';
import { createScreenNavigator } from './player/navigation.js';
import { createNormalizationService } from './player/normalization.js';
import {
  deleteLibraryTrackFromOpfs,
  loadLibraryFromOpfs,
  saveLibraryToOpfs,
} from './player/opfs-library.js';
import {
  clearPlayerCache,
  loadExplicitInfo,
  loadNormInfo,
  loadPlaylistState,
  loadPlaylists,
  loadSettings,
  loadTrackGain,
  loadTrackStartTime,
  removePlaylistState,
  saveExplicitInfo,
  saveTrackGain,
  saveNormInfo,
  savePlaylistState,
  savePlaylists,
  saveSettings,
  saveTrackStartTime,
} from './player/storage.js';
import { createPlayerState } from './player/state.js';
import {
  getDisplayName,
  getFileKey,
  getQueueIndices,
  isAudioFile,
} from './player/shared.js';
import { createPlaybackController } from './player/playback.js';
import { createTrackRotationController } from './player/track-rotation.js';
import { createUiController } from './player/ui.js';

const dom = getPlayerDom();
const state = createPlayerState();
window.__playerBuildId = '97';
console.log('Player build:', window.__playerBuildId);
const { playlists, currentPlaylistId } = loadPlaylists();

state.playlists = playlists;
state.currentPlaylistId = currentPlaylistId || state.playlists[0]?.id || null;

const metadataReader = createMetadataReader({ getFileKey });

let playback;
let trackRotation;

const navigation = createScreenNavigator({
  state,
  screens: dom.screens,
  onPlayerScreenVisible: () => {
    playback?.refreshAudioElementLayout();
  },
});

function saveCurrentPlayerState() {
  const currentTrackKey = state.files[state.index]
    ? getFileKey(state.files[state.index])
    : null;

  savePlaylistState(state.currentPlaylistId, {
    trackKey: currentTrackKey,
    offset: state.offset,
  });
}

function loadExplicitTrackKeys() {
  state.explicitTrackKeys.clear();

  state.files.forEach(file => {
    const trackKey = getFileKey(file);

    if (loadExplicitInfo(trackKey)) {
      state.explicitTrackKeys.add(trackKey);
    }
  });
}

const library = createLibraryController({
  state,
  dom,
  isAudioFile,
  getFileKey,
  deletePersistedTrack: trackKey => deleteLibraryTrackFromOpfs(trackKey),
  loadPersistedLibrary: () => loadLibraryFromOpfs(),
  persistLibrary: (files, options) => saveLibraryToOpfs(files, getFileKey, options),
  savePlaylists,
  renderList: () => ui.renderList(),
  renderPlaylists: () => ui.renderPlaylists(),
  highlight: () => ui.highlight(),
  queueTracksForAnalysis: trackKeys => normalization.queueTracksForAnalysis(trackKeys),
  onCurrentTrackUnavailable: () => {
    playback?.kill();

    if (dom.gainInfoEl) {
      dom.gainInfoEl.textContent = '';
    }
  },
  onLibraryLoaded: () => {
    loadExplicitTrackKeys();
    ui.renderList();
    ui.restoreCurrentPlaylistTrack();
  },
});

function lookupFileByKey(trackKey) {
  const fileIndex = state.fileIndexByKey.get(trackKey);
  return typeof fileIndex === 'number' ? state.files[fileIndex] : null;
}

function reconcileExplicitPlayback({
  resumePlayback = false,
  blockedBehavior = 'restore',
} = {}) {
  const currentFile = state.files[state.index];
  const currentTrackKey = currentFile ? getFileKey(currentFile) : null;
  const currentTrackAllowed = currentTrackKey
    ? playback?.isTrackAllowed(currentTrackKey) !== false
    : true;

  ui.renderList();

  if (currentTrackAllowed) {
    void ui.highlight();
    return;
  }

  if (blockedBehavior === 'pause') {
    if (state.isPlaying) {
      playback?.pause();
      return;
    }

    saveCurrentPlayerState();
    void ui.highlight();
    return;
  }

  const shouldResumePlayback = Boolean(resumePlayback && state.isPlaying);

  playback?.kill();
  const queue = ui.restoreCurrentPlaylistTrack();

  if (queue.length === 0) {
    saveCurrentPlayerState();
    return;
  }

  if (shouldResumePlayback) {
    playback?.play();
  }
}

const normalization = createNormalizationService({
  lookupFileByKey,
  loadNormInfo,
  loadTrackStartTime,
  saveNormInfo,
  saveTrackStartTime,
  onTrackAnalyzed: trackKey => {
    const currentTrackKey = state.files[state.index]
      ? getFileKey(state.files[state.index])
      : null;

    if (trackKey === currentTrackKey) {
      playback?.applyVolumeForCurrentTrack();
      trackRotation?.sync(true);
    }
  },
});

const ui = createUiController({
  state,
  dom,
  navigation,
  getFileKey,
  getDisplayName,
  getQueueIndices,
  extractMetadata: metadataReader.extractMetadata,
  savePlaylists,
  loadPlaylistState,
  removePlaylistState,
  savePlayerState: saveCurrentPlayerState,
  queueTracksForAnalysis: trackKeys => normalization.queueTracksForAnalysis(trackKeys),
  onNowPlayingMetadata: (file, metadata, playlistName) => {
    const shouldSyncMediaMetadata =
      state.isPlaying ||
      state.isInternalTransition ||
      Boolean(dom.audioElement && !dom.audioElement.paused && dom.audioElement.src);

    if (shouldSyncMediaMetadata) {
      playback?.syncMediaMetadata(file, metadata, playlistName, 'ui.highlight');
    }

    trackRotation.sync();
  },
  actions: {
    kill: () => playback?.kill(),
    pause: () => playback?.pause(),
    pauseSoft: () => playback?.pauseSoft(),
    play: () => playback?.play(),
    primeCurrentTrackSource: () => playback?.primeCurrentTrackSource(),
    removeFromLibrary: trackIndex => library.removeTrackFromLibrary(trackIndex),
    startTrack: trackIndex => playback?.startTrack(trackIndex),
  },
});

playback = createPlaybackController({
  state,
  dom,
  ui,
  getFileKey,
  getDisplayName,
  getQueueIndices,
  loadNormInfo,
  loadTrackGain,
  loadTrackStartTime,
  saveNormInfo,
  saveSettings,
  savePlayerState: saveCurrentPlayerState,
});

trackRotation = createTrackRotationController({
  dom,
  state,
  getFileKey,
  loadNormInfo,
  loadTrackGain,
  loadTrackStartTime,
  recalculateTrackStartOffset: trackKey => normalization.reanalyzeTrack(trackKey),
  saveTrackGain,
  saveTrackStartTime,
  previewStartOffset: offset => playback?.previewStartOffset(offset),
  previewTrackGain: options => playback?.applyVolumeForCurrentTrack(options),
});

library.bindFileInput();
trackRotation.bind();

if (dom.trackTitleEl) {
  dom.trackTitleEl.onclick = () => {
    if (state.isPlaying) {
      playback.pauseSoft();
    } else if (state.files[state.index]) {
      playback.play();
    }
  };
}

if (dom.addPlaylistBtn) {
  dom.addPlaylistBtn.onclick = () => {
    const fallbackName = `Playlist ${state.playlists.length + 1}`;
    const name = window.prompt('Playlist name?') || fallbackName;
    ui.createPlaylist(name);
  };
}

if (dom.clearCacheBtn) {
  dom.clearCacheBtn.onclick = () => {
    if (!window.confirm('Clear normalization cache and all player states?')) {
      return;
    }

    if (clearPlayerCache()) {
      if (dom.gainInfoEl) {
        dom.gainInfoEl.textContent = '';
      }

      trackRotation.sync(true);
      window.alert('Cache cleared');
      return;
    }

    window.alert('Failed to clear cache');
  };
}

if (dom.explicitBtn) {
  dom.explicitBtn.onclick = () => {
    const wasPlaying = state.isPlaying;
    playback.toggleAllowExplicit();
    reconcileExplicitPlayback({ resumePlayback: wasPlaying });
  };
}

if (dom.explicitTrackToggleEl) {
  dom.explicitTrackToggleEl.onclick = event => {
    const target = event.currentTarget;
    const trackKey = state.files[state.index]
      ? getFileKey(state.files[state.index])
      : null;

    if (!(target instanceof HTMLButtonElement) || !trackKey) {
      return;
    }

    const isExplicit = !state.explicitTrackKeys.has(trackKey);
    saveExplicitInfo(trackKey, isExplicit);

    if (isExplicit) {
      state.explicitTrackKeys.add(trackKey);
    } else {
      state.explicitTrackKeys.delete(trackKey);
    }

    ui.renderList();

    if (playback?.isTrackAllowed(trackKey) === false) {
      if (state.isPlaying) {
        playback.pause();
        return;
      }

      saveCurrentPlayerState();
    }

    void ui.highlight();
  };
}

const settings = loadSettings();
playback.setShuffle(settings.shuffle);
playback.setNormalize(settings.normalize);
playback.setAllowExplicit(settings.allowExplicit);

ui.renderPlaylists();
ui.renderList();
void ui.highlight();

playback.bindAudioEvents();
playback.bindVisibilityEvents();
navigation.bindTouchNavigation();

dom.audioElement?.addEventListener('loadedmetadata', () => {
  trackRotation.sync(true);
});

dom.audioElement?.addEventListener('durationchange', () => {
  trackRotation.sync(true);
});

window.player = {
  addAllFilesToCurrentPlaylist: ui.addAllFilesToCurrentPlaylist,
  next: playback.next,
  pause: playback.pause,
  pickMusicDirectory: library.pickMusicDirectory,
  play: playback.play,
  prev: playback.prev,
  toggleNormalize: playback.toggleNormalize,
  toggleAllowExplicit: playback.toggleAllowExplicit,
  toggleShuffle: playback.toggleShuffle,
};

navigation.setScreen(1);
void library.restorePersistedLibrary();

window.addEventListener('beforeunload', () => {
  if (state.isPlaying && dom.audioElement) {
    state.offset = dom.audioElement.currentTime || 0;
  }

  saveCurrentPlayerState();
});
