const START_OFFSET_END_TOLERANCE_SECONDS = 0.25;
const ROTATE_SECONDS_PER_RADIAN = 1.8;
const ROTATE_GAIN_PER_RADIAN = 0.45;
const NORMAL_PLAYBACK_RADIANS_PER_MS = (Math.PI * 2) / 10000;
const PLAYBACK_RATE_STEPS = [0.5, 1, 1.25, 1.5, 2];
const PLAYBACK_RATE_UPDATE_INTERVAL_MS = 80;
const MAX_TRACK_GAIN = 4;
const MIN_TRACK_GAIN = 0;
const MAX_TRACK_REPEAT_COUNT = 999;

export function createTrackRotationController({
  dom,
  state,
  getFileKey,
  loadNormInfo,
  loadTrackEndTime,
  loadTrackGain,
  loadTrackRepeatCount,
  loadTrackStartTime,
  recalculateTrackStartOffset,
  saveTrackEndTime,
  saveTrackGain,
  saveTrackRepeatCount,
  saveTrackStartTime,
  onRepeatCountChange,
  previewEndOffset,
  previewStartOffset,
  previewTrackGain,
}) {
  const knobState = {
    activeControl: null,
    currentEndTime: 0,
    currentGain: 1,
    currentRepeatCount: 1,
    currentRepeatVisualValue: 1,
    currentStartOffset: 0,
    dragAngleDelta: 0,
    dragLastAngle: 0,
    dragLastTime: 0,
    dragLastRateTime: 0,
    currentTrackKey: null,
    dragStartValue: 0,
    isActive: false,
    pointerId: null,
    playbackRateStopTimer: null,
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

  function getMinTrackEndTime(duration, startOffset = 0) {
    const nextStartOffset = Math.max(0, startOffset);

    if (!(Number.isFinite(duration) && duration > 0)) {
      return nextStartOffset;
    }

    return Math.min(duration, nextStartOffset + START_OFFSET_END_TOLERANCE_SECONDS);
  }

  function normalizeTrackEndTime(endTime, duration, startOffset = 0) {
    if (!(Number.isFinite(endTime) && endTime > 0)) {
      return 0;
    }

    const minEndTime = getMinTrackEndTime(duration, startOffset);
    const maxEndOffset = Number.isFinite(duration) && duration > 0
      ? Math.max(0, duration - minEndTime)
      : Infinity;
    return Math.min(Math.max(0, endTime), maxEndOffset);
  }

  function normalizeTrackGain(gain) {
    if (!Number.isFinite(gain)) {
      return 1;
    }

    return Math.min(MAX_TRACK_GAIN, Math.max(MIN_TRACK_GAIN, gain));
  }

  function normalizeTrackRepeatCount(repeatCount) {
    if (!Number.isFinite(repeatCount)) {
      return 1;
    }

    return Math.min(
      MAX_TRACK_REPEAT_COUNT,
      Math.max(1, Math.round(repeatCount))
    );
  }

  function normalizeTrackRepeatVisualValue(repeatCount) {
    if (!Number.isFinite(repeatCount)) {
      return 1;
    }

    return Math.min(MAX_TRACK_REPEAT_COUNT, Math.max(1, repeatCount));
  }

  function getPointerAngle(event) {
    const rect = dom.trackArtworkEl.getBoundingClientRect();
    return Math.atan2(
      event.clientY - (rect.top + rect.height / 2),
      event.clientX - (rect.left + rect.width / 2)
    );
  }

  function getAngleDelta(angle, startAngle) {
    let delta = angle - startAngle;

    if (delta > Math.PI) {
      delta -= Math.PI * 2;
    } else if (delta < -Math.PI) {
      delta += Math.PI * 2;
    }

    return delta;
  }

  function armPlaybackRateStopTimer() {
    window.clearTimeout(knobState.playbackRateStopTimer);
    knobState.playbackRateStopTimer = window.setTimeout(() => {
      dom.audioElement.playbackRate = 0.5;
    }, 120);
  }

  function quantizePlaybackRate(rate) {
    return PLAYBACK_RATE_STEPS.reduce((closestRate, step) =>
      Math.abs(step - rate) < Math.abs(closestRate - rate)
        ? step
        : closestRate
    );
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

  function getEffectiveTrackEndTime(
    endTime = knobState.currentEndTime,
    duration = getCurrentTrackDuration(),
    startOffset = knobState.currentStartOffset
  ) {
    return normalizeTrackEndTime(endTime, duration, startOffset);
  }

  function renderAdjusterInfo(offset) {
    if (!dom.trackStartInfoEl) {
      return;
    }

    const shouldShow =
      knobState.activeControl === 'start' ||
      knobState.activeControl === 'end' ||
      knobState.activeControl === 'repeat';

    if (!shouldShow) {
      dom.trackStartInfoEl.classList.remove('active');
      dom.trackStartInfoEl.textContent = '';
      dom.trackStartInfoEl.style.display = 'none';
      return;
    }

    if (knobState.activeControl === 'repeat') {
      dom.trackStartInfoEl.textContent = `Repeat: ${knobState.currentRepeatCount}`;
    } else if (knobState.activeControl === 'end') {
      const endOffsetSeconds = getEffectiveTrackEndTime();
      dom.trackStartInfoEl.textContent = `End: -${Number(endOffsetSeconds.toFixed(3))}s`;
    } else {
      dom.trackStartInfoEl.textContent = `Start: ${formatStartOffset(offset)}`;
    }
    dom.trackStartInfoEl.style.display = 'block';
    dom.trackStartInfoEl.classList.toggle(
      'active',
      knobState.activeControl === 'start' ||
        knobState.activeControl === 'end' ||
        knobState.activeControl === 'repeat'
    );
  }

  function applyControlState() {
    const isStartActive = knobState.activeControl === 'start';
    const isEndActive = knobState.activeControl === 'end';
    const isGainActive = knobState.activeControl === 'gain';
    const isRepeatActive = knobState.activeControl === 'repeat';
    const hasCustomGain = Math.abs(knobState.currentGain - 1) > 0.0005;

    if (dom.trackAdjusterButtonsEl) {
      dom.trackAdjusterButtonsEl.classList.toggle('start-mode', isStartActive);
      dom.trackAdjusterButtonsEl.classList.toggle('end-mode', isEndActive);
      dom.trackAdjusterButtonsEl.classList.toggle('gain-mode', isGainActive);
      dom.trackAdjusterButtonsEl.classList.toggle('repeat-mode', isRepeatActive);
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

    if (dom.trackEndToggleEl) {
      const hasCustomEnd = knobState.currentEndTime > 0.0005;
      dom.trackEndToggleEl.classList.toggle('on', isEndActive || hasCustomEnd);
      dom.trackEndToggleEl.setAttribute(
        'aria-expanded',
        isEndActive ? 'true' : 'false'
      );
    }

    if (dom.trackEndDefaultBtnEl) {
      dom.trackEndDefaultBtnEl.disabled = !knobState.currentTrackKey;
      dom.trackEndDefaultBtnEl.classList.toggle(
        'on',
        isEndActive && knobState.currentEndTime < 0.0005
      );
    }

    if (dom.trackGainToggleEl) {
      dom.trackGainToggleEl.classList.toggle('on', isGainActive || hasCustomGain);
      dom.trackGainToggleEl.setAttribute(
        'aria-expanded',
        isGainActive ? 'true' : 'false'
      );
    }

    if (dom.trackRepeatToggleEl) {
      const hasCustomRepeat = knobState.currentRepeatCount > 1;
      dom.trackRepeatToggleEl.classList.toggle('on', isRepeatActive || hasCustomRepeat);
      dom.trackRepeatToggleEl.setAttribute(
        'aria-expanded',
        isRepeatActive ? 'true' : 'false'
      );
      dom.trackRepeatToggleEl.setAttribute(
        'aria-pressed',
        isRepeatActive || hasCustomRepeat ? 'true' : 'false'
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

    dom.trackArtworkEl.classList.toggle(
      'adjusting',
      Boolean(knobState.activeControl)
    );
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
    renderAdjusterInfo(knobState.currentStartOffset);
    updateGainPreview();
  }

  function sync(force = false) {
    const currentTrackKey = getCurrentTrackKey();

    if (dom.trackStartToggleEl) {
      dom.trackStartToggleEl.disabled = !currentTrackKey;
    }

    if (dom.trackEndToggleEl) {
      dom.trackEndToggleEl.disabled = !currentTrackKey;
    }

    if (dom.trackGainToggleEl) {
      dom.trackGainToggleEl.disabled = !currentTrackKey;
    }

    if (dom.trackRepeatToggleEl) {
      dom.trackRepeatToggleEl.disabled = !currentTrackKey;
    }

    if (dom.trackGainDefaultBtnEl) {
      dom.trackGainDefaultBtnEl.disabled = !currentTrackKey;
    }

    if (dom.trackEndDefaultBtnEl) {
      dom.trackEndDefaultBtnEl.disabled = !currentTrackKey;
    }

    if (dom.trackGainUnityBtnEl) {
      dom.trackGainUnityBtnEl.disabled = !currentTrackKey;
    }

    if (!currentTrackKey) {
      knobState.currentTrackKey = null;
      knobState.currentEndTime = 0;
      knobState.currentStartOffset = 0;
      knobState.currentGain = 1;
      knobState.currentRepeatCount = 1;
      knobState.currentRepeatVisualValue = 1;
      knobState.isActive = false;
      knobState.pointerId = null;
      setActiveControl(null);
      renderAdjusterInfo(0);
      return;
    }

    const savedStartOffset = normalizeTrackStartOffset(
      loadTrackStartTime(currentTrackKey),
      getCurrentTrackDuration()
    );
    const savedEndTime = normalizeTrackEndTime(
      loadTrackEndTime(currentTrackKey),
      getCurrentTrackDuration(),
      savedStartOffset
    );
    const savedGain = getDerivedTrackGain(currentTrackKey);
    const savedRepeatCount = normalizeTrackRepeatCount(
      loadTrackRepeatCount(currentTrackKey)
    );

    if (
      force ||
      !knobState.isActive ||
      knobState.currentTrackKey !== currentTrackKey
    ) {
      knobState.currentTrackKey = currentTrackKey;
      knobState.currentEndTime = savedEndTime;
      knobState.currentStartOffset = savedStartOffset;
      knobState.currentGain = savedGain;
      knobState.currentRepeatCount = savedRepeatCount;
      knobState.currentRepeatVisualValue = savedRepeatCount;
    }

    applyControlState();
    renderAdjusterInfo(knobState.currentStartOffset);
    updateGainPreview();
  }

  function bind() {
    if (
      !dom.trackStartToggleEl ||
      !dom.trackEndToggleEl ||
      !dom.trackGainToggleEl ||
      !dom.trackRepeatToggleEl ||
      !dom.trackStartDefaultBtnEl ||
      !dom.trackEndDefaultBtnEl ||
      !dom.trackGainDefaultBtnEl ||
      !dom.trackGainUnityBtnEl ||
      !dom.trackArtworkEl
    ) {
      return;
    }

    const toggleControl = control => event => {
      event.preventDefault();
      sync(true);
      const nextControl = knobState.activeControl === control ? null : control;
      setActiveControl(nextControl);

      if (nextControl === 'end') {
        previewEndOffset?.(getEffectiveTrackEndTime());
      }
    };

    dom.trackStartToggleEl.addEventListener('click', toggleControl('start'));
    dom.trackEndToggleEl.addEventListener('click', toggleControl('end'));
    dom.trackGainToggleEl.addEventListener('click', toggleControl('gain'));
    dom.trackRepeatToggleEl.addEventListener('click', toggleControl('repeat'));

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
      renderAdjusterInfo(knobState.currentStartOffset);
      previewStartOffset?.(knobState.currentStartOffset);
    });

    dom.trackEndDefaultBtnEl.addEventListener('click', event => {
      if (!knobState.currentTrackKey) {
        return;
      }

      event.preventDefault();
      knobState.currentEndTime = 0;
      saveTrackEndTime(knobState.currentTrackKey, 0);
      applyControlState();
      renderAdjusterInfo(knobState.currentStartOffset);
    });

    dom.trackGainDefaultBtnEl.addEventListener('click', event => {
      if (!knobState.currentTrackKey) {
        return;
      }

      event.preventDefault();
      knobState.currentGain = getDefaultTrackGain(knobState.currentTrackKey);
      saveTrackGain(knobState.currentTrackKey, null);
      applyControlState();
      previewTrackGain?.({ commit: true, forceVisible: true });
    });

    dom.trackGainUnityBtnEl.addEventListener('click', event => {
      if (!knobState.currentTrackKey) {
        return;
      }

      event.preventDefault();
      knobState.currentGain = 1;
      saveTrackGain(knobState.currentTrackKey, 1);
      applyControlState();
      previewTrackGain?.({ commit: true, forceVisible: true });
    });

    dom.trackArtworkEl.addEventListener('pointerdown', event => {
      if ((!knobState.activeControl && !state.isPlaying) || !knobState.currentTrackKey) {
        return;
      }

      event.preventDefault();
      knobState.isActive = true;
      knobState.pointerId = event.pointerId;
      knobState.dragAngleDelta = 0;
      knobState.dragLastAngle = getPointerAngle(event);
      knobState.dragLastTime = event.timeStamp;
      knobState.dragLastRateTime = 0;
      knobState.dragStartValue =
        knobState.activeControl === 'gain'
          ? knobState.currentGain
          : knobState.activeControl === 'repeat'
            ? knobState.currentRepeatVisualValue
            : knobState.activeControl === 'end'
              ? getEffectiveTrackEndTime()
            : knobState.currentStartOffset;
      dom.trackArtworkEl.classList.add('adjusting');
      dom.trackArtworkEl.style.transform = 'rotate(0rad)';
      dom.trackArtworkEl.setPointerCapture(event.pointerId);
      if (!knobState.activeControl) {
        armPlaybackRateStopTimer();
      }
      renderAdjusterInfo(knobState.currentStartOffset);
      updateGainPreview();
    });

    dom.trackArtworkEl.addEventListener('pointermove', event => {
      if (!knobState.isActive || event.pointerId !== knobState.pointerId) {
        return;
      }

      event.preventDefault();
      const pointerAngle = getPointerAngle(event);
      const angleDelta = getAngleDelta(
        pointerAngle,
        knobState.dragLastAngle
      );
      knobState.dragAngleDelta += angleDelta;
      knobState.dragLastAngle = pointerAngle;
      dom.trackArtworkEl.style.transform =
        `rotate(${knobState.dragAngleDelta}rad)`;

      if (!knobState.activeControl) {
        if (
          event.timeStamp - knobState.dragLastRateTime <
          PLAYBACK_RATE_UPDATE_INTERVAL_MS
        ) {
          return;
        }

        const nextPlaybackRate =
          angleDelta /
          Math.max(1, event.timeStamp - knobState.dragLastTime) /
          NORMAL_PLAYBACK_RADIANS_PER_MS;
        dom.audioElement.preservesPitch = false;
        dom.audioElement.webkitPreservesPitch = false;
        dom.audioElement.playbackRate = quantizePlaybackRate(
          Math.abs(nextPlaybackRate)
        );
        knobState.dragLastTime = event.timeStamp;
        knobState.dragLastRateTime = event.timeStamp;
        armPlaybackRateStopTimer();
        return;
      }

      if (knobState.activeControl === 'start') {
        const nextOffset = Number(
          normalizeTrackStartOffset(
            knobState.dragStartValue +
              knobState.dragAngleDelta * ROTATE_SECONDS_PER_RADIAN,
            getCurrentTrackDuration()
          ).toFixed(3)
        );

        if (nextOffset === knobState.currentStartOffset) {
          return;
        }

        knobState.currentStartOffset = nextOffset;
        saveTrackStartTime(knobState.currentTrackKey, nextOffset);
        applyControlState();
        renderAdjusterInfo(nextOffset);
        previewStartOffset?.(nextOffset);
        return;
      }

      if (knobState.activeControl === 'end') {
        const nextEndTime = Number(
          normalizeTrackEndTime(
            knobState.dragStartValue +
              knobState.dragAngleDelta * ROTATE_SECONDS_PER_RADIAN,
            getCurrentTrackDuration(),
            knobState.currentStartOffset
          ).toFixed(3)
        );

        if (nextEndTime === knobState.currentEndTime) {
          return;
        }

        knobState.currentEndTime = nextEndTime;
        saveTrackEndTime(knobState.currentTrackKey, nextEndTime);
        applyControlState();
        renderAdjusterInfo(knobState.currentStartOffset);
        previewEndOffset?.(nextEndTime);
        return;
      }

      if (knobState.activeControl === 'gain') {
        const nextGain = Number(
          normalizeTrackGain(
            knobState.dragStartValue +
              knobState.dragAngleDelta * ROTATE_GAIN_PER_RADIAN
          ).toFixed(2)
        );

        if (nextGain === knobState.currentGain) {
          return;
        }

        knobState.currentGain = nextGain;
        saveTrackGain(knobState.currentTrackKey, nextGain);
        applyControlState();
        updateGainPreview();
        return;
      }

      if (knobState.activeControl === 'repeat') {
        const nextRepeatVisualValue = normalizeTrackRepeatVisualValue(
          knobState.dragStartValue + knobState.dragAngleDelta
        );
        const nextRepeatCount = normalizeTrackRepeatCount(
          nextRepeatVisualValue
        );

        knobState.currentRepeatVisualValue = nextRepeatVisualValue;

        if (nextRepeatCount === knobState.currentRepeatCount) {
          return;
        }

        knobState.currentRepeatCount = nextRepeatCount;
        saveTrackRepeatCount(knobState.currentTrackKey, nextRepeatCount);
        onRepeatCountChange?.(knobState.currentTrackKey, nextRepeatCount);
        applyControlState();
        renderAdjusterInfo(knobState.currentStartOffset);
      }
    });

    const endDrag = event => {
      if (!knobState.isActive || event.pointerId !== knobState.pointerId) {
        return;
      }

      knobState.isActive = false;
      knobState.pointerId = null;
      if (!knobState.activeControl) {
        window.clearTimeout(knobState.playbackRateStopTimer);
        dom.audioElement.playbackRate = 1;
      } else if (knobState.activeControl === 'gain') {
        previewTrackGain?.({ commit: true, forceVisible: true });
      }
      sync(true);
    };

    dom.trackArtworkEl.addEventListener('pointerup', endDrag);
    dom.trackArtworkEl.addEventListener('pointercancel', endDrag);

    document.addEventListener('pointerdown', event => {
      if (
        !knobState.activeControl ||
        event.target.closest(
          '#trackStartToggle, #trackEndToggle, #trackGainToggle, #trackRepeatToggle, #trackStartDefaultBtn, #trackEndDefaultBtn, #trackGainDefaultBtn, #trackGainUnityBtn, #trackArtwork'
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
