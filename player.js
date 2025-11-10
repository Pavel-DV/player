const audioElement = document.getElementById('audioElement');
const fileInput = document.getElementById('dir');
const listEl = document.getElementById('playlist');
const trackTitleEl = document.getElementById('trackTitle');
const gainInfoEl = document.getElementById('gainInfo');
const playlistsEl = document.getElementById('playlists');
const playlistViewEl = document.getElementById('playlistView');
const addPlaylistBtn = document.getElementById('addPlaylist');
const shuffleBtn = document.getElementById('shuffleBtn');
const normalizeBtn = document.getElementById('normalizeBtn');
let currentScreen = 1;
let touchStartX = 0;
let touchStartY = 0;
let touchActive = false;
let touchScrollable = null;
const screens = [
  document.getElementById('screen1'),
  document.getElementById('screen2'),
  document.getElementById('screen3'),
  document.getElementById('screen4'),
].filter(Boolean);

let index = 0;
let isPlaying = false;
let offset = 0;
let playSequence = 0;
let shuffle = false;
let normalize = false;
let files = [];
let playlists = [];
let currentPlaylistId = null;
let fileIndexByKey = new Map();
const playlistsButtons = new Map();
const metadataCache = new Map();

const analysisQueue = [];
let isAnalyzing = false;

let audioContext = null;

let gainNode = null;
let audioSourceNode = null;

function setupMediaSessionHandlers() {
  console.log('🎵 Setting up Media Session handlers');
  
  navigator.mediaSession.setActionHandler('play', () => {
    play();
  });
  
  navigator.mediaSession.setActionHandler('pause', () => {
    pause();
  });
  
  navigator.mediaSession.setActionHandler('previoustrack', prev);
  navigator.mediaSession.setActionHandler('nexttrack', next);
  
  try { navigator.mediaSession.setActionHandler('stop', pause); } catch (e) { console.warn('⚠️ stop handler not supported:', e); }

  try {
    navigator.mediaSession.setActionHandler('seekbackward', () => { 
      console.log('seekbackward function');
      audioElement.currentTime = Math.max(0, audioElement.currentTime - 10); 
    });
  } catch (e) { console.warn('⚠️ seekbackward handler not supported:', e); }

  try {
    navigator.mediaSession.setActionHandler('seekforward', () => { 
      console.log('seekforward function');
      audioElement.currentTime = Math.min(audioElement.duration || audioElement.currentTime + 10, audioElement.currentTime + 10); 
    });
  } catch (e) { console.warn('⚠️ seekforward handler not supported:', e); }

  try {
    navigator.mediaSession.setActionHandler('seekto', (e) => {
      console.log('seekto function');
      if (typeof e.seekTime === 'number') audioElement.currentTime = Math.max(0, e.seekTime);
    });
  } catch (e) { console.warn('⚠️ seekto handler not supported:', e); }
}

function initWebAudio() {
  if (audioContext) return;

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;

    audioContext = new AudioContext();
    
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    // STEP 1: Route audio element through Web Audio API for gain control (PRIMARY SOURCE)
    gainNode = audioContext.createGain();
    gainNode.gain.value = 1;
    audioSourceNode = audioContext.createMediaElementSource(audioElement);
    audioSourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
  } catch (e) {
    console.error('Web Audio init failed:', e);
  }
}

function getQueueIndices() {
  const p = playlists.find(x => x.id === currentPlaylistId);
  if (p && Array.isArray(p.items) && p.items.length) {
    const idxs = p.items.map(key => fileIndexByKey.get(key)).filter(i => typeof i === 'number');
    if (idxs.length) return idxs;
  }
  return files.map((_, i) => i);
}

function getFileKey(file) {
  return file ? file.name : '';
}

function getDisplayName(filename) {
  return filename ? filename.replace(/\.[^.]+$/, '') : '';
}

function startTrack(i) {
  if (typeof i !== 'number') {
    console.error('❌ startTrack: invalid track index:', i);
    return;
  }
  index = i;
  offset = 0;
  kill();
  play();
  highlight();
}

function previewTrack(i) {
  if (typeof i !== 'number') {
    console.error('❌ previewTrack: invalid track index:', i);
    return;
  }
  index = i;
  offset = 0;
  highlight();
}

fileInput.onchange = (event) => {
  const selectedFiles = Array.from(event.target.files).filter(
    file => /(\.mp3|\.m4a|\.wav|\.ogg|\.flac)$/i.test(file.name)
  );
  
  const currentTrackKey = files[index] ? getFileKey(files[index]) : null;
  const wasPlaying = isPlaying;
  
  // Append new files to existing ones
  const startIdx = files.length;
  files = [...files, ...selectedFiles];
  
  // Rebuild index map
  const trackNames = files.map(getFileKey);
  fileIndexByKey = new Map(trackNames.map((k, i) => [k, i]));
  
  // Restore current track index if it was playing
  if (currentTrackKey) {
    const newIdx = fileIndexByKey.get(currentTrackKey);
    if (typeof newIdx === 'number') {
      index = newIdx;
    }
  }
  
  renderList();
  highlight();
  renderPlaylistView();
  
  // Queue current playlist tracks for analysis
  const currentPlaylist = playlists.find(p => p.id === currentPlaylistId);
  if (currentPlaylist && Array.isArray(currentPlaylist.items)) {
    queueTracksForAnalysis(currentPlaylist.items);
  }
  
  // Reset input so same folder can be selected again
  event.target.value = '';
};

