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
  deletePersistedTrack,
  loadPersistedLibrary,
  persistLibrary,
  savePlaylists,
  renderList,
  renderPlaylists,
  highlight,
  queueTracksForAnalysis,
  onCurrentTrackUnavailable,
  onLibraryLoaded,
}) {
  function replaceTrackKeySet(targetSet, keys = []) {
    targetSet.clear();

    keys.forEach(key => {
      if (key) {
        targetSet.add(key);
      }
    });
  }

  function markLibraryPending(files) {
    replaceTrackKeySet(
      state.opfsPendingTrackKeys,
      files.map(file => getFileKey(file))
    );
    state.opfsPersistedTrackKeys.clear();
  }

  function markLibraryPersisted(files) {
    replaceTrackKeySet(
      state.opfsPersistedTrackKeys,
      files.map(file => getFileKey(file))
    );
    state.opfsPendingTrackKeys.clear();
  }

  function removeTrackKeyFromPlaylists(trackKey) {
    let changed = false;

    state.playlists.forEach(playlist => {
      if (!Array.isArray(playlist.items) || playlist.items.length === 0) {
        return;
      }

      const nextItems = playlist.items.filter(key => key !== trackKey);

      if (nextItems.length !== playlist.items.length) {
        playlist.items = nextItems;
        state.shuffledPlaylistItemsById.delete(playlist.id);
        changed = true;
      }
    });

    if (changed) {
      savePlaylists(state.playlists, state.currentPlaylistId);
    }
  }

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

      const saveSequence = state.opfsSaveSequence + 1;
      state.opfsSaveSequence = saveSequence;
      markLibraryPending(selectedFiles);
      rebuildLibrary(selectedFiles);
      void persistLibrary?.(selectedFiles, {
        onFileSaved: key => {
          if (
            saveSequence !== state.opfsSaveSequence ||
            !key ||
            !state.fileIndexByKey.has(key)
          ) {
            return;
          }

          state.opfsPendingTrackKeys.delete(key);
          state.opfsPersistedTrackKeys.add(key);
          renderList();
        },
      })
        .then(saved => {
          if (!saved || saveSequence !== state.opfsSaveSequence) {
            return;
          }

          markLibraryPersisted(state.files);
          renderList();
        })
        .catch(error => {
          console.error('Failed to persist library to OPFS:', error);

          if (saveSequence === state.opfsSaveSequence) {
            renderList();
          }
        });
    });
  }

  async function restorePersistedLibrary() {
    const persistedFiles = await loadPersistedLibrary?.();

    if (!Array.isArray(persistedFiles) || persistedFiles.length === 0) {
      state.opfsPendingTrackKeys.clear();
      state.opfsPersistedTrackKeys.clear();
      return false;
    }

    state.opfsSaveSequence += 1;
    markLibraryPersisted(persistedFiles);
    rebuildLibrary(persistedFiles);
    return true;
  }

  async function removeTrackFromLibrary(trackIndex) {
    const file = state.files[trackIndex];

    if (!file) {
      return false;
    }

    const trackKey = getFileKey(file);
    const nextFiles = state.files.filter((_, index) => index !== trackIndex);
    const saveSequence = state.opfsSaveSequence + 1;

    state.opfsSaveSequence = saveSequence;

    state.opfsPendingTrackKeys.delete(trackKey);
    state.opfsPersistedTrackKeys.delete(trackKey);
    state.explicitTrackKeys.delete(trackKey);
    removeTrackKeyFromPlaylists(trackKey);
    renderPlaylists?.();
    markLibraryPending(nextFiles);
    rebuildLibrary(nextFiles);

    try {
      await persistLibrary?.(nextFiles, {
        onFileSaved: key => {
          if (
            saveSequence !== state.opfsSaveSequence ||
            !key ||
            !state.fileIndexByKey.has(key)
          ) {
            return;
          }

          state.opfsPendingTrackKeys.delete(key);
          state.opfsPersistedTrackKeys.add(key);
          renderList();
        },
      });

      if (saveSequence !== state.opfsSaveSequence) {
        return true;
      }

      markLibraryPersisted(state.files);
      renderList();
      return true;
    } catch (error) {
      console.error('Failed to persist library after track deletion:', error);
      return false;
    }
  }

  return {
    bindFileInput,
    pickMusicDirectory,
    removeTrackFromLibrary,
    restorePersistedLibrary,
  };
}
