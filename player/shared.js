const AUDIO_FILE_PATTERN = /\.(mp3|m4a|wav|ogg|flac)$/i;
export const RESUME_DELAY_MS = 10;
const fileKeyOverrides = new WeakMap();
let cachedDefaultArtwork = null;

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
    return [...playlist.items].sort((leftKey, rightKey) => {
      const leftIndex = state.fileIndexByKey.get(leftKey);
      const rightIndex = state.fileIndexByKey.get(rightKey);
      const leftKnown = typeof leftIndex === 'number';
      const rightKnown = typeof rightIndex === 'number';

      if (leftKnown && rightKnown) {
        return leftIndex - rightIndex;
      }

      if (leftKnown) {
        return -1;
      }

      if (rightKnown) {
        return 1;
      }

      return leftKey.localeCompare(rightKey, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
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
    const indices = getPlaylistItemOrder(state, playlist.id)
      .filter(canPlayTrack)
      .map(key => state.fileIndexByKey.get(key))
      .filter(index => typeof index === 'number');

    return indices;
  }

  return state.files
    .map((file, index) => ({ index, key: getFileKey(file) }))
    .filter(item => canPlayTrack(item.key))
    .map(item => item.index);
}

export function buildDefaultArtwork() {
  if (cachedDefaultArtwork) {
    return cachedDefaultArtwork;
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;

    const context = canvas.getContext('2d');

    if (context) {
      context.fillStyle = '#1a1a1a';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#23fd23';
      context.font =
        '700 280px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('V', canvas.width / 2, 284);
      cachedDefaultArtwork = canvas.toDataURL('image/png');
      return cachedDefaultArtwork;
    }
  }

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    '<rect width="512" height="512" fill="#1a1a1a"/>',
    '<text x="256" y="340" font-family="system-ui,-apple-system,sans-serif" font-size="280" font-weight="700" fill="#23fd23" text-anchor="middle">V</text>',
    '</svg>',
  ].join('');

  cachedDefaultArtwork = `data:image/svg+xml;base64,${window.btoa(svg)}`;
  return cachedDefaultArtwork;
}