function renderList() {
  if (!listEl) {
    console.error('❌ renderList: listEl not found');
    return;
  }
  listEl.innerHTML = '';
  const emptyMsg = document.getElementById('emptyLibraryMsg');
  if (emptyMsg) {
    emptyMsg.style.display = files.length === 0 ? 'block' : 'none';
  }
  const current = playlists.find(x => x.id === currentPlaylistId);
  const inSet = new Set(current ? current.items : []);
  files.forEach((file, itemIndex) => {
    const name = getFileKey(file);
    const listItemEl = document.createElement('li');
    listItemEl.style.display = 'flex';
    listItemEl.style.alignItems = 'center';
    listItemEl.style.gap = '8px';
    listItemEl.style.padding = '6px 0 6px 8px';
    
    const addBtn = document.createElement('button');
    addBtn.style.width = '24px';
    addBtn.style.height = '24px';
    addBtn.style.fontSize = '16px';
    addBtn.style.flexShrink = '0';
    const inPlaylist = inSet.has(name);
    addBtn.setAttribute('data-icon', inPlaylist ? 'minus' : 'plus');
    if (inPlaylist) {
      addBtn.style.color = '#23fd23';
    }
    addBtn.onclick = (e) => { 
      e.stopPropagation(); 
      if (inPlaylist) {
        removeTrackFromPlaylist(itemIndex);
      } else {
        addTrackToPlaylist(itemIndex);
      }
    };
    
    const playSpan = document.createElement('span');
    playSpan.textContent = name;
    playSpan.style.cursor = 'pointer';
    playSpan.style.flex = '1';
    playSpan.style.fontSize = '14px';
    playSpan.style.lineHeight = '1.2';
    playSpan.onclick = () => { 
      if (itemIndex === index && isPlaying) {
        pause();
      } else {
        startTrack(itemIndex);
      }
    };
    
    listItemEl.appendChild(addBtn);
    listItemEl.appendChild(playSpan);
    listEl.appendChild(listItemEl);
  });
}

async function highlight() {
  if (listEl) {
    [...listEl.children].forEach((listItemEl, itemIndex) => {
      const span = listItemEl.querySelector('span');
      if (span) {
        listItemEl.style.fontWeight = itemIndex === index ? 'bold' : 'normal';
        if (itemIndex === index && isPlaying) {
          span.style.color = '#23fd23';
        } else if (span.style.color !== '#23fd23' || !isPlaying) {
          span.style.color = '';
        }
      }
    });
  }
  
  const file = files[index];
  const trackName = file ? getFileKey(file) : '—';
  const metadata = file ? await extractMetadata(file) : { title: null, artist: null };
  
  if (trackTitleEl) {
    if (file) {
      let display = metadata.title || getDisplayName(trackName);
      if (metadata.artist) display += ` - ${metadata.artist}`;
      trackTitleEl.textContent = display;
      trackTitleEl.style.color = isPlaying ? '#23fd23' : '';
    } else {
      trackTitleEl.textContent = '—';
      trackTitleEl.style.color = '';
    }
  }
  
  if (playlistViewEl) {
    const currentKey = file ? getFileKey(file) : null;
    [...playlistViewEl.children].forEach(li => {
      const span = li.querySelector('span');
      if (!span) return;
      const key = span.getAttribute('data-key');
      if (key === currentKey && isPlaying) {
        span.style.color = '#23fd23';
      } else if (span.style.color !== '#999') {
        span.style.color = '';
      }
    });
  }

  if (file) {
    const currentPlaylist = playlists.find(p => p.id === currentPlaylistId);
    const playlistName = currentPlaylist ? currentPlaylist.name : '####### DELETE ME #######';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata.title || getDisplayName(trackName),
      artist: metadata.artist || playlistName,
      album: playlistName,
      artwork: [
        { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', sizes: '96x96', type: 'image/png' }
      ]
    });
    const now = Date.now();
    if (now - lastMediaSessionSync > MEDIA_SESSION_SYNC_MS) {
      lastMediaSessionSync = now;
      syncMediaSession();
    }
  }
}

// Keep Media Session position/state in sync for lock screen / car controls
function syncMediaSession() {
  try {
    const duration = Number.isFinite(audioElement.duration) && audioElement.duration > 0 ? audioElement.duration : 0;
    const position = Number.isFinite(audioElement.currentTime) && audioElement.currentTime >= 0 ? audioElement.currentTime : 0;
    const rate = audioElement.playbackRate || 1;
    if (duration > 0) {
      navigator.mediaSession.setPositionState({ 
        duration: Math.max(0, duration), 
        playbackRate: Math.max(0.1, rate), 
        position: Math.max(0, Math.min(position, duration))
      });
    }
    navigator.mediaSession.playbackState = audioElement.paused ? 'paused' : 'playing';
  } catch (e) {
    console.error('syncMediaSession error:', e);
  }
}

