const FULL_ROTATION_DEGREES = 360;
const START_OFFSET_END_TOLERANCE_SECONDS = 0.25;
const TIMING_SENSITIVITY = 0.1;
const MAX_VISUAL_ROTATION_DEGREES = FULL_ROTATION_DEGREES / TIMING_SENSITIVITY;

export function createTrackRotationController({
  dom,
  state,
  getFileKey,
  loadTrackStartTime,
  saveTrackStartTime,
  previewStartOffset,
}) {
  const knobState = {
    currentTrackKey: null,
    isActive: false,
    pointerId: null,
    prevPointerAngle: 0,
    rotationDeg: 0,
  };

  function clampRotationDeg(deg) {
    return Math.max(0, Math.min(MAX_VISUAL_ROTATION_DEGREES, deg));
  }

  function shortestAngleDelta(fromDeg, toDeg) {
    let delta = toDeg - fromDeg;

    if (delta > 180) {
      delta -= 360;
    }

    if (delta < -180) {
      delta += 360;
    }

    return delta;
  }

  function pointerAngleDeg(element, clientX, clientY) {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angleRad = Math.atan2(clientY - centerY, clientX - centerX);

    return (angleRad * 180) / Math.PI;
  }

  function getCurrentTrackFile() {
    return state.files[state.index] ?? null;
  }

  function getCurrentTrackKey() {
    const file = getCurrentTrackFile();
    return file ? getFileKey(file) : null;
  }

  function getCurrentTrackDuration() {
    return Number.isFinite(dom.audioElement?.duration) && dom.audioElement.duration > 0
      ? dom.audioElement.duration
      : 0;
  }

  function getMaxTrackStartOffset(duration) {
    if (!(Number.isFinite(duration) && duration > 0)) {
      return 0;
    }

    return Math.max(0, duration - START_OFFSET_END_TOLERANCE_SECONDS);
  }

  function startOffsetToRotationDeg(offset, duration) {
    if (!(Number.isFinite(duration) && duration > 0)) {
      return 0;
    }

    return clampRotationDeg(
      (Math.max(0, Math.min(offset, getMaxTrackStartOffset(duration))) / duration) *
        MAX_VISUAL_ROTATION_DEGREES
    );
  }

  function rotationDegToStartOffset(rotationDeg, duration) {
    if (!(Number.isFinite(duration) && duration > 0)) {
      return 0;
    }

    return (
      (clampRotationDeg(rotationDeg) / MAX_VISUAL_ROTATION_DEGREES) *
      duration
    );
  }

  function normalizeTrackStartOffset(offset, duration) {
    if (!(Number.isFinite(offset) && offset > 0)) {
      return 0;
    }

    return Math.min(offset, getMaxTrackStartOffset(duration));
  }

  function formatStartOffset(offset) {
    const totalMilliseconds = Math.max(0, Math.round(offset * 1000));
    const minutes = Math.floor(totalMilliseconds / 60000);
    const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }

  function renderStartInfo(offset) {
    if (!dom.trackStartInfoEl) {
      return;
    }

    if (!(Number.isFinite(offset) && offset > 0)) {
      dom.trackStartInfoEl.textContent = '';
      dom.trackStartInfoEl.style.display = 'none';
      return;
    }

    dom.trackStartInfoEl.textContent = `Start: ${formatStartOffset(offset)}`;
    dom.trackStartInfoEl.style.display = 'block';
  }

  function sync(force = false) {
    if (!dom.trackArtworkEl) {
      return;
    }

    const currentTrackKey = getCurrentTrackKey();

    if (!currentTrackKey) {
      knobState.currentTrackKey = null;
      knobState.rotationDeg = 0;
      dom.trackArtworkEl.style.transform = '';
      renderStartInfo(0);
      return;
    }

    const duration = getCurrentTrackDuration();
    const savedStartOffset = loadTrackStartTime(currentTrackKey);

    if (
      force ||
      !knobState.isActive ||
      knobState.currentTrackKey !== currentTrackKey
    ) {
      knobState.currentTrackKey = currentTrackKey;
      knobState.rotationDeg = startOffsetToRotationDeg(
        savedStartOffset,
        duration
      );
    }

    dom.trackArtworkEl.style.transform = `rotate(${knobState.rotationDeg.toFixed(3)}deg)`;
    renderStartInfo(savedStartOffset);
  }

  function bind() {
    if (!dom.trackArtworkEl) {
      return;
    }

    dom.trackArtworkEl.addEventListener('contextmenu', event => {
      event.preventDefault();
    });

    dom.trackArtworkEl.addEventListener('dragstart', event => {
      event.preventDefault();
    });

    dom.trackArtworkEl.addEventListener('pointerdown', event => {
      const currentTrackKey = getCurrentTrackKey();
      const duration = getCurrentTrackDuration();

      if (!currentTrackKey || !(duration > 0)) {
        return;
      }

      event.preventDefault();
      knobState.isActive = true;
      knobState.pointerId = event.pointerId;
      knobState.prevPointerAngle = pointerAngleDeg(
        dom.trackArtworkEl,
        event.clientX,
        event.clientY
      );
      knobState.currentTrackKey = currentTrackKey;
      dom.trackArtworkEl.setPointerCapture(event.pointerId);
    });

    dom.trackArtworkEl.addEventListener('pointermove', event => {
      if (!knobState.isActive || event.pointerId !== knobState.pointerId) {
        return;
      }

      event.preventDefault();
      const duration = getCurrentTrackDuration();

      if (!(duration > 0)) {
        return;
      }

      const currentPointerAngle = pointerAngleDeg(
        dom.trackArtworkEl,
        event.clientX,
        event.clientY
      );
      const delta = shortestAngleDelta(
        knobState.prevPointerAngle,
        currentPointerAngle
      );
      const nextRotationDeg = clampRotationDeg(knobState.rotationDeg + delta);
      const nextStartOffset = Number(
        normalizeTrackStartOffset(
          rotationDegToStartOffset(nextRotationDeg, duration),
          duration
        ).toFixed(3)
      );

      knobState.prevPointerAngle = currentPointerAngle;
      knobState.rotationDeg = nextRotationDeg;
      dom.trackArtworkEl.style.transform = `rotate(${nextRotationDeg.toFixed(3)}deg)`;
      saveTrackStartTime(knobState.currentTrackKey, nextStartOffset);
      renderStartInfo(nextStartOffset);
      previewStartOffset?.(nextStartOffset);
    });

    const endDrag = event => {
      if (!knobState.isActive || event.pointerId !== knobState.pointerId) {
        return;
      }

      knobState.isActive = false;
      knobState.pointerId = null;
      sync(true);
    };

    dom.trackArtworkEl.addEventListener('pointerup', endDrag);
    dom.trackArtworkEl.addEventListener('pointercancel', endDrag);
  }

  return {
    bind,
    sync,
  };
}
