import { getPlayerDom } from './player/dom.js';
import { createLibraryController } from './player/library.js';
import { createMetadataReader } from './player/metadata.js';
import { createScreenNavigator } from './player/navigation.js';
import { createNormalizationService } from './player/normalization.js';
import {
  clearPlayerCache,
  loadNormInfo,
  loadPlaylistState,
  loadPlaylists,
  loadSettings,
  removePlaylistState,
  saveNormInfo,
  savePlaylistState,
  savePlaylists,
  saveSettings,
} from './player/storage.js';
import { createPlayerState } from './player/state.js';
import {
  getDisplayName,
  getFileKey,
  getPlaylistItemOrder,
  getQueueIndices,
  isAudioFile,
} from './player/shared.js';
import { createPlaybackController } from './player/playback.js';
import { createUiController } from './player/ui.js';

const dom = getPlayerDom();
const state = createPlayerState();
window.__playerBuildId = '48';
console.log('Player build:', window.__playerBuildId);
const { playlists, currentPlaylistId } = loadPlaylists();

state.playlists = playlists;
state.currentPlaylistId = currentPlaylistId || state.playlists[0]?.id || null;

const metadataReader = createMetadataReader({ getFileKey });

let playback;

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

const library = createLibraryController({
  state,
  dom,
  isAudioFile,
  getFileKey,
  savePlaylists,
  renderList: () => ui.renderList(),
  highlight: () => ui.highlight(),
  renderPlaylistView: () => ui.renderPlaylistView(),
  queueTracksForAnalysis: trackKeys => normalization.queueTracksForAnalysis(trackKeys),
  onCurrentTrackUnavailable: () => {
    playback?.kill();

    if (dom.gainInfoEl) {
      dom.gainInfoEl.textContent = '';
    }
  },
  onLibraryLoaded: () => {
    ui.restoreCurrentPlaylistTrack();
  },
});

const ui = createUiController({
  state,
  dom,
  navigation,
  getFileKey,
  getDisplayName,
  getQueueIndices,
  getPlaylistItemOrder,
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
  },
  actions: {
    kill: () => playback?.kill(),
    pause: () => playback?.pause(),
    pauseSoft: () => playback?.pauseSoft(),
    play: () => playback?.play(),
    primeCurrentTrackSource: () => playback?.primeCurrentTrackSource(),
    startTrack: trackIndex => playback?.startTrack(trackIndex),
  },
});

function lookupFileByKey(trackKey) {
  const fileIndex = state.fileIndexByKey.get(trackKey);
  return typeof fileIndex === 'number' ? state.files[fileIndex] : null;
}

const normalization = createNormalizationService({
  lookupFileByKey,
  loadNormInfo,
  saveNormInfo,
  onTrackAnalyzed: trackKey => {
    const currentTrackKey = state.files[state.index]
      ? getFileKey(state.files[state.index])
      : null;

    if (trackKey === currentTrackKey) {
      playback?.applyVolumeForCurrentTrack();
    }
  },
});

playback = createPlaybackController({
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
  savePlayerState: saveCurrentPlayerState,
});
library.bindFileInput();

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

      window.alert('Cache cleared');
      return;
    }

    window.alert('Failed to clear cache');
  };
}

const settings = loadSettings();
playback.setShuffle(settings.shuffle);
playback.setNormalize(settings.normalize);

ui.renderPlaylists();
ui.renderPlaylistView();
ui.renderList();
void ui.highlight();

playback.bindAudioEvents();
playback.bindVisibilityEvents();
navigation.bindTouchNavigation();

window.player = {
  addAllFilesToCurrentPlaylist: ui.addAllFilesToCurrentPlaylist,
  goToLibrary: playback.goToLibrary,
  next: playback.next,
  pause: playback.pause,
  pickMusicDirectory: library.pickMusicDirectory,
  play: playback.play,
  prev: playback.prev,
  toggleNormalize: playback.toggleNormalize,
  toggleShuffle: playback.toggleShuffle,
};

navigation.setScreen(1);

window.addEventListener('beforeunload', () => {
  if (state.isPlaying && dom.audioElement) {
    state.offset = dom.audioElement.currentTime || 0;
  }

  saveCurrentPlayerState();
});