// Throttled position sync for lock screen/car progress bar
let lastMediaSessionSync = 0;
const MEDIA_SESSION_SYNC_MS = 1000;

function renderPlaylists() {
  if (!playlistsEl) {
    console.error('❌ renderPlaylists: playlistsEl not found');
    return;
  }
  playlistsEl.innerHTML = '';
  playlistsButtons.clear();
  playlists.forEach(p => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.gap = '8px';
    li.style.padding = '6px 0 6px 8px';
    const selectBtn = document.createElement('button');
    selectBtn.textContent = p.name;
    selectBtn.style.background = 'transparent';
    selectBtn.style.borderRadius = '8px';
    selectBtn.style.width = 'auto';
    selectBtn.style.height = '32px';
    selectBtn.style.padding = '0';
    selectBtn.style.flex = '1';
    selectBtn.style.textAlign = 'left';
    selectBtn.style.minWidth = '0';
    selectBtn.style.justifyContent = 'flex-start';
    selectBtn.onclick = () => {
      if (isPlaying) offset = audioElement.currentTime || 0;
      savePlayerState();
      currentPlaylistId = p.id;
      savePlaylists();
      kill();
      updatePlaylistsButtons();
      renderPlaylists();
      renderPlaylistView();
      renderList();
      setScreen(3);
      const savedState = loadPlayerState(p.id);
      if (savedState.trackKey) {
        const savedIdx = fileIndexByKey.get(savedState.trackKey);
        if (typeof savedIdx === 'number') {
          index = savedIdx;
          offset = savedState.offset || 0;
        } else {
          index = fileIndexByKey.get(p.items[0]) || 0;
          offset = 0;
        }
      } else {
        index = fileIndexByKey.get(p.items[0]) || 0;
        offset = 0;
      }
      highlight();
      queueTracksForAnalysis(p.items || []);
    };
    if (p.id === currentPlaylistId) selectBtn.style.fontWeight = 'bold';
    
    const isCurrentPlaylist = p.id === currentPlaylistId;
    const playlistPlaying = isCurrentPlaylist && isPlaying;
    const playPauseBtn = document.createElement('button');
    playPauseBtn.style.width = '36px';
    playPauseBtn.style.height = '36px';
    playPauseBtn.style.flexShrink = '0';
    playPauseBtn.setAttribute('data-icon', playlistPlaying ? 'pause' : 'play');
    playPauseBtn.onclick = () => {
      if (p.id === currentPlaylistId && isPlaying) {
        pause();
      } else {
        if (isPlaying) offset = audioElement.currentTime || 0;
        savePlayerState();
        currentPlaylistId = p.id;
        savePlaylists();
        renderPlaylists();
        renderPlaylistView();
        renderList();
        kill();
        const savedState = loadPlayerState(p.id);
        const queue = getQueueIndices();
        if (queue.length) {
          if (savedState.trackKey) {
            const savedIdx = fileIndexByKey.get(savedState.trackKey);
            if (typeof savedIdx === 'number' && queue.includes(savedIdx)) {
              index = savedIdx;
              offset = savedState.offset || 0;
            } else {
              index = queue[0];
              offset = 0;
            }
          } else {
            index = queue[0];
            offset = 0;
          }
          play();
          highlight();
        } else {
          if (trackTitleEl) trackTitleEl.textContent = '—';
        }
        queueTracksForAnalysis(p.items || []);
      }
    };
    playlistsButtons.set(p.id, playPauseBtn);
    
    const renameBtn = document.createElement('button');
    renameBtn.style.width = '36px';
    renameBtn.style.height = '36px';
    renameBtn.style.flexShrink = '0';
    renameBtn.textContent = '✎';
    renameBtn.onclick = () => {
      const newName = prompt('Rename playlist:', p.name);
      if (newName && newName.trim()) {
        p.name = newName.trim();
        savePlaylists();
        renderPlaylists();
      }
    };
    const deleteBtn = document.createElement('button');
    deleteBtn.style.width = '36px';
    deleteBtn.style.height = '36px';
    deleteBtn.style.flexShrink = '0';
    deleteBtn.textContent = '×';
    deleteBtn.onclick = () => {
      if (!confirm(`Delete playlist "${p.name}"?`)) return;
      const wasCurrentPlaylist = currentPlaylistId === p.id;
      const idx = playlists.findIndex(x => x.id === p.id);
      if (idx >= 0) {
        const deletedId = playlists[idx].id;
        playlists.splice(idx, 1);
        
        // Remove player state for deleted playlist
        try {
          const states = JSON.parse(localStorage.getItem('playerStates') || '{}');
          delete states[deletedId];
          localStorage.setItem('playerStates', JSON.stringify(states));
        } catch (e) {
          console.error('❌ Failed to remove player state:', e);
        }
      }
      if (wasCurrentPlaylist) {
        kill();
        offset = 0;
        index = 0;
        currentPlaylistId = (playlists[0] && playlists[0].id) || null;
        if (trackTitleEl) trackTitleEl.textContent = '—';
        savePlayerState();
      }
      savePlaylists();
      renderPlaylists();
      renderPlaylistView();
      renderList();
    };
    li.appendChild(selectBtn);
    li.appendChild(playPauseBtn);
    li.appendChild(renameBtn);
    li.appendChild(deleteBtn);
    playlistsEl.appendChild(li);
  });
}

