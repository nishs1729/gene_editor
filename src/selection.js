// Selection logic: mouse and keyboard handlers for click/drag selection.
// These are pure handler factories — they return event handlers to attach to the canvas.

/**
 * Creates mouse event handlers for selection on the canvas.
 * @param {object} renderer - CanvasRenderer instance
 * @param {function} getState - returns current { doc, scrollTop }
 * @param {object} store - zustand store with setSelection, setCursorPos actions
 * @returns {object} { onMouseDown, onMouseMove, onMouseUp }
 */
export function createMouseHandlers(renderer, getState, store) {
  let isDragging = false;
  let dragStart = null;

  function onMouseDown(e) {
    const rect = renderer.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { doc, scrollTop } = getState();

    const index = renderer.pixelToIndex(x, y, scrollTop, doc);
    if (index === null) return;

    isDragging = true;
    dragStart = index;

    if (e.shiftKey && doc.cursorPos !== undefined) {
      // Extend existing selection
      store.setSelection(doc.cursorPos, index);
    } else {
      store.setCursorPos(index);
    }

    // Prevent text selection on the page
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isDragging || dragStart === null) return;

    const rect = renderer.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { doc, scrollTop } = getState();

    const index = renderer.pixelToIndex(x, y, scrollTop, doc);
    if (index === null) return;

    store.setSelection(dragStart, index);
  }

  function onMouseUp(e) {
    isDragging = false;
  }

  return { onMouseDown, onMouseMove, onMouseUp };
}

/**
 * Creates keyboard event handlers for selection (arrow keys, Shift+arrow, Ctrl+A, Home, End).
 * @param {function} getState - returns current { doc }
 * @param {object} store - zustand store with setSelection, setCursorPos
 * @param {function} getBasesPerRow - returns current basesPerRow
 * @returns {object} { handleSelectionKeys } — returns true if key was handled
 */
export function createSelectionKeyHandlers(getState, store, getBasesPerRow) {

  function handleSelectionKeys(e) {
    const { doc } = getState();
    const pos = doc.cursorPos ?? 0;
    const basesPerRow = getBasesPerRow();

    switch (e.key) {
      case 'ArrowLeft': {
        const newPos = Math.max(0, pos - 1);
        if (e.shiftKey) {
          const anchor = doc.selection ? doc.selection.start : pos;
          store.setSelection(anchor, newPos);
        } else {
          store.setCursorPos(newPos);
        }
        return true;
      }
      case 'ArrowRight': {
        const newPos = Math.min(doc.raw.length, pos + 1);
        if (e.shiftKey) {
          const anchor = doc.selection
            ? (pos === doc.selection.end ? doc.selection.start : doc.selection.end)
            : pos;
          store.setSelection(anchor, newPos);
        } else {
          store.setCursorPos(newPos);
        }
        return true;
      }
      case 'ArrowUp': {
        const newPos = Math.max(0, pos - basesPerRow);
        if (e.shiftKey) {
          const anchor = doc.selection ? doc.selection.start : pos;
          store.setSelection(anchor, newPos);
        } else {
          store.setCursorPos(newPos);
        }
        return true;
      }
      case 'ArrowDown': {
        const newPos = Math.min(doc.raw.length, pos + basesPerRow);
        if (e.shiftKey) {
          const anchor = doc.selection
            ? (pos === doc.selection.end ? doc.selection.start : doc.selection.end)
            : pos;
          store.setSelection(anchor, newPos);
        } else {
          store.setCursorPos(newPos);
        }
        return true;
      }
      case 'Home': {
        const rowStart = Math.floor(pos / basesPerRow) * basesPerRow;
        if (e.shiftKey) {
          const anchor = doc.selection ? doc.selection.end : pos;
          store.setSelection(anchor, rowStart);
        } else {
          store.setCursorPos(rowStart);
        }
        return true;
      }
      case 'End': {
        const rowEnd = Math.min(
          Math.floor(pos / basesPerRow) * basesPerRow + basesPerRow,
          doc.raw.length
        );
        if (e.shiftKey) {
          const anchor = doc.selection ? doc.selection.start : pos;
          store.setSelection(anchor, rowEnd);
        } else {
          store.setCursorPos(rowEnd);
        }
        return true;
      }
      case 'a':
      case 'A': {
        if (e.ctrlKey || e.metaKey) {
          // Select all
          store.setSelection(0, doc.raw.length);
          e.preventDefault();
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  return { handleSelectionKeys };
}
