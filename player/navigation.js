export function createScreenNavigator({ state, screens, onPlayerScreenVisible }) {
  function applyTransforms(deltaX) {
    const width = window.innerWidth || 1;
    const progress = Math.max(-1, Math.min(1, deltaX / width));
    const currentIndex = state.currentScreen - 1;
    const leftIndex = currentIndex - 1;
    const rightIndex = currentIndex + 1;
    const draggingLeft = deltaX < 0;
    const draggingRight = deltaX > 0;

    screens.forEach((screen, index) => {
      if (!screen) {
        return;
      }

      let zIndex = 0;

      if (index === currentIndex) {
        screen.style.transform = `translateX(${progress * 100}%)`;
        zIndex = 2;
      } else if (index === rightIndex && draggingLeft) {
        screen.style.transform = 'translateX(0%)';
        zIndex = 1;
      } else if (index === leftIndex && draggingRight) {
        screen.style.transform = 'translateX(0%)';
        zIndex = 1;
      } else if (index < currentIndex) {
        screen.style.transform = 'translateX(-100%)';
      } else if (index > currentIndex) {
        screen.style.transform = 'translateX(100%)';
      }

      screen.style.zIndex = String(zIndex);
    });
  }

  function setScreen(nextScreen) {
    state.currentScreen = Math.max(1, Math.min(screens.length || 1, nextScreen));
    document.body.setAttribute('data-screen', String(state.currentScreen));
    applyTransforms(0);

    if (state.currentScreen === 2) {
      onPlayerScreenVisible?.();
    }
  }

  function onTouchStart(event) {
    const touch = event.changedTouches[0];
    state.touchStartX = touch.clientX;
    state.touchStartY = touch.clientY;
    state.touchActive = true;

    if (event.target.closest('#audioElement, #trackArtwork')) {
      state.touchActive = false;
      return;
    }

    state.touchScrollable = event.target.closest(
      '#filelistwrapper, #playlistswrapper'
    );
    screens.forEach(screen => screen?.classList.remove('animate'));
  }

  function onTouchMove(event) {
    if (!state.touchActive) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - state.touchStartX;
    const deltaY = touch.clientY - state.touchStartY;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      event.preventDefault?.();

      const hasLeftScreen = state.currentScreen > 1;
      const hasRightScreen = state.currentScreen < (screens.length || 1);
      let allowedDeltaX = deltaX;

      if (!hasLeftScreen && allowedDeltaX > 0) {
        allowedDeltaX = 0;
      }

      if (!hasRightScreen && allowedDeltaX < 0) {
        allowedDeltaX = 0;
      }

      applyTransforms(allowedDeltaX);
      return;
    }

    if (
      !state.touchScrollable ||
      state.touchScrollable.scrollHeight <= state.touchScrollable.clientHeight
    ) {
      event.preventDefault();
    }
  }

  function onTouchEnd(event) {
    if (!state.touchActive) {
      return;
    }

    state.touchActive = false;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - state.touchStartX;
    const deltaY = touch.clientY - state.touchStartY;
    const width = window.innerWidth || 1;

    if (Math.abs(deltaX) < Math.abs(deltaY)) {
      applyTransforms(0);
      return;
    }

    screens.forEach(screen => screen?.classList.add('animate'));

    const hasLeftScreen = state.currentScreen > 1;
    const hasRightScreen = state.currentScreen < (screens.length || 1);
    const passesThreshold = Math.abs(deltaX) > width * 0.2;

    if (deltaX < 0 && hasRightScreen && passesThreshold) {
      applyTransforms(-width);
      window.setTimeout(() => setScreen(state.currentScreen + 1), 200);
      return;
    }

    if (deltaX > 0 && hasLeftScreen && passesThreshold) {
      applyTransforms(width);
      window.setTimeout(() => setScreen(state.currentScreen - 1), 200);
      return;
    }

    applyTransforms(0);
  }

  function bindTouchNavigation() {
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  return {
    bindTouchNavigation,
    setScreen,
  };
}
