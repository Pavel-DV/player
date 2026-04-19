import {
  buildFileIndexByKey,
  setFileKey,
} from './shared.js';

function sortFilesByKey(files, getFileKey) {
  return [...files].sort((left, right) =>
    getFileKey(left).localeCompare(getFileKey(right), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

export function createLibraryController({
  state,
  dom,
  isAudioFile,
  getFileKey,
  savePlaylists,
  renderList,
  highlight,
  renderPlaylistView,
  queueTracksForAnalysis,
  onCurrentTrackUnavailable,
  onLibraryLoaded,
}) {
  function migratePlaylistKeys() {
    let changed = false;

    state.playlists.forEach(playlist => {
      playlist.items = playlist.items.map(key => {
        const fileIndex = state.fileIndexByKey.get(key);

        if (typeof fileIndex !== 'number') {
          return key;
        }

        const primaryKey = getFileKey(state.files[fileIndex]);

        if (primaryKey !== key) {
          changed = true;
        }

        return primaryKey;
      });
    });

    if (changed) {
      savePlaylists(state.playlists, state.currentPlaylistId);
    }
  }

  function rebuildLibrary(nextFiles) {
    const currentTrackKey = state.files[state.index]
      ? getFileKey(state.files[state.index])
      : null;
    const orderedFiles = sortFilesByKey(nextFiles, getFileKey);

    state.files = orderedFiles;
    state.fileIndexByKey = buildFileIndexByKey(state.files, getFileKey);
    migratePlaylistKeys();

    if (currentTrackKey) {
      const restoredIndex = state.fileIndexByKey.get(currentTrackKey);

      if (typeof restoredIndex === 'number') {
        state.index = restoredIndex;
      } else {
        state.index = state.files.length > 0 ? 0 : -1;
        state.offset = 0;
        onCurrentTrackUnavailable?.();
      }
    } else {
      state.index = state.files.length > 0 ? 0 : -1;
      state.offset = 0;
    }

    renderList();
    renderPlaylistView();
    void highlight();
    queueTracksForAnalysis(state.files.map(getFileKey));
    onLibraryLoaded?.();
  }

  function prepareInputFiles(files) {
    return files
      .filter(isAudioFile)
      .map(file => setFileKey(file, file.webkitRelativePath || file.name));
  }

  function pickMusicDirectory() {
    dom.fileInput?.click();
    return true;
  }

  function bindFileInput() {
    if (!dom.fileInput) {
      return;
    }

    dom.fileInput.addEventListener('change', event => {
      const selectedFiles = prepareInputFiles(Array.from(event.target.files ?? []));
      event.target.value = '';

      if (selectedFiles.length === 0) {
        return;
      }

      rebuildLibrary(selectedFiles);
    });
  }

  return {
    bindFileInput,
    pickMusicDirectory,
  };
}
