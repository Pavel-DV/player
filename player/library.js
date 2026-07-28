import {
  buildFileIndexByKey,
  setFileKey,
} from './shared.js';

export function createLibraryController({
  state,
  dom,
  isAudioFile,
  getFileKey,
  deletePersistedTrack,
  loadPersistedLibrary,
  persistLibrary,
  remapStoredTrackKeys,
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

  function markTracksPending(files) {
    files.forEach(file => {
      const key = getFileKey(file);

      if (key) {
        state.opfsPendingTrackKeys.add(key);
        state.opfsPersistedTrackKeys.delete(key);
      }
    });
  }

  function getBasename(key) {
    return key?.split(/[\\/]/).filter(Boolean).pop() || key || '';
  }

  function getCleanFileKey(file) {
    return file?.name || getBasename(getFileKey(file));
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

  function remapPlaylistKeys(trackKeyMap) {
    let changed = false;

    state.playlists.forEach(playlist => {
      if (!Array.isArray(playlist.items)) {
        return;
      }

      let playlistChanged = false;
      const seenKeys = new Set();
      const nextItems = [];

      playlist.items.forEach(key => {
        const nextKey = trackKeyMap.get(key) ?? key;

        if (trackKeyMap.has(key)) {
          if (seenKeys.has(nextKey)) {
            playlistChanged = true;
            return;
          }

          seenKeys.add(nextKey);
        }

        if (nextKey !== key) {
          playlistChanged = true;
        }

        nextItems.push(nextKey);
      });

      if (playlistChanged) {
        playlist.items = nextItems;
        state.shuffledPlaylistItemsById.delete(playlist.id);
        changed = true;
      }
    });

    if (changed) {
      savePlaylists(state.playlists, state.currentPlaylistId);
    }
  }

  function rebuildLibrary(nextFiles) {
    const currentTrackKey = state.files[state.index]
      ? getFileKey(state.files[state.index])
      : null;

    state.files = [...nextFiles];
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

  function getNewInputFiles(selectedFiles) {
    const knownKeys = new Set(state.files.map(file => getFileKey(file)));
    const newFiles = [];

    selectedFiles.forEach(file => {
      const key = getFileKey(file);

      if (!key || knownKeys.has(key)) {
        return;
      }

      knownKeys.add(key);
      newFiles.push(file);
    });

    return newFiles;
  }

  function prependFilesToLibrary(newFiles) {
    return [...newFiles, ...state.files];
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

      const newFiles = getNewInputFiles(selectedFiles);

      if (newFiles.length === 0) {
        return;
      }

      const saveSequence = state.opfsSaveSequence + 1;
      const nextFiles = prependFilesToLibrary(newFiles);
      const newKeys = newFiles.map(file => getFileKey(file));

      state.opfsSaveSequence = saveSequence;
      markTracksPending(newFiles);
      rebuildLibrary(nextFiles);
      void persistLibrary?.(nextFiles, {
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
          void highlight();
        },
        writeKeys: newKeys,
      })
        .then(saved => {
          if (!saved || saveSequence !== state.opfsSaveSequence) {
            return;
          }

          markLibraryPersisted(state.files);
          renderList();
          void highlight();
        })
        .catch(error => {
          console.error('Failed to persist library to OPFS:', error);

          if (saveSequence === state.opfsSaveSequence) {
            renderList();
            void highlight();
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
    const wasPersisted = state.opfsPersistedTrackKeys.has(trackKey);
    const remainingFilesPersisted = nextFiles.every(nextFile =>
      state.opfsPersistedTrackKeys.has(getFileKey(nextFile))
    );

    state.opfsSaveSequence = saveSequence;

    state.opfsPendingTrackKeys.delete(trackKey);
    state.opfsPersistedTrackKeys.delete(trackKey);
    state.explicitTrackKeys.delete(trackKey);
    removeTrackKeyFromPlaylists(trackKey);
    renderPlaylists?.();
    rebuildLibrary(nextFiles);

    if (wasPersisted && remainingFilesPersisted && deletePersistedTrack) {
      try {
        await deletePersistedTrack(trackKey);

        if (saveSequence !== state.opfsSaveSequence) {
          return true;
        }

        markLibraryPersisted(nextFiles);
        renderList();
        void highlight();
        return true;
      } catch (error) {
        console.error('Failed to delete library track from OPFS:', error);
        return false;
      }
    }

    markLibraryPending(nextFiles);

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
          void highlight();
        },
      });

      if (saveSequence !== state.opfsSaveSequence) {
        return true;
      }

      markLibraryPersisted(state.files);
      renderList();
      void highlight();
      return true;
    } catch (error) {
      console.error('Failed to persist library after track deletion:', error);
      return false;
    }
  }

  async function removeUnusedTracksFromLibrary() {
    const usedFileIndices = new Set();

    state.playlists.forEach(playlist => {
      (playlist.items ?? []).forEach(key => {
        const fileIndex = state.fileIndexByKey.get(key);

        if (typeof fileIndex === 'number') {
          usedFileIndices.add(fileIndex);
        }
      });
    });

    const trackKeyMap = new Map();
    const nextFiles = state.files.filter((file, index) => {
      if (!usedFileIndices.has(index)) {
        return false;
      }

      const trackKey = getFileKey(file);
      const nextKey = getCleanFileKey(file);

      trackKeyMap.set(trackKey, nextKey);
      trackKeyMap.set(getBasename(trackKey), nextKey);
      setFileKey(file, nextKey);
      return true;
    });
    const removedCount = state.files.length - nextFiles.length;
    const normalizedCount = [...trackKeyMap].filter(
      ([trackKey, nextKey]) => trackKey !== nextKey
    ).length;
    const saveSequence = state.opfsSaveSequence + 1;

    state.opfsSaveSequence = saveSequence;
    state.explicitTrackKeys = new Set(
      [...state.explicitTrackKeys]
        .map(trackKey => trackKeyMap.get(trackKey) ?? trackKey)
        .filter(trackKey =>
          trackKey && nextFiles.some(file => getFileKey(file) === trackKey)
        )
    );
    remapPlaylistKeys(trackKeyMap);
    remapStoredTrackKeys?.(trackKeyMap);
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
          void highlight();
        },
      });

      if (saveSequence === state.opfsSaveSequence) {
        markLibraryPersisted(state.files);
        renderList();
        void highlight();
      }

      return {
        normalizedCount,
        removedCount,
      };
    } catch (error) {
      console.error('Failed to clean unused library tracks:', error);
      renderList();
      void highlight();
      return null;
    }
  }

  return {
    bindFileInput,
    pickMusicDirectory,
    removeTrackFromLibrary,
    removeUnusedTracksFromLibrary,
    restorePersistedLibrary,
  };
}
