export const AUDIO_FILE_PATTERN = /\.(mp3|m4a|wav|ogg|flac)$/i;
export const MEDIA_SESSION_SYNC_MS = 1000;
export const RESUME_DELAY_MS = 10;
const fileKeyOverrides = new WeakMap();

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

export function getQueueIndices(state) {
  const playlist = state.playlists.find(item => item.id === state.currentPlaylistId);

  if (playlist && Array.isArray(playlist.items) && playlist.items.length > 0) {
    const indices = playlist.items
      .map(key => state.fileIndexByKey.get(key))
      .filter(index => typeof index === 'number');

    if (indices.length > 0) {
      return indices;
    }
  }

  return state.files.map((_, index) => index);
}

export function buildDefaultArtwork() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    '<rect width="512" height="512" fill="#1a1a1a"/>',
    '<text x="256" y="340" font-family="system-ui,-apple-system,sans-serif" font-size="280" font-weight="700" fill="#23fd23" text-anchor="middle">V</text>',
    '</svg>',
  ].join('');

  return `data:image/svg+xml;base64,${window.btoa(svg)}`;
}
