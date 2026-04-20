import { buildDefaultArtwork, createPlaylistId } from './shared.js';

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
  getPlaylistItemOrder,
  extractMetadata,
  savePlaylists,
  loadPlaylistState,
  removePlaylistState,
  savePlayerState,
  queueTracksForAnalysis,
  onNowPlayingMetadata,
  actions,
}) {
  const playlistButtons = new Map();

  function getCurrentPlaylist() {
    return state.playlists.find(playlist => playlist.id === state.currentPlaylistId) ?? null;
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
      dom.trackArtworkEl.style.display = 'none';
      dom.trackArtworkEl.removeAttribute('src');
    }

    if (clearGain && dom.gainInfoEl) {
      dom.gainInfoEl.textContent = '';
    }

    if (dom.trackStartInfoEl) {
      dom.trackStartInfoEl.textContent = '';
      dom.trackStartInfoEl.style.display = 'none';
    }

    if (dom.explicitTrackToggleEl) {
      dom.explicitTrackToggleEl.disabled = true;
      dom.explicitTrackToggleEl.classList.remove('on');
      dom.explicitTrackToggleEl.setAttribute('aria-pressed', 'false');
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

  async function highlight() {
    if (dom.listEl) {
      [...dom.listEl.children].forEach((listItem, itemIndex) => {
        const span = listItem.querySelector('span');

        if (!span) {
          return;
        }

        listItem.style.fontWeight = itemIndex === state.index ? 'bold' : 'normal';

        if (itemIndex === state.index && state.isPlaying) {
          span.style.color = '#23fd23';
        } else if (span.style.color !== '#23fd23' || !state.isPlaying) {
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

    const currentPlaylist = getCurrentPlaylist();
    const playlistName = currentPlaylist?.name ?? 'no playlist';
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
        dom.trackArtworkEl.src = metadata.artwork || buildDefaultArtwork();
        dom.trackArtworkEl.style.display = 'block';
      } else {
        dom.trackArtworkEl.style.display = 'none';
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

    if (dom.playlistViewEl) {
      [...dom.playlistViewEl.children].forEach(item => {
        const span = item.querySelector('span');

        if (!span) {
          return;
        }

        const key = span.getAttribute('data-key');

        if (key === currentTrackKey && state.isPlaying) {
          span.style.color = '#23fd23';
        } else if (span.style.color !== '#999') {
          span.style.color = '';
        }
      });
    }

    onNowPlayingMetadata?.(freshCurrentFile, metadata, playlistName);
  }

  function addTrackToPlaylist(fileIndex) {
    const file = state.files[fileIndex];

    if (!file) {
      console.error(`Cannot add missing file at index ${fileIndex}`);
      return;
    }

    const playlist = ensureDefaultPlaylist();

    if (!playlist) {
      console.error('Cannot add track because no playlist is available');
      return;
    }

    const key = getFileKey(file);
    playlist.items.push(key);
    state.shuffledPlaylistItemsById.delete(playlist.id);
    savePlaylists(state.playlists, state.currentPlaylistId);
    renderPlaylistView();
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

    const existingKeys = new Set(playlist.items);
    const newKeys = [];

    state.files.forEach(file => {
      const key = getFileKey(file);

      if (!existingKeys.has(key)) {
        playlist.items.push(key);
        existingKeys.add(key);
        newKeys.push(key);
      }
    });

    if (newKeys.length === 0) {
      return;
    }

    state.shuffledPlaylistItemsById.delete(playlist.id);
    savePlaylists(state.playlists, state.currentPlaylistId);
    renderPlaylistView();
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
    const indexToRemove = playlist.items.indexOf(key);

    if (indexToRemove === -1) {
      console.warn(`Track "${key}" is not in the current playlist`);
      return;
    }

    const removingCurrentTrack =
      key === (state.files[state.index] ? getFileKey(state.files[state.index]) : null);

    playlist.items.splice(indexToRemove, 1);
    state.shuffledPlaylistItemsById.delete(playlist.id);
    savePlaylists(state.playlists, state.currentPlaylistId);

    if (removingCurrentTrack) {
      resetCurrentTrack(true);
    }

    renderPlaylistView();
    renderList();
  }

  function removeTrackByKey(key) {
    const playlist = getCurrentPlaylist();

    if (!playlist) {
      return;
    }

    const removingCurrentTrack =
      key === (state.files[state.index] ? getFileKey(state.files[state.index]) : null);

    const itemIndex = playlist.items.indexOf(key);

    if (itemIndex === -1) {
      return;
    }

    playlist.items.splice(itemIndex, 1);
    state.shuffledPlaylistItemsById.delete(playlist.id);
    savePlaylists(state.playlists, state.currentPlaylistId);

    if (removingCurrentTrack) {
      resetCurrentTrack(true);
    }

    renderPlaylistView();
    renderList();
  }

  function updatePlaylistsButtons() {
    playlistButtons.forEach((button, playlistId) => {
      const isCurrentPlaylist = playlistId === state.currentPlaylistId;
      const isPlaylistPlaying = isCurrentPlaylist && state.isPlaying;
      button.setAttribute('data-icon', isPlaylistPlaying ? 'pause' : 'play');
    });
  }

  function activatePlaylist(playlist, { autoplay, navigateToPlaylist }) {
    if (state.isPlaying && dom.audioElement) {
      state.offset = dom.audioElement.currentTime || 0;
    }

    savePlayerState();
    state.currentPlaylistId = playlist.id;
    savePlaylists(state.playlists, state.currentPlaylistId);
    actions.kill();
    renderPlaylists();
    renderPlaylistView();
    renderList();

    const queue = restorePlaylistTrack();

    if (navigateToPlaylist) {
      navigation.setScreen(3);
    }

    void highlight();
    queueTracksForAnalysis(playlist.items || []);

    if (autoplay && queue.length > 0) {
      actions.play();
      void highlight();
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

    const emptyMessage = document.getElementById('emptyLibraryMsg');
    if (emptyMessage) {
      emptyMessage.style.display = state.files.length === 0 ? 'block' : 'none';
    }
    dom.addAllBtn.style.display = state.files.length === 0 ? 'none' : '';

    const currentPlaylist = getCurrentPlaylist();
    const playlistItems = new Set(currentPlaylist?.items ?? []);

    state.files.forEach((file, itemIndex) => {
      const key = getFileKey(file);
      const libraryLabel = getDisplayName(key) || file?.name || key || 'Untitled track';
      const isPersistedToOpfs = state.opfsPersistedTrackKeys.has(key);
      const isPendingOpfsSave = state.opfsPendingTrackKeys.has(key);
      const listItem = document.createElement('li');
      listItem.style.display = 'flex';
      listItem.style.alignItems = 'center';
      listItem.style.gap = '8px';
      listItem.style.padding = '6px 0 6px 8px';

      const inPlaylist = playlistItems.has(key);

      const playlistButton = document.createElement('button');
      playlistButton.style.width = '24px';
      playlistButton.style.height = '24px';
      playlistButton.style.padding = '0';
      playlistButton.style.flexShrink = '0';
      playlistButton.style.fontSize = '16px';
      playlistButton.setAttribute('data-icon', inPlaylist ? 'minus' : 'plus');
      playlistButton.title = inPlaylist
        ? 'Remove from current playlist'
        : 'Add to current playlist';

      if (inPlaylist) {
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
          actions.pauseSoft();
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

  function renderPlaylists() {
    if (!dom.playlistsEl) {
      console.error('Cannot render playlists because the element is missing');
      return;
    }

    dom.playlistsEl.innerHTML = '';
    playlistButtons.clear();

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
          navigateToPlaylist: true,
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
          navigateToPlaylist: false,
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
        renderPlaylistView();
        renderList();
      };

      listItem.appendChild(selectButton);
      listItem.appendChild(playPauseButton);
      listItem.appendChild(renameButton);
      listItem.appendChild(deleteButton);
      dom.playlistsEl.appendChild(listItem);
    });
  }

  function renderPlaylistView() {
    if (!dom.playlistViewEl) {
      console.error('Cannot render playlist view because the element is missing');
      return;
    }

    dom.playlistViewEl.innerHTML = '';

    const playlist = getCurrentPlaylist();

    if (!playlist) {
      return;
    }

    getPlaylistItemOrder(state, playlist.id).forEach(key => {
      const listItem = document.createElement('li');
      listItem.style.display = 'flex';
      listItem.style.alignItems = 'center';
      listItem.style.padding = '6px 6px';

      const isAvailable = state.fileIndexByKey.has(key);

      const removeButton = document.createElement('button');
      removeButton.setAttribute('data-icon', 'minus');
      removeButton.style.marginRight = '10px';
      removeButton.style.width = '24px';
      removeButton.style.height = '24px';
      removeButton.style.fontSize = '16px';
      removeButton.style.flexShrink = '0';
      removeButton.onclick = () => removeTrackByKey(key);

      const title = document.createElement('span');
      title.setAttribute('data-key', key);
      title.style.cursor = isAvailable ? 'pointer' : 'default';
      title.style.flex = '1';
      title.style.fontSize = '14px';
      title.style.lineHeight = '1.2';

      if (!isAvailable) {
        title.style.color = '#999';
      }

      const fileIndex = state.fileIndexByKey.get(key);
      const file = typeof fileIndex === 'number' ? state.files[fileIndex] : null;

      if (file) {
        void extractMetadata(file).then(metadata => {
          let label = metadata.title || getDisplayName(key);

          if (metadata.artist) {
            label += ` - ${metadata.artist}`;
          }

          title.textContent = label;
        });
      } else {
        title.textContent = getDisplayName(key);
      }

      title.onclick = () => {
        if (!isAvailable) {
          console.warn(`Track "${key}" is not currently available`);
          return;
        }

        const currentTrackKey = state.files[state.index]
          ? getFileKey(state.files[state.index])
          : null;

        if (key === currentTrackKey && state.isPlaying) {
          actions.pauseSoft();
          return;
        }

        actions.startTrack(state.fileIndexByKey.get(key));
      };

      listItem.appendChild(removeButton);
      listItem.appendChild(title);
      dom.playlistViewEl.appendChild(listItem);
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
    renderPlaylistView();
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
    renderPlaylistView,
    restoreCurrentPlaylistTrack,
    updatePlaylistsButtons,
  };
}
