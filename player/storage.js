const PLAYLISTS_KEY = 'playlists';
const SETTINGS_KEY = 'settings';
const PLAYLIST_STATES_KEY = 'playlistStates';
const LEGACY_PLAYER_STATES_KEY = 'playerStates';
const NORM_INFO_KEY = 'normInfo2';
const TRACK_START_INFO_KEY = 'trackStartInfo';
const TRACK_END_TIME_INFO_KEY = 'trackEndTimeInfo';
const LEGACY_TRACK_END_INFO_KEY = 'trackEndInfo';
const TRACK_GAIN_INFO_KEY = 'trackGainInfo';
const EXPLICIT_INFO_KEY = 'explicitInfo';
const TRACK_REPEAT_INFO_KEY = 'trackRepeatInfo';

function readJson(key, fallback, errorLabel) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(`Failed to ${errorLabel}:`, error);
    return fallback;
  }
}

function writeJson(key, value, errorLabel) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Failed to ${errorLabel}:`, error);
    return false;
  }
}

export function loadPlaylists() {
  const data = readJson(PLAYLISTS_KEY, null, 'load playlists');

  return {
    playlists: Array.isArray(data?.playlists) ? data.playlists : [],
    currentPlaylistId: data?.currentPlaylistId ?? null,
  };
}

export function savePlaylists(playlists, currentPlaylistId) {
  return writeJson(
    PLAYLISTS_KEY,
    { playlists, currentPlaylistId },
    'save playlists'
  );
}

export function loadSettings() {
  const data = readJson(SETTINGS_KEY, null, 'load settings');

  return {
    shuffle: Boolean(data?.shuffle),
    normalize: Boolean(data?.normalize),
    allowExplicit: data?.allowExplicit !== false,
  };
}

export function saveSettings(settings) {
  return writeJson(SETTINGS_KEY, settings, 'save settings');
}

function readAllPlaylistStates() {
  const playlistStates = readJson(
    PLAYLIST_STATES_KEY,
    null,
    'load playlist states'
  );

  if (playlistStates) {
    return playlistStates;
  }

  return readJson(LEGACY_PLAYER_STATES_KEY, {}, 'load legacy player states');
}

export function loadPlaylistState(playlistId) {
  if (!playlistId) {
    return { trackKey: null, offset: 0 };
  }

  const allStates = readAllPlaylistStates();
  const savedState = allStates?.[playlistId];

  return {
    trackKey: savedState?.trackKey ?? null,
    offset: Number.isFinite(savedState?.offset) ? savedState.offset : 0,
  };
}

export function savePlaylistState(playlistId, playerState) {
  if (!playlistId) {
    return false;
  }

  const allStates = readAllPlaylistStates();
  allStates[playlistId] = {
    trackKey: playerState.trackKey ?? null,
    offset: Number.isFinite(playerState.offset) ? playerState.offset : 0,
  };

  localStorage.removeItem(LEGACY_PLAYER_STATES_KEY);
  return writeJson(PLAYLIST_STATES_KEY, allStates, 'save playlist state');
}

export function removePlaylistState(playlistId) {
  if (!playlistId) {
    return false;
  }

  const allStates = readJson(
    PLAYLIST_STATES_KEY,
    {},
    'load playlist states for removal'
  );
  delete allStates[playlistId];
  const saved = writeJson(
    PLAYLIST_STATES_KEY,
    allStates,
    'save playlist states after removal'
  );

  const legacyStates = readJson(
    LEGACY_PLAYER_STATES_KEY,
    null,
    'load legacy player states for removal'
  );

  if (legacyStates && typeof legacyStates === 'object') {
    delete legacyStates[playlistId];
    writeJson(
      LEGACY_PLAYER_STATES_KEY,
      legacyStates,
      'save legacy player states after removal'
    );
  }

  return saved;
}

export function loadNormInfo(trackKey) {
  const allNormInfo = readJson(NORM_INFO_KEY, {}, 'load normalization info');
  return allNormInfo?.[trackKey] ?? null;
}

export function saveNormInfo(trackKey, peak) {
  const allNormInfo = readJson(
    NORM_INFO_KEY,
    {},
    'load normalization info for save'
  );
  allNormInfo[trackKey] = peak;
  return writeJson(
    NORM_INFO_KEY,
    allNormInfo,
    'save normalization info'
  );
}

export function loadTrackStartTime(trackKey) {
  const allTrackStartInfo = readJson(
    TRACK_START_INFO_KEY,
    {},
    'load track start info'
  );
  const value = allTrackStartInfo?.[trackKey];

  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function saveTrackStartTime(trackKey, offset) {
  if (!trackKey) {
    return false;
  }

  const allTrackStartInfo = readJson(
    TRACK_START_INFO_KEY,
    {},
    'load track start info for save'
  );
  const nextOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;

  if (nextOffset > 0) {
    allTrackStartInfo[trackKey] = nextOffset;
  } else {
    delete allTrackStartInfo[trackKey];
  }

  return writeJson(
    TRACK_START_INFO_KEY,
    allTrackStartInfo,
    'save track start info'
  );
}

export function loadTrackEndTime(trackKey) {
  const allTrackEndInfo = readJson(
    TRACK_END_TIME_INFO_KEY,
    {},
    'load track end time'
  );
  const value = allTrackEndInfo?.[trackKey];

  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function saveTrackEndTime(trackKey, endTime) {
  if (!trackKey) {
    return false;
  }

  const allTrackEndInfo = readJson(
    TRACK_END_TIME_INFO_KEY,
    {},
    'load track end time for save'
  );
  const nextEndTime = Number.isFinite(endTime) ? Math.max(0, endTime) : 0;

  if (nextEndTime > 0) {
    allTrackEndInfo[trackKey] = nextEndTime;
  } else {
    delete allTrackEndInfo[trackKey];
  }

  return writeJson(
    TRACK_END_TIME_INFO_KEY,
    allTrackEndInfo,
    'save track end time'
  );
}

export function loadTrackGain(trackKey) {
  const allTrackGainInfo = readJson(
    TRACK_GAIN_INFO_KEY,
    {},
    'load track gain info'
  );
  const value = allTrackGainInfo?.[trackKey];

  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function saveTrackGain(trackKey, gain) {
  if (!trackKey) {
    return false;
  }

  const allTrackGainInfo = readJson(
    TRACK_GAIN_INFO_KEY,
    {},
    'load track gain info for save'
  );
  const nextGain = Number.isFinite(gain) ? Math.max(0, gain) : null;

  if (nextGain !== null) {
    allTrackGainInfo[trackKey] = nextGain;
  } else {
    delete allTrackGainInfo[trackKey];
  }

  return writeJson(
    TRACK_GAIN_INFO_KEY,
    allTrackGainInfo,
    'save track gain info'
  );
}

export function loadExplicitInfo(trackKey) {
  const allExplicitInfo = readJson(EXPLICIT_INFO_KEY, {}, 'load explicit info');
  return Boolean(trackKey && allExplicitInfo?.[trackKey]);
}

export function saveExplicitInfo(trackKey, isExplicit) {
  if (!trackKey) {
    return false;
  }

  const allExplicitInfo = readJson(
    EXPLICIT_INFO_KEY,
    {},
    'load explicit info for save'
  );

  if (isExplicit) {
    allExplicitInfo[trackKey] = true;
  } else {
    delete allExplicitInfo[trackKey];
  }

  return writeJson(EXPLICIT_INFO_KEY, allExplicitInfo, 'save explicit info');
}

export function loadTrackRepeatCount(trackKey) {
  const allRepeatInfo = readJson(
    TRACK_REPEAT_INFO_KEY,
    {},
    'load track repeat info'
  );
  const value = allRepeatInfo?.[trackKey];
  const parsed = Number.isFinite(value) ? Math.floor(value) : NaN;

  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export function saveTrackRepeatCount(trackKey, repeatCount) {
  if (!trackKey) {
    return false;
  }

  const allRepeatInfo = readJson(
    TRACK_REPEAT_INFO_KEY,
    {},
    'load track repeat info for save'
  );
  const parsed = Number.isFinite(repeatCount) ? Math.floor(repeatCount) : NaN;
  const nextCount = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;

  if (nextCount > 1) {
    allRepeatInfo[trackKey] = nextCount;
  } else {
    delete allRepeatInfo[trackKey];
  }

  return writeJson(TRACK_REPEAT_INFO_KEY, allRepeatInfo, 'save track repeat info');
}

export function clearPlayerCache() {
  try {
    localStorage.removeItem(NORM_INFO_KEY);
    localStorage.removeItem(TRACK_START_INFO_KEY);
    localStorage.removeItem(TRACK_END_TIME_INFO_KEY);
    localStorage.removeItem(LEGACY_TRACK_END_INFO_KEY);
    localStorage.removeItem(TRACK_GAIN_INFO_KEY);
    localStorage.removeItem(TRACK_REPEAT_INFO_KEY);
    localStorage.removeItem(PLAYLIST_STATES_KEY);
    localStorage.removeItem(LEGACY_PLAYER_STATES_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear player cache:', error);
    return false;
  }
}
