export function createPlaylistDragController({ listEl, onReorder }) {
  let draggedItem = null;
  let placeholder = null;
  let pointerId = null;
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  let startY = 0;
  let suppressClick = false;
  let draggedStyle = '';

  function finishDrag(event) {
    if (!draggedItem || event.pointerId !== pointerId) {
      return;
    }

    const wasDragged = Boolean(placeholder);

    if (placeholder) {
      draggedItem.style.cssText = draggedStyle;
      placeholder.replaceWith(draggedItem);
      placeholder = null;
    }

    if (wasDragged) {
      const nextKey = draggedItem.nextElementSibling?.dataset.playlistKey;
      onReorder(draggedItem.dataset.playlistKey, nextKey);
    }

    draggedItem = null;
    pointerId = null;
    suppressClick = wasDragged && event.type === 'pointerup';
  }

  listEl.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-playlist-drag]');

    if (!handle) {
      return;
    }

    draggedItem = handle.closest('[data-playlist-key]');
    pointerId = event.pointerId;
    startY = event.clientY;
    const rect = draggedItem.getBoundingClientRect();
    grabOffsetX = event.clientX - rect.left;
    grabOffsetY = event.clientY - rect.top;
    handle.setPointerCapture(pointerId);
  });

  document.addEventListener('pointermove', event => {
    if (!draggedItem || event.pointerId !== pointerId) {
      return;
    }

    if (!placeholder) {
      if (Math.abs(event.clientY - startY) < 5) {
        return;
      }

      const rect = draggedItem.getBoundingClientRect();
      placeholder = document.createElement('li');
      placeholder.style.height = `${rect.height}px`;
      draggedStyle = draggedItem.style.cssText;
      draggedItem.replaceWith(placeholder);
      draggedItem.style.position = 'fixed';
      draggedItem.style.left = '0';
      draggedItem.style.top = '0';
      draggedItem.style.width = `${rect.width}px`;
      draggedItem.style.boxSizing = 'border-box';
      draggedItem.style.zIndex = '1000';
      draggedItem.style.background = '#1a1a1a';
      draggedItem.style.willChange = 'transform';
      document.body.appendChild(draggedItem);
    }

    draggedItem.style.transform = `translate3d(${event.clientX - grabOffsetX}px, ${event.clientY - grabOffsetY}px, 0)`;
    const target = [...listEl.querySelectorAll('[data-playlist-key]')].find(
      item =>
        event.clientY <
        item.getBoundingClientRect().top + item.offsetHeight / 2
    );

    listEl.insertBefore(placeholder, target ?? null);
  });

  document.addEventListener('pointerup', finishDrag);
  document.addEventListener('pointercancel', finishDrag);
  listEl.addEventListener(
    'click',
    event => {
      if (suppressClick && event.target.closest('[data-playlist-drag]')) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      }
    },
    true
  );
}