function updatePlaylistsButtons() {
  playlistsButtons.forEach((btn, playlistId) => {
    const isCurrentPlaylist = playlistId === currentPlaylistId;
    const playlistPlaying = isCurrentPlaylist && isPlaying;
    btn.setAttribute('data-icon', playlistPlaying ? 'pause' : 'play');
  });
}

function renderPlaylistView() {
  if (!playlistViewEl) {
    console.error('❌ renderPlaylistView: playlistViewEl not found');
    return;
  }
  playlistViewEl.innerHTML = '';
  const p = playlists.find(x => x.id === currentPlaylistId);
  if (!p) {
    console.warn('⚠️ renderPlaylistView: current playlist not found');
    return;
  }
  
  p.items.forEach((key, idx) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.padding = '6px 6px';
    const isAvailable = fileIndexByKey.has(key);
    
    const rmBtn = document.createElement('button');
    rmBtn.setAttribute('data-icon', 'minus');
    rmBtn.style.marginRight = '10px';
    rmBtn.style.width = '24px';
    rmBtn.style.height = '24px';
    rmBtn.style.fontSize = '16px';
    rmBtn.style.flexShrink = '0';
    rmBtn.onclick = () => {
      const removingCurrentTrack = key === (files[index] ? getFileKey(files[index]) : null);
      
      p.items.splice(idx, 1);
      savePlaylists();
      
      if (removingCurrentTrack) {
        kill();
        offset = 0;
        index = 0;
        if (trackTitleEl) trackTitleEl.textContent = '—';
        if (gainInfoEl) gainInfoEl.textContent = '';
        highlight();
        savePlayerState();
      }
      
      renderPlaylistView();
      renderList();
    };
    
    const span = document.createElement('span');
    span.setAttribute('data-key', key);
    span.style.cursor = isAvailable ? 'pointer' : 'default';
    span.style.flex = '1';
    span.style.fontSize = '14px';
    span.style.lineHeight = '1.2';
    if (!isAvailable) {
      span.style.color = '#999';
    }
    
    // Load and display metadata
    const fileIdx = fileIndexByKey.get(key);
    if (fileIdx !== undefined && files[fileIdx]) {
      extractMetadata(files[fileIdx]).then(meta => {
        let display = meta.title || getDisplayName(key);
        if (meta.artist) display += ` - ${meta.artist}`;
        span.textContent = display;
      });
    } else {
      span.textContent = getDisplayName(key);
    }
    
    span.onclick = () => {
      if (!isAvailable) {
        console.warn('⚠️ Track not available:', key);
        return;
      }
      const nowCurrentKey = files[index] ? getFileKey(files[index]) : null;
      if (key === nowCurrentKey && isPlaying) {
        pause();
      } else {
        startTrack(fileIndexByKey.get(key));
      }
    };
    
    li.appendChild(rmBtn);
    li.appendChild(span);
    playlistViewEl.appendChild(li);
  });
}

function addTrackToPlaylist(fileIdx) {
  if (!files[fileIdx]) {
    console.error('❌ addTrackToPlaylist: file not found at index', fileIdx);
    return;
  }
  if (!currentPlaylistId) ensureDefaultPlaylist();
  const p = playlists.find(x => x.id === currentPlaylistId);
  if (!p) {
    console.error('❌ addTrackToPlaylist: current playlist not found');
    return;
  }
  const key = getFileKey(files[fileIdx]);
  p.items.push(key);
  savePlaylists();
  renderPlaylistView();
  renderList();
  highlight();
  queueTracksForAnalysis([key]);
}

function addAllFilesToCurrentPlaylist() {
  if (!files.length) return;
  if (!currentPlaylistId) ensureDefaultPlaylist();
  const p = playlists.find(x => x.id === currentPlaylistId);
  if (!p) return;
  const existing = new Set(p.items);
  const newKeys = [];
  files.forEach(file => {
    const key = getFileKey(file);
    if (!existing.has(key)) {
      p.items.push(key);
      existing.add(key);
      newKeys.push(key);
    }
  });
  if (!newKeys.length) return;
  savePlaylists();
  renderPlaylistView();
  renderList();
  highlight();
  queueTracksForAnalysis(newKeys);
}

