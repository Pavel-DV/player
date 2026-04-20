export function getPlayerDom() {
  return {
    audioElement: document.getElementById('audioElement'),
    fileInput: document.getElementById('dir'),
    listEl: document.getElementById('playlist'),
    trackTitleEl: document.getElementById('trackTitle'),
    trackArtistEl: document.getElementById('trackArtist'),
    trackArtworkEl: document.getElementById('trackArtwork'),
    gainInfoEl: document.getElementById('gainInfo'),
    trackStartInfoEl: document.getElementById('trackStartInfo'),
    addAllBtn: document.getElementById('addAllBtn'),
    playlistsEl: document.getElementById('playlists'),
    playlistViewEl: document.getElementById('playlistView'),
    addPlaylistBtn: document.getElementById('addPlaylist'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    normalizeBtn: document.getElementById('normalizeBtn'),
    clearCacheBtn: document.getElementById('clearCacheBtn'),
    screens: [
      document.getElementById('screen1'),
      document.getElementById('screen2'),
      document.getElementById('screen3'),
      document.getElementById('screen4'),
    ].filter(Boolean),
  };
}
