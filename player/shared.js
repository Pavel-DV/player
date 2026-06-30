const AUDIO_FILE_PATTERN = /\.(mp3|m4a|wav|ogg|flac)$/i;
const fileKeyOverrides = new WeakMap();
export const DEFAULT_ARTWORK_URL = 'icons/icon512.png';

export function isAudioFile(file) {
  return AUDIO_FILE_PATTERN.test(file?.name ?? '');
}

export function setFileKey(file, key) {
  if (file && key) {
    fileKeyOverrides.set(file, key);
  }

  return file;
}

export function getFileKey(file) {
  return (
    (file ? fileKeyOverrides.get(file) : null) ??
    file?.webkitRelativePath ??
    file?.name ??
    ''
  );
}

export function getDisplayName(filename) {
  return filename ? filename.replace(/\.[^.]+$/, '') : '';
}

export function createPlaylistId() {
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

export function buildFileIndexByKey(files, getKey = getFileKey) {
  const indexByKey = new Map();
  const basenameCounts = new Map();

  files.forEach((file, index) => {
    const key = getKey(file);
    indexByKey.set(key, index);

    const basename = file?.name ?? key;
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  });

  files.forEach((file, index) => {
    const basename = file?.name ?? getKey(file);

    if (basenameCounts.get(basename) === 1 && !indexByKey.has(basename)) {
      indexByKey.set(basename, index);
    }
  });

  return indexByKey;
}

function shuffleItems(items) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function isTrackExplicit(state, trackKey) {
  return Boolean(trackKey && state.explicitTrackKeys?.has(trackKey));
}

export function getPlaylistItemOrder(state, playlistId = state.currentPlaylistId) {
  const playlist = state.playlists.find(item => item.id === playlistId);

  if (!playlist || !Array.isArray(playlist.items) || playlist.items.length === 0) {
    return [];
  }

  if (!state.shuffle) {
    return playlist.items;
  }

  const cachedOrder = state.shuffledPlaylistItemsById.get(playlist.id);

  if (Array.isArray(cachedOrder) && cachedOrder.length === playlist.items.length) {
    return cachedOrder;
  }

  const currentTrackKey =
    playlistId === state.currentPlaylistId && state.files[state.index]
      ? getFileKey(state.files[state.index])
      : null;
  const itemsToShuffle = [...playlist.items];
  const currentTrackPosition =
    currentTrackKey ? itemsToShuffle.indexOf(currentTrackKey) : -1;

  if (currentTrackPosition >= 0) {
    itemsToShuffle.splice(currentTrackPosition, 1);
  }

  const shuffledOrder = shuffleItems(itemsToShuffle);

  if (currentTrackPosition >= 0) {
    shuffledOrder.unshift(currentTrackKey);
  }

  state.shuffledPlaylistItemsById.set(playlist.id, shuffledOrder);
  return shuffledOrder;
}

export function getQueueIndices(state) {
  const playlist = state.playlists.find(item => item.id === state.currentPlaylistId);
  const canPlayTrack = trackKey => state.allowExplicit || !isTrackExplicit(state, trackKey);

  if (playlist && Array.isArray(playlist.items) && playlist.items.length > 0) {
    const playlistItemsOrder = getPlaylistItemOrder(state, playlist.id)
    const canPlayItems = playlistItemsOrder.filter(canPlayTrack)
    const fileIndexes = canPlayItems.map(key => state.fileIndexByKey.get(key))
    const fileIndexesNumbersOnly = fileIndexes.filter(index => typeof index === 'number')

    return fileIndexesNumbersOnly
  }

  return state.files
    .map((file, index) => ({ index, key: getFileKey(file) }))
    .filter(item => canPlayTrack(item.key))
    .map(item => item.index);
}