function removeTrackFromPlaylist(fileIdx) {
  if (!files[fileIdx]) {
    console.error('❌ removeTrackFromPlaylist: file not found at index', fileIdx);
    return;
  }
  const p = playlists.find(x => x.id === currentPlaylistId);
  if (!p) {
    console.error('❌ removeTrackFromPlaylist: current playlist not found');
    return;
  }
  const key = getFileKey(files[fileIdx]);
  const idx = p.items.indexOf(key);
  if (idx === -1) {
    console.warn('⚠️ removeTrackFromPlaylist: track not in playlist:', key);
    return;
  }
  
  const removingCurrentTrack = key === (files[index] ? getFileKey(files[index]) : null);
  const wasPlaying = removingCurrentTrack && isPlaying;
  
  p.items.splice(idx, 1);
  savePlaylists();
  
  if (removingCurrentTrack) {
    kill();
    offset = 0;
    index = 0;
    if (trackTitleEl) trackTitleEl.textContent = '—';
    if (gainInfoEl) gainInfoEl.textContent = '';
    highlight();
    savePlayerState();
  }
  
  renderPlaylistView();
  renderList();
}

function ensureDefaultPlaylist() {
  if (playlists.length === 0) {
    playlists.push({ id: String(Date.now()), name: 'Playlist 1', items: [] });
  }
  currentPlaylistId = playlists[0].id;
  savePlaylists();
  renderPlaylists();
}

function savePlaylists() {
  try {
    localStorage.setItem('playlists', JSON.stringify({ playlists, currentPlaylistId }));
  } catch (e) {
    console.error('❌ Failed to save playlists:', e);
  }
}

function saveSettings() {
  try {
    localStorage.setItem('settings', JSON.stringify({ shuffle, normalize }));
  } catch (e) {
    console.error('❌ Failed to save settings:', e);
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('settings');
    if (raw) {
      const data = JSON.parse(raw);
      setShuffle(!!data.shuffle);
      setNormalize(!!data.normalize);
      return;
    }
  } catch (e) {
    console.error('❌ Failed to load settings:', e);
  }
  setShuffle(false);
  setNormalize(false);
}

function savePlayerState() {
  if (!currentPlaylistId) {
    console.warn('⚠️ savePlayerState: no current playlist ID');
    return;
  }
  const trackKey = files[index] ? getFileKey(files[index]) : null;
  try {
    const allStates = JSON.parse(localStorage.getItem('playlistStates') || '{}');
    allStates[currentPlaylistId] = { trackKey, offset };
    localStorage.setItem('playlistStates', JSON.stringify(allStates));
  } catch (e) {
    console.error('❌ Failed to save player state:', e);
  }
}

function loadPlayerState(playlistId) {
  try {
    const allStates = JSON.parse(localStorage.getItem('playlistStates') || '{}');
    if (allStates[playlistId]) {
      return allStates[playlistId];
    }
  } catch (e) {
    console.error('❌ Failed to load player state:', e);
  }
  return { trackKey: null, offset: 0 };
}


function loadNormInfo(trackKey) {
  try {
    const all = JSON.parse(localStorage.getItem('normInfo') || '{}');
    return all[trackKey] || null;
  } catch (e) {
    console.error('❌ Failed to load norm info:', e);
  }
  return null;
}

function saveNormInfo(trackKey, peak) {
  try {
    const all = JSON.parse(localStorage.getItem('normInfo') || '{}');
    all[trackKey] = peak;
    localStorage.setItem('normInfo', JSON.stringify(all));
  } catch (e) {
    console.error('❌ Failed to save norm info:', e);
  }
}


async function analyzePeakWithWebAudio(file) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.warn('⚠️ analyzePeakWithWebAudio: AudioContext not available');
      return null;
    }
    const ctx = new Ctx();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await new Promise((resolve, reject) => ctx.decodeAudioData(arrayBuffer, resolve, reject));
    const peak = analyzePeak(audioBuffer);
    try { ctx.close(); } catch (e) { console.warn('⚠️ Failed to close audio context:', e); }
    return peak;
  } catch (e) {
    console.error('❌ analyzePeakWithWebAudio failed:', e);
    return null;
  }
}

async function processAnalysisQueue() {
  if (isAnalyzing || analysisQueue.length === 0) return;
  isAnalyzing = true;
  
  while (analysisQueue.length > 0) {
    const trackKey = analysisQueue.shift();
    const fileIdx = fileIndexByKey.get(trackKey);
    if (fileIdx === undefined || !files[fileIdx]) {
      console.warn('⚠️ processAnalysisQueue: file not found for', trackKey);
      continue;
    }
    
    const cached = loadNormInfo(trackKey);
    if (cached) continue;
    
    const peak = await analyzePeakWithWebAudio(files[fileIdx]);
    if (typeof peak === 'number' && peak > 0) {
      saveNormInfo(trackKey, peak);
      
      // Update volume if this is the currently playing track
      const currentFile = files[index];
      if (currentFile && getFileKey(currentFile) === trackKey) {
        applyVolumeForCurrentTrack();
      }
    }
  }
  
  isAnalyzing = false;
}

function queueTracksForAnalysis(trackKeys) {
  const newKeys = trackKeys.filter(key => {
    const cached = loadNormInfo(key);
    return !cached && !analysisQueue.includes(key);
  });
  analysisQueue.push(...newKeys);
  processAnalysisQueue();
}

