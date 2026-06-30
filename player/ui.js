import { DEFAULT_ARTWORK_URL, createPlaylistId } from './shared.js';
import { createPlaylistDragController } from './playlist-drag.js';

const EMPTY_METADATA = {
  title: null,
  artist: null,
  artwork: null,
};

export function createUiController({
  state,
  dom,
  navigation,
  getFileKey,
  getDisplayName,
  getQueueIndices,
  extractMetadata,
  loadTrackRepeatCount,
  savePlaylists,
  loadPlaylistState,
  removePlaylistState,
  savePlayerState,
  queueTracksForAnalysis,
  onNowPlayingMetadata,
  actions,
}) {
  const playlistButtons = new Map();
  let librarySearchQuery = '';

  function getCurrentPlaylist() {
    return (
      state.playlists.find(playlist => playlist.id === state.currentPlaylistId) ??
      state.playlists[0] ??
      null
    );
  }

  function getCurrentPlaylistName() {
    return getCurrentPlaylist()?.name?.trim() ?? '';
  }

  function normalizePlaylistItems(items) {
    const seenKeys = new Set();
    const seenFileIndices = new Set();

    return (items ?? []).filter(key => {
      const fileIndex = state.fileIndexByKey.get(key);

      if (
        typeof fileIndex !== 'number' ||
        seenKeys.has(key) ||
        seenFileIndices.has(fileIndex)
      ) {
        return false;
      }

      seenKeys.add(key);
      seenFileIndices.add(fileIndex);
      return true;
    });
  }

  createPlaylistDragController({
    listEl: dom.listEl,
    onReorder(key, nextKey) {
      const playlist = getCurrentPlaylist();
      const items = playlist.items;
      items.splice(items.indexOf(key), 1);
      items.splice(nextKey ? items.indexOf(nextKey) : items.length, 0, key);
      state.shuffledPlaylistItemsById.delete(playlist.id);
      savePlaylists(state.playlists, state.currentPlaylistId);
    },
  });

  function renderCurrentPlaylistName() {
    if (!dom.currentPlaylistNameEl) {
      return;
    }

    dom.currentPlaylistNameEl.textContent = getCurrentPlaylistName();
  }

  function clearTrackDisplay(clearGain = false) {
    if (dom.trackTitleEl) {
      dom.trackTitleEl.textContent = '—';
      dom.trackTitleEl.style.color = '';
    }

    if (dom.trackArtistEl) {
      dom.trackArtistEl.textContent = '';
    }

    if (dom.trackArtworkEl) {
      dom.trackArtworkEl.style.visibility = 'hidden';
      dom.trackArtworkEl.removeAttribute('src');
    }

    if (clearGain && dom.gainInfoEl) {
      dom.gainInfoEl.textContent = '';
    }

    if (dom.trackStartInfoEl) {
      dom.trackStartInfoEl.textContent = '';
      dom.trackStartInfoEl.style.display = 'none';
    }

    if (dom.trackStartToggleEl) {
      dom.trackStartToggleEl.disabled = true;
      dom.trackStartToggleEl.classList.remove('on');
      dom.trackStartToggleEl.setAttribute('aria-expanded', 'false');
    }

    if (dom.trackEndToggleEl) {
      dom.trackEndToggleEl.disabled = true;
      dom.trackEndToggleEl.classList.remove('on');
      dom.trackEndToggleEl.setAttribute('aria-expanded', 'false');
    }

    if (dom.trackGainToggleEl) {
      dom.trackGainToggleEl.disabled = true;
      dom.trackGainToggleEl.classList.remove('on');
      dom.trackGainToggleEl.setAttribute('aria-expanded', 'false');
    }

    if (dom.trackStartDefaultBtnEl) {
      dom.trackStartDefaultBtnEl.disabled = true;
      dom.trackStartDefaultBtnEl.classList.remove('on');
    }

    if (dom.trackEndDefaultBtnEl) {
      dom.trackEndDefaultBtnEl.disabled = true;
      dom.trackEndDefaultBtnEl.classList.remove('on');
    }

    if (dom.trackGainDefaultBtnEl) {
      dom.trackGainDefaultBtnEl.disabled = true;
      dom.trackGainDefaultBtnEl.classList.remove('on');
    }

    if (dom.trackGainUnityBtnEl) {
      dom.trackGainUnityBtnEl.disabled = true;
      dom.trackGainUnityBtnEl.classList.remove('on');
    }

    if (dom.trackAdjusterButtonsEl) {
      dom.trackAdjusterButtonsEl.classList.remove('start-mode');
      dom.trackAdjusterButtonsEl.classList.remove('end-mode');
      dom.trackAdjusterButtonsEl.classList.remove('gain-mode');
      dom.trackAdjusterButtonsEl.classList.remove('repeat-mode');
    }

    if (dom.explicitTrackToggleEl) {
      dom.explicitTrackToggleEl.disabled = true;
      dom.explicitTrackToggleEl.classList.remove('on');
      dom.explicitTrackToggleEl.setAttribute('aria-pressed', 'false');
    }

    if (dom.trackRepeatToggleEl) {
      dom.trackRepeatToggleEl.disabled = true;
      dom.trackRepeatToggleEl.classList.remove('on');
      dom.trackRepeatToggleEl.setAttribute('aria-pressed', 'false');
    }
  }

  function ensureDefaultPlaylist() {
    if (state.playlists.length === 0) {
      state.playlists.push({
        id: createPlaylistId(),
        name: 'Playlist 1',
        items: [],
      });
    }

    if (!state.currentPlaylistId && state.playlists[0]) {
      state.currentPlaylistId = state.playlists[0].id;
    }

    savePlaylists(state.playlists, state.currentPlaylistId);
    renderPlaylists();
    return getCurrentPlaylist();
  }

  function restorePlaylistTrack() {
    const queue = getQueueIndices(state);

    if (queue.length === 0) {
      state.index = -1;
      state.offset = 0;
      return queue;
    }

    const savedState = loadPlaylistState(state.currentPlaylistId);

    if (savedState.trackKey) {
      const savedIndex = state.fileIndexByKey.get(savedState.trackKey);

      if (typeof savedIndex === 'number' && queue.includes(savedIndex)) {
        state.index = savedIndex;
        state.offset = savedState.offset || 0;
        return queue;
      }
    }

    state.index = queue[0];
    state.offset = 0;
    return queue;
  }

  function restoreCurrentPlaylistTrack() {
    const queue = restorePlaylistTrack();
    void highlight();

    if (queue.length > 0) {
      actions.primeCurrentTrackSource?.();
    }

    return queue;
  }

  function resetCurrentTrack(clearGain = false) {
    actions.kill();
    state.offset = 0;
    state.index = -1;
    clearTrackDisplay(clearGain);
    void highlight();
    savePlayerState();
  }

  function activateAdjacentTrackAfterRemoval(
    queueBeforeRemoval,
    { clearGain = false, resumePlayback = false } = {}
  ) {
    const playlistItems = new Set(getCurrentPlaylist()?.items ?? []);
    const currentQueuePosition = Array.isArray(queueBeforeRemoval)
      ? queueBeforeRemoval.indexOf(state.index)
      : -1;
    let nextIndex = null;

    if (currentQueuePosition >= 0) {
      for (
        let offset = 1;
        offset < queueBeforeRemoval.length;
        offset += 1
      ) {
        const candidateIndex =
          queueBeforeRemoval[
            (currentQueuePosition + offset) % queueBeforeRemoval.length
          ];
        const candidateFile = state.files[candidateIndex];
        const candidateKey = candidateFile ? getFileKey(candidateFile) : null;

        if (candidateKey && playlistItems.has(candidateKey)) {
          nextIndex = candidateIndex;
          break;
        }
      }
    }

    actions.kill();
    state.offset = 0;

    if (typeof nextIndex === 'number') {
      state.index = nextIndex;
    } else {
      const queue = restorePlaylistTrack();

      if (queue.length === 0) {
        state.index = -1;
        clearTrackDisplay(clearGain);
        void highlight();
        savePlayerState();
        return;
      }
    }

    savePlayerState();
    void highlight();

    if (resumePlayback) {
      actions.play();
      return;
    }

    actions.primeCurrentTrackSource?.();
  }

  function resetArtworkSpin() {
    dom.trackArtworkEl.getAnimations()[0].currentTime = 0;
    syncArtworkPlaybackState();
  }

  function syncArtworkPlaybackState() {
    const animation = dom.trackArtworkEl.getAnimations()[0];
    state.isPlaying ? animation?.play() : animation?.pause();
  }


  async function highlight() {
    syncArtworkPlaybackState();

    if (dom.listEl) {
      [...dom.listEl.children].forEach(listItem => {
        const span = listItem.querySelector('span');
        const itemIndex = Number(listItem.dataset.fileIndex);

        if (!span) {
          return;
        }

        listItem.style.fontWeight = itemIndex === state.index ? 'bold' : 'normal';

        if (itemIndex === state.index && state.isPlaying) {
          span.style.color = '#23fd23';
        } else {
          span.style.color = '';
        }
      });
    }

    const currentFile = state.files[state.index];
    const requestedTrackKey = currentFile ? getFileKey(currentFile) : null;
    const metadata = currentFile
      ? await extractMetadata(currentFile)
      : { ...EMPTY_METADATA };

    const freshCurrentFile = state.files[state.index];
    const currentTrackKey = freshCurrentFile ? getFileKey(freshCurrentFile) : null;

    if (requestedTrackKey !== currentTrackKey) {
      return;
    }

    const playlistName = getCurrentPlaylistName() || 'no playlist';
    const isExplicit = currentTrackKey
      ? state.explicitTrackKeys.has(currentTrackKey)
      : false;

    if (dom.trackTitleEl) {
      if (freshCurrentFile) {
        dom.trackTitleEl.textContent =
          metadata.title || getDisplayName(currentTrackKey);
        dom.trackTitleEl.style.color = state.isPlaying ? '#23fd23' : '';
      } else {
        dom.trackTitleEl.textContent = '—';
        dom.trackTitleEl.style.color = '';
      }
    }

    if (dom.trackArtistEl) {
      dom.trackArtistEl.textContent = freshCurrentFile
        ? metadata.artist || playlistName
        : '';
    }

    if (dom.trackArtworkEl) {
      if (freshCurrentFile) {
        dom.trackArtworkEl.src = metadata.artwork || DEFAULT_ARTWORK_URL;
        dom.trackArtworkEl.style.visibility = 'visible';
        syncArtworkPlaybackState();
      } else {
        dom.trackArtworkEl.style.visibility = 'hidden';
        dom.trackArtworkEl.removeAttribute('src');
      }
    }

    if (dom.explicitTrackToggleEl) {
      dom.explicitTrackToggleEl.disabled = !freshCurrentFile;
      dom.explicitTrackToggleEl.classList.toggle(
        'on',
        Boolean(freshCurrentFile && isExplicit)
      );
      dom.explicitTrackToggleEl.setAttribute(
        'aria-pressed',
        freshCurrentFile && isExplicit ? 'true' : 'false'
      );
    }

    if (dom.trackRepeatToggleEl) {
      const repeatCount = currentTrackKey ? loadTrackRepeatCount?.(currentTrackKey) : 1;
      const isRepeatOn = Boolean(freshCurrentFile && repeatCount > 1);
      dom.trackRepeatToggleEl.disabled = !freshCurrentFile;
      dom.trackRepeatToggleEl.classList.toggle('on', isRepeatOn);
      dom.trackRepeatToggleEl.setAttribute('aria-pressed', isRepeatOn ? 'true' : 'false');
    }

    onNowPlayingMetadata?.(freshCurrentFile, metadata, playlistName);
  }

  function addTrackToPlaylist(fileIndex) {
    const file = state.files[fileIndex];

    if (!file) {
      console.error('Cannot add missing file at index ' + fileIndex)
      return;
    }

    const playlist = ensureDefaultPlaylist();

    if (!playlist) {
      console.error('Cannot add track because no playlist is available');
      return;
    }

    const key = getFileKey(file);
    playlist.items = [
      key,
      ...normalizePlaylistItems(playlist.items).filter(item => item !== key),
    ];
    state.shuffledPlaylistItemsById.delete(playlist.id);
    savePlaylists(state.playlists, state.currentPlaylistId);
    renderList();
    void highlight();
    queueTracksForAnalysis([key]);
  }

  function addAllFilesToCurrentPlaylist() {
    if (state.files.length === 0) {
      return;
    }

    const playlist = ensureDefaultPlaylist();

    if (!playlist) {
      return;
    }

    playlist.items = normalizePlaylistItems(playlist.items);
    const existingKeys = new Set(playlist.items);
    const newKeys = [];

    state.files.forEach(file => {
      const key = getFileKey(file);

      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        newKeys.push(key);
      }
    });

    if (newKeys.length === 0) {
      return;
    }

    playlist.items.unshift(...newKeys);
    state.shuffledPlaylistItemsById.delete(playlist.id);
    savePlaylists(state.playlists, state.currentPlaylistId);
    renderList();
    void highlight();
    queueTracksForAnalysis(newKeys);
  }

  function removeTrackFromPlaylist(fileIndex) {
    const file = state.files[fileIndex];

    if (!file) {
      console.error(`Cannot remove missing file at index ${fileIndex}`);
      return;
    }

    const playlist = getCurrentPlaylist();

    if (!playlist) {
      console.error('Cannot remove track because no playlist is selected');
      return;
    }

    const key = getFileKey(file);
    const removingCurrentTrack =
      key === (state.files[state.index] ? getFileKey(state.files[state.index]) : null);
    const queueBeforeRemoval = removingCurrentTrack ? getQueueIndices(state) : [];
    const resumePlayback = removingCurrentTrack && state.isPlaying;

    playlist.items = normalizePlaylistItems(playlist.items).filter(item => item !== key);
    state.shuffledPlaylistItemsById.delete(playlist.id);
    savePlaylists(state.playlists, state.currentPlaylistId);

    renderList();

    if (removingCurrentTrack) {
      activateAdjacentTrackAfterRemoval(queueBeforeRemoval, {
        clearGain: true,
        resumePlayback,
      });
    } else {
      void highlight();
    }
  }

  function updatePlaylistsButtons() {
    playlistButtons.forEach((button, playlistId) => {
      const isCurrentPlaylist = playlistId === state.currentPlaylistId;
      const isPlaylistPlaying = isCurrentPlaylist && state.isPlaying;
      button.setAttribute('data-icon', isPlaylistPlaying ? 'pause' : 'play');
    });
  }

  function activatePlaylist(playlist, { autoplay, navigateToLibrary = false }) {
    if (state.isPlaying && dom.audioElement) {
      state.offset = dom.audioElement.currentTime || 0;
    }

    savePlayerState();
    state.currentPlaylistId = playlist.id;
    savePlaylists(state.playlists, state.currentPlaylistId);
    actions.kill();
    renderPlaylists();
    renderList();

    const queue = restorePlaylistTrack();

    if (navigateToLibrary) {
      navigation?.setScreen(1);
    }

    void highlight();
    queueTracksForAnalysis(playlist.items || []);

    if (autoplay && queue.length > 0) {
      actions.play();
    } else if (queue.length > 0) {
      actions.primeCurrentTrackSource?.();
    }
  }

  function renderList() {
    if (!dom.listEl) {
      console.error('Cannot render library list because the element is missing');
      return;
    }

    dom.listEl.innerHTML = '';
    renderCurrentPlaylistName();

    const emptyMessage = document.getElementById('emptyLibraryMsg');
    if (emptyMessage) {
      emptyMessage.style.display = state.files.length === 0 ? 'block' : 'none';
    }
    dom.addAllBtn.style.display = state.files.length === 0 ? 'none' : '';

    const currentPlaylist = getCurrentPlaylist();
    const playlistItems = new Set(currentPlaylist?.items ?? []);
    const orderedEntries = [];
    const normalizedSearchQuery = librarySearchQuery.trim().toLowerCase();

    state.files.forEach((file, itemIndex) => {
      const key = getFileKey(file);

      if (playlistItems.has(key)) {
        return;
      }

      orderedEntries.push({ file, itemIndex });
    });

    (currentPlaylist?.items ?? []).forEach(key => {
      const fileIndex = state.fileIndexByKey.get(key);

      if (typeof fileIndex !== 'number') {
        return;
      }

      orderedEntries.push({
        file: state.files[fileIndex],
        itemIndex: fileIndex,
      });
    });

    orderedEntries.forEach(({ file, itemIndex }) => {
      const key = getFileKey(file);
      const libraryLabel = getDisplayName(key) || file?.name || key || 'Untitled track';

      if (
        normalizedSearchQuery &&
        ![libraryLabel, file?.name, key]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearchQuery)
      ) {
        return;
      }

      const isPersistedToOpfs = state.opfsPersistedTrackKeys.has(key);
      const isPendingOpfsSave = state.opfsPendingTrackKeys.has(key);
      const listItem = document.createElement('li');
      listItem.dataset.fileIndex = String(itemIndex);
      listItem.style.display = 'flex';
      listItem.style.alignItems = 'center';
      listItem.style.gap = '8px';
      listItem.style.padding = '6px 0 6px 8px';

      const inPlaylist = playlistItems.has(key);

      if (inPlaylist) {
        listItem.dataset.playlistKey = key;
      }

      const playlistButton = document.createElement('button');
      playlistButton.style.width = '24px';
      playlistButton.style.height = '24px';
      playlistButton.style.padding = '0';
      playlistButton.style.flexShrink = '0';
      playlistButton.style.fontSize = '16px';
      playlistButton.setAttribute('data-icon', inPlaylist ? 'minus' : 'plus');
      playlistButton.style.touchAction = inPlaylist ? 'none' : '';

      if (inPlaylist) {
        playlistButton.dataset.playlistDrag = '';
        playlistButton.style.color = '#23fd23';
      }

      playlistButton.onclick = event => {
        event.stopPropagation();

        if (inPlaylist) {
          removeTrackFromPlaylist(itemIndex);
        } else {
          addTrackToPlaylist(itemIndex);
        }
      };

      const title = document.createElement('span');
      title.textContent = libraryLabel;
      title.style.cursor = 'pointer';
      title.style.flex = '1';
      title.style.fontSize = '14px';
      title.style.lineHeight = '1.2';
      title.onclick = () => {
        if (itemIndex === state.index && state.isPlaying) {
          actions.pause();
        } else {
          actions.startTrack(itemIndex);
        }
      };

      const opfsDeleteButton = document.createElement('button');
      opfsDeleteButton.style.width = '24px';
      opfsDeleteButton.style.height = '24px';
      opfsDeleteButton.style.fontSize = '14px';
      opfsDeleteButton.style.flexShrink = '0';
      opfsDeleteButton.style.color =
        isPersistedToOpfs ? '#23fd23' : '#e0e0e0';
      opfsDeleteButton.textContent = 'X';
      opfsDeleteButton.title = isPersistedToOpfs
        ? 'Delete from OPFS'
        : isPendingOpfsSave
          ? 'Waiting to save to OPFS'
          : 'Not saved to OPFS';
      opfsDeleteButton.onclick = async event => {
        event.stopPropagation();

        await actions.removeFromLibrary?.(itemIndex);
      };

      listItem.appendChild(playlistButton);
      listItem.appendChild(title);
      listItem.appendChild(opfsDeleteButton);
      dom.listEl.appendChild(listItem);
    });
  }

  function setLibrarySearch(query) {
    librarySearchQuery = query || '';
    renderList();
    void highlight();
  }

  function renderPlaylists() {
    if (!dom.playlistsEl) {
      console.error('Cannot render playlists because the element is missing');
      return;
    }

    dom.playlistsEl.innerHTML = '';
    playlistButtons.clear();
    renderCurrentPlaylistName();

    state.playlists.forEach(playlist => {
      const listItem = document.createElement('li');
      listItem.style.display = 'flex';
      listItem.style.alignItems = 'center';
      listItem.style.gap = '8px';
      listItem.style.padding = '6px 0 6px 8px';

      const selectButton = document.createElement('button');
      selectButton.textContent = playlist.name;
      selectButton.style.background = 'transparent';
      selectButton.style.borderRadius = '8px';
      selectButton.style.width = 'auto';
      selectButton.style.height = '32px';
      selectButton.style.padding = '0';
      selectButton.style.flex = '1';
      selectButton.style.textAlign = 'left';
      selectButton.style.minWidth = '0';
      selectButton.style.justifyContent = 'flex-start';
      selectButton.onclick = () =>
        activatePlaylist(playlist, {
          autoplay: false,
          navigateToLibrary: true,
        });

      if (playlist.id === state.currentPlaylistId) {
        selectButton.style.fontWeight = 'bold';
      }

      const isCurrentPlaylist = playlist.id === state.currentPlaylistId;
      const isPlaylistPlaying = isCurrentPlaylist && state.isPlaying;

      const playPauseButton = document.createElement('button');
      playPauseButton.style.width = '36px';
      playPauseButton.style.height = '36px';
      playPauseButton.style.flexShrink = '0';
      playPauseButton.setAttribute(
        'data-icon',
        isPlaylistPlaying ? 'pause' : 'play'
      );
      playPauseButton.onclick = () => {
        if (isCurrentPlaylist && state.isPlaying) {
          actions.pause();
          return;
        }

        activatePlaylist(playlist, {
          autoplay: true,
        });
      };
      playlistButtons.set(playlist.id, playPauseButton);

      const renameButton = document.createElement('button');
      renameButton.style.width = 'auto';
      renameButton.style.height = '32px';
      renameButton.style.padding = '0 10px';
      renameButton.style.flexShrink = '0';
      renameButton.textContent = 'Rename';
      renameButton.style.fontSize = '12px';
      renameButton.onclick = () => {
        const newName = window.prompt('Rename playlist:', playlist.name);

        if (newName && newName.trim()) {
          playlist.name = newName.trim();
          savePlaylists(state.playlists, state.currentPlaylistId);
          renderPlaylists();
          void highlight();
        }
      };

      const deleteButton = document.createElement('button');
      deleteButton.style.width = '36px';
      deleteButton.style.height = '36px';
      deleteButton.style.flexShrink = '0';
      deleteButton.textContent = 'X';
      deleteButton.onclick = () => {
        if (!window.confirm(`Delete playlist "${playlist.name}"?`)) {
          return;
        }

        const wasCurrentPlaylist = state.currentPlaylistId === playlist.id;
        const playlistIndex = state.playlists.findIndex(
          item => item.id === playlist.id
        );

        if (playlistIndex >= 0) {
          const deletedPlaylistId = state.playlists[playlistIndex].id;
          state.playlists.splice(playlistIndex, 1);
          state.shuffledPlaylistItemsById.delete(deletedPlaylistId);
          removePlaylistState(deletedPlaylistId);
        }

        if (wasCurrentPlaylist) {
          state.currentPlaylistId = state.playlists[0]?.id ?? null;
          resetCurrentTrack(true);
        }

        savePlaylists(state.playlists, state.currentPlaylistId);
        renderPlaylists();
        renderList();
      };

      listItem.appendChild(selectButton);
      listItem.appendChild(playPauseButton);
      listItem.appendChild(renameButton);
      listItem.appendChild(deleteButton);
      dom.playlistsEl.appendChild(listItem);
    });
  }

  function createPlaylist(rawName) {
    const fallbackName = `Playlist ${state.playlists.length + 1}`;
    const name = rawName?.trim() || fallbackName;

    state.playlists.push({
      id: createPlaylistId(),
      name,
      items: [],
    });
    state.currentPlaylistId = state.playlists[state.playlists.length - 1].id;
    savePlaylists(state.playlists, state.currentPlaylistId);
    renderPlaylists();
    renderList();
    actions.kill();
    state.offset = 0;
    state.index = -1;
    clearTrackDisplay(true);
    void highlight();
    savePlayerState();
  }

  return {
    addAllFilesToCurrentPlaylist,
    createPlaylist,
    highlight,
    renderList,
    renderPlaylists,
    resetArtworkSpin,
    restoreCurrentPlaylistTrack,
    setLibrarySearch,
    syncArtworkPlaybackState,
    updatePlaylistsButtons,
  };
}
