const START_OFFSET_END_TOLERANCE_SECONDS = 0.25;
const DRAG_SECONDS_PER_PIXEL = 0.04;
const DRAG_GAIN_PER_PIXEL = 0.01;
const MAX_TRACK_GAIN = 4;
const MIN_TRACK_GAIN = 0;
const START_WHEEL_SHIFT_PIXELS_PER_SECOND = 24;
const GAIN_WHEEL_SHIFT_PIXELS_PER_UNIT = 100;

export function createTrackRotationController({
  dom,
  state,
  getFileKey,
  loadNormInfo,
  loadTrackGain,
  loadTrackStartTime,
  recalculateTrackStartOffset,
  saveTrackGain,
  saveTrackStartTime,
  previewStartOffset,
  previewTrackGain,
}) {
  const knobState = {
    activeControl: null,
    currentGain: 1,
    currentStartOffset: 0,
    currentTrackKey: null,
    dragStartValue: 0,
    dragStartY: 0,
    isActive: false,
    pointerId: null,
  };

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
      : NaN;
  }

  function getMaxTrackStartOffset(duration) {
    if (!(Number.isFinite(duration) && duration > 0)) {
      return Infinity;
    }

    return Math.max(0, duration - START_OFFSET_END_TOLERANCE_SECONDS);
  }

  function normalizeTrackStartOffset(offset, duration) {
    if (!(Number.isFinite(offset) && offset > 0)) {
      return 0;
    }

    return Math.min(Math.max(0, offset), getMaxTrackStartOffset(duration));
  }

  function normalizeTrackGain(gain) {
    if (!Number.isFinite(gain)) {
      return 1;
    }

    return Math.min(MAX_TRACK_GAIN, Math.max(MIN_TRACK_GAIN, gain));
  }

  function getDerivedTrackGain(trackKey) {
    const gainOverride = loadTrackGain(trackKey);

    if (Number.isFinite(gainOverride) && gainOverride >= 0) {
      return normalizeTrackGain(gainOverride);
    }

    const peak = loadNormInfo(trackKey);

    if (typeof peak === 'number' && peak > 0) {
      return normalizeTrackGain(Math.min(1 / peak, 10));
    }

    return 1;
  }

  function getDefaultTrackGain(trackKey) {
    const peak = loadNormInfo(trackKey);

    if (typeof peak === 'number' && peak > 0) {
      return normalizeTrackGain(Math.min(1 / peak, 10));
    }

    return 1;
  }

  function formatStartOffset(offset) {
    const totalMilliseconds = Math.max(0, Math.round(offset * 1000));
    const minutes = Math.floor(totalMilliseconds / 60000);
    const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }

  function renderWheel() {
    if (!dom.trackStartWheelEl) {
      return;
    }

    let shift = 0;

    if (knobState.activeControl === 'start') {
      shift =
        knobState.currentStartOffset * START_WHEEL_SHIFT_PIXELS_PER_SECOND;
    } else if (knobState.activeControl === 'gain') {
      shift = knobState.currentGain * GAIN_WHEEL_SHIFT_PIXELS_PER_UNIT;
    }

    dom.trackStartWheelEl.style.setProperty(
      '--track-start-shift',
      `${Number((-shift).toFixed(3))}px`
    );
  }

  function renderStartInfo(offset) {
    if (!dom.trackStartInfoEl) {
      return;
    }

    const shouldShow = knobState.activeControl === 'start';

    if (!shouldShow) {
      dom.trackStartInfoEl.classList.remove('active');
      dom.trackStartInfoEl.textContent = '';
      dom.trackStartInfoEl.style.display = 'none';
      return;
    }

    dom.trackStartInfoEl.textContent = `Start: ${formatStartOffset(offset)}`;
    dom.trackStartInfoEl.style.display = 'block';
    dom.trackStartInfoEl.classList.toggle(
      'active',
      knobState.activeControl === 'start'
    );
  }

  function applyControlState() {
    const isStartActive = knobState.activeControl === 'start';
    const isGainActive = knobState.activeControl === 'gain';
    const hasCustomGain = Math.abs(knobState.currentGain - 1) > 0.0005;

    if (dom.trackAdjusterButtonsEl) {
      dom.trackAdjusterButtonsEl.classList.toggle('start-mode', isStartActive);
      dom.trackAdjusterButtonsEl.classList.toggle('gain-mode', isGainActive);
    }

    if (dom.trackStartToggleEl) {
      const hasCustomStart = knobState.currentStartOffset > 0.0005;
      dom.trackStartToggleEl.classList.toggle('on', isStartActive || hasCustomStart);
      dom.trackStartToggleEl.setAttribute(
        'aria-expanded',
        isStartActive ? 'true' : 'false'
      );
    }

    if (dom.trackStartDefaultBtnEl) {
      dom.trackStartDefaultBtnEl.disabled = !knobState.currentTrackKey;
      dom.trackStartDefaultBtnEl.classList.toggle(
        'on',
        isStartActive && knobState.currentStartOffset < 0.0005
      );
    }

    if (dom.trackGainToggleEl) {
      dom.trackGainToggleEl.classList.toggle('on', isGainActive || hasCustomGain);
      dom.trackGainToggleEl.setAttribute(
        'aria-expanded',
        isGainActive ? 'true' : 'false'
      );
    }

    if (dom.trackGainDefaultBtnEl) {
      dom.trackGainDefaultBtnEl.disabled = !knobState.currentTrackKey;
      dom.trackGainDefaultBtnEl.classList.toggle(
        'on',
        isGainActive && Math.abs(knobState.currentGain - getDefaultTrackGain(knobState.currentTrackKey)) < 0.0005
      );
    }

    if (dom.trackGainUnityBtnEl) {
      dom.trackGainUnityBtnEl.disabled = !knobState.currentTrackKey;
      dom.trackGainUnityBtnEl.classList.toggle(
        'on',
        isGainActive && Math.abs(knobState.currentGain - 1) < 0.0005
      );
    }

    if (dom.trackStartWheelEl) {
      dom.trackStartWheelEl.classList.toggle(
        'open',
        Boolean(knobState.activeControl)
      );
      dom.trackStartWheelEl.setAttribute(
        'aria-hidden',
        knobState.activeControl ? 'false' : 'true'
      );
    }
  }

  function updateGainPreview() {
    previewTrackGain?.({
      forceVisible: knobState.activeControl === 'gain',
    });
  }

  function setActiveControl(nextControl) {
    knobState.activeControl =
      nextControl && knobState.currentTrackKey ? nextControl : null;
    applyControlState();
    renderWheel();
    renderStartInfo(knobState.currentStartOffset);
    updateGainPreview();
  }

  function sync(force = false) {
    const currentTrackKey = getCurrentTrackKey();

    if (dom.trackArtworkEl) {
      dom.trackArtworkEl.style.transform = '';
    }

    if (dom.trackStartToggleEl) {
      dom.trackStartToggleEl.disabled = !currentTrackKey;
    }

    if (dom.trackGainToggleEl) {
      dom.trackGainToggleEl.disabled = !currentTrackKey;
    }

    if (dom.trackGainDefaultBtnEl) {
      dom.trackGainDefaultBtnEl.disabled = !currentTrackKey;
    }

    if (dom.trackGainUnityBtnEl) {
      dom.trackGainUnityBtnEl.disabled = !currentTrackKey;
    }

    if (!currentTrackKey) {
      knobState.currentTrackKey = null;
      knobState.currentStartOffset = 0;
      knobState.currentGain = 1;
      knobState.isActive = false;
      knobState.pointerId = null;
      setActiveControl(null);
      renderWheel();
      renderStartInfo(0);
      return;
    }

    const savedStartOffset = normalizeTrackStartOffset(
      loadTrackStartTime(currentTrackKey),
      getCurrentTrackDuration()
    );
    const savedGain = getDerivedTrackGain(currentTrackKey);

    if (
      force ||
      !knobState.isActive ||
      knobState.currentTrackKey !== currentTrackKey
    ) {
      knobState.currentTrackKey = currentTrackKey;
      knobState.currentStartOffset = savedStartOffset;
      knobState.currentGain = savedGain;
    }

    applyControlState();
    renderWheel();
    renderStartInfo(knobState.currentStartOffset);
    updateGainPreview();
  }

  function bind() {
    if (
      !dom.trackStartToggleEl ||
      !dom.trackGainToggleEl ||
      !dom.trackStartDefaultBtnEl ||
      !dom.trackGainDefaultBtnEl ||
      !dom.trackGainUnityBtnEl ||
      !dom.trackStartWheelEl
    ) {
      return;
    }

    const toggleControl = control => event => {
      event.preventDefault();
      sync(true);
      setActiveControl(knobState.activeControl === control ? null : control);
    };

    dom.trackStartToggleEl.addEventListener('click', toggleControl('start'));
    dom.trackGainToggleEl.addEventListener('click', toggleControl('gain'));

    dom.trackStartDefaultBtnEl.addEventListener('click', async event => {
      if (!knobState.currentTrackKey) {
        return;
      }

      event.preventDefault();
      const analysisResult = await recalculateTrackStartOffset?.(
        knobState.currentTrackKey
      );
      knobState.currentStartOffset = normalizeTrackStartOffset(
        analysisResult?.startOffset ?? 0,
        getCurrentTrackDuration()
      );
      applyControlState();
      renderWheel();
      renderStartInfo(knobState.currentStartOffset);
      previewStartOffset?.(knobState.currentStartOffset);
    });

    dom.trackGainDefaultBtnEl.addEventListener('click', event => {
      if (!knobState.currentTrackKey) {
        return;
      }

      event.preventDefault();
      knobState.currentGain = getDefaultTrackGain(knobState.currentTrackKey);
      saveTrackGain(knobState.currentTrackKey, null);
      applyControlState();
      renderWheel();
      updateGainPreview();
    });

    dom.trackGainUnityBtnEl.addEventListener('click', event => {
      if (!knobState.currentTrackKey) {
        return;
      }

      event.preventDefault();
      knobState.currentGain = 1;
      saveTrackGain(knobState.currentTrackKey, 1);
      applyControlState();
      renderWheel();
      updateGainPreview();
    });

    dom.trackStartWheelEl.addEventListener('pointerdown', event => {
      if (!knobState.activeControl || !knobState.currentTrackKey) {
        return;
      }

      event.preventDefault();
      knobState.isActive = true;
      knobState.pointerId = event.pointerId;
      knobState.dragStartY = event.clientY;
      knobState.dragStartValue =
        knobState.activeControl === 'gain'
          ? knobState.currentGain
          : knobState.currentStartOffset;
      dom.trackStartWheelEl.setPointerCapture(event.pointerId);
      renderStartInfo(knobState.currentStartOffset);
      updateGainPreview();
    });

    dom.trackStartWheelEl.addEventListener('pointermove', event => {
      if (!knobState.isActive || event.pointerId !== knobState.pointerId) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - knobState.dragStartY;

      if (knobState.activeControl === 'start') {
        const nextOffset = Number(
          normalizeTrackStartOffset(
            knobState.dragStartValue - deltaY * DRAG_SECONDS_PER_PIXEL,
            getCurrentTrackDuration()
          ).toFixed(3)
        );

        if (nextOffset === knobState.currentStartOffset) {
          return;
        }

        knobState.currentStartOffset = nextOffset;
        saveTrackStartTime(knobState.currentTrackKey, nextOffset);
        applyControlState();
        renderWheel();
        renderStartInfo(nextOffset);
        previewStartOffset?.(nextOffset);
        return;
      }

      if (knobState.activeControl === 'gain') {
        const nextGain = Number(
          normalizeTrackGain(
            knobState.dragStartValue - deltaY * DRAG_GAIN_PER_PIXEL
          ).toFixed(2)
        );

        if (nextGain === knobState.currentGain) {
          return;
        }

        knobState.currentGain = nextGain;
        saveTrackGain(knobState.currentTrackKey, nextGain);
        applyControlState();
        renderWheel();
        updateGainPreview();
      }
    });

    const endDrag = event => {
      if (!knobState.isActive || event.pointerId !== knobState.pointerId) {
        return;
      }

      knobState.isActive = false;
      knobState.pointerId = null;
      sync(true);
    };

    dom.trackStartWheelEl.addEventListener('pointerup', endDrag);
    dom.trackStartWheelEl.addEventListener('pointercancel', endDrag);

    document.addEventListener('pointerdown', event => {
      if (
        !knobState.activeControl ||
        event.target.closest(
          '#trackStartToggle, #trackGainToggle, #trackStartDefaultBtn, #trackGainDefaultBtn, #trackGainUnityBtn, #trackStartWheel'
        )
      ) {
        return;
      }

      setActiveControl(null);
    });
  }

  return {
    bind,
    sync,
  };
}