function loadPlaylists() {
  try {
    const raw = localStorage.getItem('playlists');
    if (raw) {
      const data = JSON.parse(raw);
      playlists = Array.isArray(data.playlists) ? data.playlists : [];
      currentPlaylistId = data.currentPlaylistId || (playlists[0] && playlists[0].id) || null;
    }
  } catch (e) {
    console.error('❌ Failed to load playlists:', e);
  }
  renderPlaylists();
  renderPlaylistView();
}

function analyzePeak(buffer) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

async function extractMetadata(file) {
  const key = getFileKey(file);
  if (metadataCache.has(key)) return metadataCache.get(key);
  
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    let metadata = { title: null, artist: null };
    
    // Check ID3v2
    if (view.byteLength > 10 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
      const size = ((view.getUint8(6) & 0x7f) << 21) | ((view.getUint8(7) & 0x7f) << 14) | ((view.getUint8(8) & 0x7f) << 7) | (view.getUint8(9) & 0x7f);
      let pos = 10;
      const end = Math.min(10 + size, view.byteLength);
      
      while (pos + 10 < end) {
        const frameId = String.fromCharCode(view.getUint8(pos), view.getUint8(pos+1), view.getUint8(pos+2), view.getUint8(pos+3));
        const frameSize = view.getUint32(pos + 4);
        pos += 10;
        if (frameSize === 0 || pos + frameSize > end) break;
        
        if (frameId === 'TIT2' || frameId === 'TPE1') {
          const encoding = view.getUint8(pos);
          let text = '';
          if (encoding === 0 || encoding === 3) {
            for (let i = pos + 1; i < pos + frameSize; i++) {
              const c = view.getUint8(i);
              if (c === 0) break;
              text += String.fromCharCode(c);
            }
          } else if (encoding === 1) {
            const decoder = new TextDecoder('utf-16le');
            text = decoder.decode(new Uint8Array(buffer, pos + 3, frameSize - 3)).replace(/\0.*$/, '');
          }
          if (frameId === 'TIT2') metadata.title = text;
          if (frameId === 'TPE1') metadata.artist = text;
        }
        pos += frameSize;
      }
    }
    
    metadataCache.set(key, metadata);
    return metadata;
  } catch (e) {
    console.warn('⚠️ Failed to extract metadata for', key, ':', e);
    return { title: null, artist: null };
  }
}



function kill() {
  if (!isPlaying) {
    console.log('⚠️ kill: nothing to kill, playback already stopped');
    return;
  }
  isPlaying = false;
  // audioElement.pause();
  audioElement.src = '';
}

function applyVolumeForCurrentTrack() {
  const file = files[index];
  if (!file) {
    console.warn('⚠️ applyVolumeForCurrentTrack: no file at current index', index);
    return;
  }
  const trackKey = getFileKey(file);
  
  if (!normalize) {
    gainNode.gain.value = 1;
    if (gainInfoEl) gainInfoEl.textContent = '';
    return;
  }

  const peak = loadNormInfo(trackKey);

  if (typeof peak === 'number' && peak > 0) {
    const multiplier = Math.min(1 / peak, 10);
    gainNode.gain.value = multiplier;
    if (gainInfoEl) gainInfoEl.textContent = `Gain: ${multiplier.toFixed(2)}x`;
  } else {
    gainNode.gain.value = 1;
    if (gainInfoEl) gainInfoEl.textContent = '';
  }
}

function play() {
  console.log('play function');

  if (isPlaying) {
    console.log('⚠️ play: already playing');
    return;
  }
  initWebAudio();
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const file = files[index];
  if (!file) {
    console.error('❌ play: no file at current index', index);
    return;
  }
  
  const hasSrc = audioElement.src && audioElement.src.startsWith('blob:');
  if (hasSrc && audioElement.paused && !audioElement.ended) {
    try {
      audioElement.currentTime = Number.isFinite(offset) ? offset : audioElement.currentTime || 0;
    } catch (e) {
      console.error('Set current time failed:', e);
    }
    if (gainNode) audioElement.volume = 1.0;
    // applyVolumeForCurrentTrack();
    // setupMediaSessionHandlers();
    const playPromise = audioElement.play();
    // playPromise.then(() => {
    //   isPlaying = true;
    //   highlight();
    //   updatePlaylistsButtons();
    //   syncMediaSession();
    // }).catch(e => console.error('Play failed:', e));
    return;
  }

  const sequenceId = ++playSequence;
  const blobUrl = URL.createObjectURL(file);
  audioElement.src = blobUrl;
  audioElement.currentTime = offset;
  if (gainNode) audioElement.volume = 1.0;
  // applyVolumeForCurrentTrack();

  // Ensure Media Session handlers are ready BEFORE we start playback so that lock-screen controls work right away
  // setupMediaSessionHandlers();

  audioElement.play();
  audioElement.onended = () => {
    if (sequenceId !== playSequence) return;
    isPlaying = false;
    offset = 0;
    try { navigator.mediaSession.playbackState = 'paused'; } catch (e) { console.error('❌ Failed to set playback state:', e); }
    highlight();
    next();
  };
  // isPlaying = true;
  // try { navigator.mediaSession.playbackState = 'playing'; } catch (e) { console.error('❌ Failed to set playback state:', e); }
  // highlight();
  // updatePlaylistsButtons();
  // syncMediaSession();
}

