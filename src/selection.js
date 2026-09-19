// Selection logic: mouse and keyboard handlers for the canvas.
// Mouse handling is a small state machine because one mousedown can start four
// different gestures depending on where it lands relative to the current selection.

const EDGE_HANDLE_PX = 5;

function docById(state, id) {
  return state.documents.find(d => d.id === id) ?? null;
}

/**
 * Creates mouse event handlers for selection on the canvas.
 * Drag tracking is attached to the window so a gesture survives the pointer
 * leaving the canvas.
 * @param {object} renderer - CanvasRenderer instance
 * @param {function} getContext - returns { state, scroll, editingEnabled }
 * @param {object} store - actions: setSelection, setCursorPos, setActiveDoc, moveRange, setDragInsertIndex, showToast
 * @returns {object} { onMouseDown, onMouseMove, destroy }
 */
export function createMouseHandlers(renderer, getContext, store) {
  let gesture = null; // 'select' | 'resize' | 'move' | null
  let anchor = null;      // fixed end for 'select' / 'resize'
  let moveSelection = null; // { start, end } being dragged
  let dropIndex = null;

  function toCanvasXY(e) {
    const rect = renderer.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Which selection edge, if any, the pointer is grabbing. */
  function edgeAt(x, y, doc, state, scroll) {
    if (!doc.selection) return null;
    for (const edge of ['start', 'end']) {
      const px = renderer.indexToPixel(doc.selection[edge], scroll, state, doc.id);
      if (!px) continue;
      if (Math.abs(x - px.x) <= EDGE_HANDLE_PX && y >= px.y && y <= px.y + px.height) {
        return edge;
      }
    }
    return null;
  }

  function onMouseDown(e) {
    const { x, y } = toCanvasXY(e);
    const { state, scroll } = getContext();
    const hit = renderer.hitTest(x, y, scroll, state);
    if (!hit) return;
    // preventDefault stops the page-level text selection drag, but it also
    // suppresses the focus the canvas needs to receive key events, so focus it here.
    e.preventDefault();
    renderer.canvas.focus();

    const wasActive = hit.docId === state.activeDocId;
    if (!wasActive) store.setActiveDoc(hit.docId);

    // Name-gutter click: focus the row, nothing else.
    if (hit.index === null) return;

    const doc = docById(state, hit.docId);
    if (!doc) return;

    if (e.detail === 3) {
      store.setSelection(0, doc.raw.length);
      return;
    }
    if (e.detail === 2) {
      const i = Math.min(hit.index, Math.max(0, doc.raw.length - 1));
      store.setSelection(i, i + 1);
      return;
    }

    if (e.shiftKey) {
      anchor = doc.selection
        ? (hit.index < doc.selection.start ? doc.selection.end : doc.selection.start)
        : (doc.cursorPos ?? hit.index);
      gesture = 'select';
      store.setSelection(anchor, hit.index);
      startTracking();
      return;
    }

    if (wasActive && doc.selection) {
      const edge = edgeAt(x, y, doc, state, scroll);
      if (edge) {
        anchor = edge === 'start' ? doc.selection.end : doc.selection.start;
        gesture = 'resize';
        startTracking();
        return;
      }
      if (hit.index > doc.selection.start && hit.index < doc.selection.end) {
        moveSelection = { ...doc.selection };
        dropIndex = null;
        gesture = 'move';
        renderer.canvas.style.cursor = 'grabbing';
        startTracking();
        return;
      }
    }

    anchor = hit.index;
    gesture = 'select';
    store.setCursorPos(hit.index);
    startTracking();
  }

  /** Hover feedback only — drag movement is handled by the window listener. */
  function onMouseMove(e) {
    if (gesture) return;
    const { x, y } = toCanvasXY(e);
    const { state, scroll } = getContext();
    const hit = renderer.hitTest(x, y, scroll, state);
    const canvas = renderer.canvas;

    if (!hit || hit.index === null) {
      canvas.style.cursor = 'default';
      return;
    }

    const doc = docById(state, hit.docId);
    if (doc && doc.id === state.activeDocId && doc.selection) {
      if (edgeAt(x, y, doc, state, scroll)) {
        canvas.style.cursor = 'ew-resize';
        return;
      }
      if (hit.index > doc.selection.start && hit.index < doc.selection.end) {
        canvas.style.cursor = 'grab';
        return;
      }
    }
    canvas.style.cursor = 'text';
  }

  function onDragMove(e) {
    const { x, y } = toCanvasXY(e);
    const { state, scroll } = getContext();
    const hit = renderer.hitTest(x, y, scroll, state);
    if (!hit || hit.index === null) return;

    if (gesture === 'select' || gesture === 'resize') {
      store.setSelection(anchor, hit.index);
    } else if (gesture === 'move') {
      const inside = hit.index >= moveSelection.start && hit.index <= moveSelection.end;
      dropIndex = inside ? null : hit.index;
      store.setDragInsertIndex(dropIndex);
    }
  }

  function onDragEnd() {
    if (gesture === 'move' && dropIndex !== null) {
      const { editingEnabled } = getContext();
      if (editingEnabled) {
        const { start, end } = moveSelection;
        store.moveRange(start, end, dropIndex);
        const length = end - start;
        const newStart = dropIndex > end ? dropIndex - length : dropIndex;
        store.setSelection(newStart, newStart + length);
      } else {
        store.showToast('Click "Allow Editing" to move bases', 'warning');
      }
    }

    store.setDragInsertIndex(null);
    gesture = null;
    anchor = null;
    moveSelection = null;
    dropIndex = null;
    renderer.canvas.style.cursor = 'text';
    stopTracking();
  }

  function startTracking() {
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }

  function stopTracking() {
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  }

  return { onMouseDown, onMouseMove, destroy: stopTracking };
}

/**
 * Creates keyboard handlers for cursor movement and selection.
 * @param {function} getContext - returns { state, doc, basesPerRow }
 * @param {object} store - actions: setSelection, setCursorPos, setActiveDoc
 * @returns {object} { handleSelectionKeys } — returns true if the key was consumed
 */
export function createSelectionKeyHandlers(getContext, store) {

  function handleSelectionKeys(e) {
    const { state, doc, basesPerRow } = getContext();
    if (!doc) return false;

    const pos = doc.cursorPos ?? 0;
    const stacked = state.documents.length > 1;

    /** Opposite end of the selection from the cursor, for Shift+arrow extension. */
    const extendAnchor = () => {
      if (!doc.selection) return pos;
      return pos === doc.selection.end ? doc.selection.start : doc.selection.end;
    };

    const moveTo = (newPos) => {
      if (e.shiftKey) store.setSelection(extendAnchor(), newPos);
      else store.setCursorPos(newPos);
    };

    switch (e.key) {
      case 'ArrowLeft':
        moveTo(Math.max(0, pos - 1));
        return true;

      case 'ArrowRight':
        moveTo(Math.min(doc.raw.length, pos + 1));
        return true;

      case 'ArrowUp': {
        // Stacked rows are unwrapped, so vertical movement means "previous sequence".
        if (stacked) {
          const i = state.documents.findIndex(d => d.id === doc.id);
          if (i > 0) store.setActiveDoc(state.documents[i - 1].id);
          return true;
        }
        moveTo(Math.max(0, pos - basesPerRow));
        return true;
      }

      case 'ArrowDown': {
        if (stacked) {
          const i = state.documents.findIndex(d => d.id === doc.id);
          if (i < state.documents.length - 1) store.setActiveDoc(state.documents[i + 1].id);
          return true;
        }
        moveTo(Math.min(doc.raw.length, pos + basesPerRow));
        return true;
      }

      case 'Home':
        moveTo(stacked ? 0 : Math.floor(pos / basesPerRow) * basesPerRow);
        return true;

      case 'End':
        moveTo(stacked
          ? doc.raw.length
          : Math.min(Math.floor(pos / basesPerRow) * basesPerRow + basesPerRow, doc.raw.length));
        return true;

      case 'a':
      case 'A':
        if (e.ctrlKey || e.metaKey) {
          store.setSelection(0, doc.raw.length);
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  return { handleSelectionKeys };
}