function pause() {
  console.log('⏸ PAUSE function');

  if (!isPlaying) {
    console.log('ℹ️ pause: not playing, calling play instead');
    play();
    return;
  }

  offset = audioElement.currentTime || 0;
  audioElement.src = URL.createObjectURL(files[index]);

  isPlaying = false;
  highlight();
  updatePlaylistsButtons();
  savePlayerState();
  syncMediaSession();
}

function next() {
  console.log('next function');

  const q = getQueueIndices();
  if (!q.length) {
    console.warn('⚠️ next: queue is empty');
    return;
  }
  kill();
  const pos = q.indexOf(index);
  if (shuffle) {
    let nextPos = Math.floor(Math.random() * q.length);
    if (q.length > 1 && nextPos === pos) nextPos = (nextPos + 1) % q.length;
    index = q[nextPos];
  } else {
    const nextPos = pos >= 0 ? (pos + 1) % q.length : 0;
    index = q[nextPos];
  }
  offset = 0;
  play();
}

function prev() {
  console.log('prev function');

  const q = getQueueIndices();
  if (!q.length) {
    console.warn('⚠️ prev: queue is empty');
    return;
  }
  kill();
  const pos = q.indexOf(index);
  const prevPos = pos >= 0 ? (pos - 1 + q.length) % q.length : 0;
  index = q[prevPos];
  offset = 0;
  play();
}

function setShuffle(on) {
  shuffle = !!on;
  if (shuffleBtn) {
    shuffleBtn.classList.toggle('on', shuffle);
  }
}

function toggleShuffle() {
  setShuffle(!shuffle);
  saveSettings();
}

function setNormalize(on) {
  normalize = !!on;
  if (normalizeBtn) {
    normalizeBtn.classList.toggle('on', normalize);
  }
}

function toggleNormalize() {
  setNormalize(!normalize);
  saveSettings();
  applyVolumeForCurrentTrack();
}

// Media Session handlers are now initialized in initWebAudio() to ensure audioContext is ready

function goToLibrary() {
  setScreen(1);
}

window.player = { play, pause, next, prev, toggleShuffle, toggleNormalize, goToLibrary };

// Sync state when user uses native controls
let isSettingSrc = false;
audioElement.addEventListener('play', () => {
  // Skip recursive calls but allow handler setup
  if (!audioElement.src || audioElement.src === window.location.href) {
    if (files[index] && !isSettingSrc) {
      console.log('ℹ️ play event: initializing playback');
      isSettingSrc = true;
      initWebAudio();
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
      const blobUrl = URL.createObjectURL(files[index]);
      audioElement.src = blobUrl;
      audioElement.currentTime = offset;
      if (gainNode) audioElement.volume = 1.0;
      applyVolumeForCurrentTrack();
      audioElement.play().then(() => {
        isSettingSrc = false;
      }).catch((e) => {
        isSettingSrc = false;
        console.error('❌ Play failed:', e);
      });
      return; // Skip the rest for this initial call
    }
    console.warn('⚠️ play event: no valid source or already setting src');
    return;
  }
  
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
  if (gainNode) audioElement.volume = 1.0;
  setupMediaSessionHandlers();
});
 
audioElement.addEventListener('playing', () => {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  if (gainNode) audioElement.volume = 1.0;
  applyVolumeForCurrentTrack();
  isPlaying = true;
  highlight();
  updatePlaylistsButtons();
  syncMediaSession();
  try { navigator.mediaSession.playbackState = 'playing'; } catch (e) { console.error('❌ Failed to set playback state:', e); }
  setupMediaSessionHandlers();
});

audioElement.addEventListener('pause', () => {
  console.log('🔴 audioElement PAUSE event fired');
  if (!audioElement.ended) {
    offset = audioElement.currentTime || 0;
  }
  isPlaying = false;
  highlight();
  updatePlaylistsButtons();
  savePlayerState();
  syncMediaSession();
  // try { navigator.mediaSession.playbackState = 'paused'; } catch (e) { console.error('❌ Failed to set playback state:', e); }
});

audioElement.addEventListener('loadedmetadata', () => {
  syncMediaSession();
});

audioElement.addEventListener('timeupdate', () => {
  const now = Date.now();
  if (now - lastMediaSessionSync > MEDIA_SESSION_SYNC_MS) {
    lastMediaSessionSync = now;
    syncMediaSession();
  }
});

function setScreen(nextScreen) {
  currentScreen = Math.max(1, Math.min(screens.length || 1, nextScreen));
  document.body.setAttribute('data-screen', String(currentScreen));
  applyTransforms(0);
}

function applyTransforms(dx) {
  const width = window.innerWidth || 1;
  const progress = Math.max(-1, Math.min(1, dx / width));
  const currentIdx = currentScreen - 1;
  const leftIdx = currentIdx - 1;
  const rightIdx = currentIdx + 1;
  const draggingLeft = dx < 0;
  const draggingRight = dx > 0;

  screens.forEach((el, i) => {
    if (!el) return;
    let z = 0;
    if (i === currentIdx) {
      el.style.transform = `translateX(${progress * 100}%)`;
      z = 2;
    } else if (i === rightIdx && draggingLeft) {
      el.style.transform = 'translateX(0%)';
      z = 1;
    } else if (i === leftIdx && draggingRight) {
      el.style.transform = 'translateX(0%)';
      z = 1;
    } else if (i < currentIdx) {
      el.style.transform = 'translateX(-100%)';
      z = 0;
    } else if (i > currentIdx) {
      el.style.transform = 'translateX(100%)';
      z = 0;
    }
    el.style.zIndex = String(z);
  });
}

function onTouchStart(e) {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchActive = true;
  if (e.target.closest('#audioElement')) {
    touchActive = false;
    return;
  }
  touchScrollable = e.target.closest('#filelistwrapper');
  screens.forEach(s => s && s.classList.remove('animate'));
}

function onTouchMove(e) {
  if (!touchActive) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  if (Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault?.();
    const hasLeft = currentScreen > 1;
    const hasRight = currentScreen < (screens.length || 1);
    let allowedDx = dx;
    if (!hasLeft && allowedDx > 0) allowedDx = 0;
    if (!hasRight && allowedDx < 0) allowedDx = 0;
    applyTransforms(allowedDx);
  } else {
    if (!touchScrollable || touchScrollable.scrollHeight <= touchScrollable.clientHeight) {
      e.preventDefault();
    }
  }
}

function onTouchEnd(e) {
  if (!touchActive) return;
  touchActive = false;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const width = window.innerWidth || 1;
  if (Math.abs(dx) < Math.abs(dy)) {
    applyTransforms(0);
    return;
  }
  screens.forEach(s => s && s.classList.add('animate'));
  const hasLeft = currentScreen > 1;
  const hasRight = currentScreen < (screens.length || 1);
  if (dx < 0 && hasRight) {
    const pass = Math.abs(dx) > width * 0.2;
    if (pass) {
      applyTransforms(-width);
      setTimeout(() => setScreen(currentScreen + 1), 200);
    } else {
      applyTransforms(0);
    }
  } else if (dx > 0 && hasLeft) {
    const pass = Math.abs(dx) > width * 0.2;
    if (pass) {
      applyTransforms(width);
      setTimeout(() => setScreen(currentScreen - 1), 200);
    } else {
      applyTransforms(0);
    }
  } else {
    applyTransforms(0);
  }
}

document.addEventListener('touchstart', onTouchStart, {passive: true});
document.addEventListener('touchmove', onTouchMove, {passive: false});
document.addEventListener('touchend', onTouchEnd, {passive: true});

if (trackTitleEl) {
  trackTitleEl.onclick = () => {
    if (isPlaying) {
      pause();
    } else if (files[index]) {
      play();
    }
  };
}

if (addPlaylistBtn) {
  addPlaylistBtn.onclick = () => {
    const name = prompt('Playlist name?') || `Playlist ${playlists.length + 1}`;
    playlists.push({ id: String(Date.now()) + Math.random().toString(16).slice(2), name, items: [] });
    currentPlaylistId = playlists[playlists.length - 1].id;
    savePlaylists();
    renderPlaylists();
    renderPlaylistView();
    renderList();
    kill();
    offset = 0;
    if (trackTitleEl) trackTitleEl.textContent = '—';
  };
}

const clearCacheBtn = document.getElementById('clearCacheBtn');
if (clearCacheBtn) {
  clearCacheBtn.onclick = () => {
    if (!confirm('Clear normalization cache and all player states?')) return;
    try {
      localStorage.removeItem('normInfo');
      localStorage.removeItem('playerStates');
      if (gainInfoEl) gainInfoEl.textContent = '';
      alert('Cache cleared');
    } catch (e) {
      console.error('❌ Failed to clear cache:', e);
      alert('Failed to clear cache');
    }
  };
}

loadPlaylists();
loadSettings();
setupMediaSessionHandlers();

document.addEventListener('visibilitychange', () => {
  console.log('visibilitychange');

  if (audioContext && document.hidden && isPlaying && audioContext.state !== 'running') {
    audioContext.resume();

    offset = audioElement.currentTime || 0;
    audioElement.src = URL.createObjectURL(files[index]);
    audioElement.currentTime = offset;
    audioElement.play()
  } else { //  TODO: TO BE TESTED
    audioElement.src = URL.createObjectURL(files[index]);
    audioElement.currentTime = offset;
  }
});

window.addEventListener('beforeunload', () => {
  if (isPlaying) offset = audioElement.currentTime || 0;
  savePlayerState();
});
