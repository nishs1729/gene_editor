// Selection logic: mouse and keyboard handlers for the canvas.
// Mouse handling is a small state machine because one mousedown can start four
// different gestures depending on where it lands relative to the current selection.

import { getCanvasApi } from './canvasBridge.js';

const EDGE_HANDLE_PX = 5;
// How far a name has to be dragged before it counts as reordering rather than
// as a click that focused the row.
const ROW_DRAG_THRESHOLD_PX = 4;

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
export function createMouseHandlers(renderer, getContext, store, requestRender = () => {}) {
  // 'select' | 'resize' | 'move' | 'gutter' | 'rulerDrag' | 'rowPending' | 'rowDrag' | 'minimap'
  let gesture = null;
  let anchor = null;      // fixed end for 'select' / 'resize'
  let rulerAnchor = null; // fixed column end for 'rulerDrag'
  let moveSelection = null; // { start, end } being dragged
  let dropIndex = null;
  let rowDragId = null;   // the name being dragged to a new position
  let rowDragStartY = 0;
  let rowDropDocIndex = null;

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

    if (hit.kind === 'gutterEdge') {
      gesture = 'gutter';
      renderer.canvas.style.cursor = 'col-resize';
      startTracking();
      return;
    }

    if (hit.kind === 'ruler') {
      // Ruler click sets column cursor; dragging along ruler selects a column range across all sequences.
      // Allowed even when editing is off — cursor placement & selection are navigation/inspection,
      // only the edits themselves require editingEnabled.
      rulerAnchor = hit.index;
      gesture = 'rulerDrag';
      store.setColumnCursor(hit.index);
      startTracking();
      return;
    }

    // The overview strip navigates: a click centres the view, a drag pans it.
    if (hit.kind === 'minimap') {
      gesture = 'minimap';
      getCanvasApi()?.centerOnColumn(hit.index, { flash: false });
      startTracking();
      return;
    }

    if (hit.kind === 'group') {
      store.toggleGroupCollapsed(hit.groupId);
      return;
    }

    if (hit.kind === 'rowIcon') {
      if (hit.icon === 'hide') store.toggleDocHidden(hit.docId);
      else store.togglePinnedDoc(hit.docId);
      return;
    }

    // Clicking a feature opens it for editing; the bases under it are not the target.
    if (hit.kind === 'annotation') {
      store.setActiveDoc(hit.docId);
      store.openAnnotation({
        docId: hit.docId,
        featureId: hit.feature.id,
        start: hit.feature.start,
        end: hit.feature.end,
      });
      return;
    }

    // Ctrl/Cmd+click adds a sequence to the selection without disturbing the rest,
    // Shift+click extends the range from the last one clicked.
    const mod = e.ctrlKey || e.metaKey;
    if (mod || (e.shiftKey && hit.kind === 'name')) {
      if (e.shiftKey) store.selectDocRange(hit.docId);
      else store.toggleDocSelection(hit.docId);
      return;
    }
    // Double-clicking a name renames it, as it would in a file browser.
    if (hit.kind === 'name' && e.detail === 2) {
      store.startRename(hit.docId);
      return;
    }

    const wasActive = hit.docId === state.activeDocId;
    if (!wasActive) store.setActiveDoc(hit.docId);
    // Clicking a sequence cell clears any column cursor/selection.
    if (state.columnCursor !== null) store.setColumnCursor(null);
    if (state.columnSelection !== null) store.setColumnSelection(null);

    // A plain click on a name selects that one sequence — "this one", where
    // Ctrl+click means "this one as well". If the press then moves, it is a
    // reorder drag instead, decided in onDragMove.
    if (hit.kind === 'name') {
      store.selectOnlyDoc(hit.docId);
      rowDragId = hit.docId;
      rowDragStartY = y;
      rowDropDocIndex = null;
      gesture = 'rowPending';
      startTracking();
      return;
    }

    // Clicking into the bases is the way out of a row selection.
    if ((state.selectedDocIds?.size ?? 0) > 0) store.clearDocSelection();

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

    // The gutter controls only appear on the row under the pointer, so a change
    // of row has to repaint even though nothing in the store moved.
    const hoverDocId = hit && (hit.kind === 'name' || hit.kind === 'rowIcon') ? hit.docId : null;
    if (renderer.hoverDocId !== hoverDocId) {
      renderer.hoverDocId = hoverDocId;
      requestRender();
    }

    if (!hit) {
      canvas.style.cursor = 'default';
      return;
    }
    if (hit.kind === 'gutterEdge') {
      canvas.style.cursor = 'col-resize';
      return;
    }
    if (hit.kind === 'name' || hit.kind === 'rowIcon' || hit.kind === 'group') {
      canvas.style.cursor = 'pointer';
      return;
    }
    if (hit.kind === 'minimap') {
      canvas.style.cursor = 'ew-resize';
      return;
    }
    if (hit.kind === 'ruler') {
      canvas.style.cursor = 'crosshair';
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

    // The divider follows the pointer directly.
    if (gesture === 'gutter') {
      store.setNameGutterWidth(x);
      return;
    }

    if (gesture === 'minimap') {
      const { state } = getContext();
      getCanvasApi()?.centerOnColumn(renderer.minimapColumnAt(x, state), { flash: false });
      return;
    }

    if (gesture === 'rowPending') {
      if (Math.abs(y - rowDragStartY) < ROW_DRAG_THRESHOLD_PX) return;
      gesture = 'rowDrag';
      renderer.canvas.style.cursor = 'grabbing';
    }

    if (gesture === 'rowDrag') {
      const { state, scroll } = getContext();
      const drop = renderer.rowDropAt(y, scroll, state);
      if (!drop) return;
      rowDropDocIndex = drop.docIndex;
      store.setRowDropIndex(drop.rowIndex);
      return;
    }

    // Ruler drag: update the column selection as the pointer moves horizontally.
    if (gesture === 'rulerDrag') {
      const { state, scroll } = getContext();
      const gutter = renderer.getGutterWidth ? renderer.getGutterWidth(state) : renderer._gutterWidth;
      const maxLen = state.documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
      const col = Math.max(0, Math.min(maxLen - 1,
        Math.round((x - gutter + scroll.left) / renderer.cellWidth)
      ));
      if (col === rulerAnchor) {
        store.setColumnCursor(rulerAnchor);
      } else {
        const start = Math.min(rulerAnchor, col);
        const end = Math.max(rulerAnchor, col) + 1; // end is exclusive like per-doc selection
        store.setColumnSelection({ start, end });
      }
      return;
    }

    const { state, scroll } = getContext();
    const hit = renderer.hitTest(x, y, scroll, state);
    if (!hit || hit.kind === 'name' || hit.kind === 'ruler' || hit.kind === 'gutterEdge') return;

    if (gesture === 'select' || gesture === 'resize') {
      store.setSelection(anchor, hit.index);
    } else if (gesture === 'move') {
      const inside = hit.index >= moveSelection.start && hit.index <= moveSelection.end;
      dropIndex = inside ? null : hit.index;
      store.setDragInsertIndex(dropIndex);
    }
  }

  function onDragEnd() {
    if (gesture === 'rulerDrag' || gesture === 'minimap') {
      rulerAnchor = null;
      gesture = null;
      renderer.canvas.style.cursor = 'default';
      stopTracking();
      return;
    }

    if (gesture === 'rowPending' || gesture === 'rowDrag') {
      if (gesture === 'rowDrag' && rowDropDocIndex !== null) {
        store.reorderDoc(rowDragId, rowDropDocIndex);
      }
      store.setRowDropIndex(null);
      rowDragId = null;
      rowDropDocIndex = null;
      gesture = null;
      renderer.canvas.style.cursor = 'pointer';
      stopTracking();
      return;
    }

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
 * @param {object} store - actions: setSelection, setCursorPos, setActiveDoc, setColumnCursor
 * @returns {object} { handleSelectionKeys } — returns true if the key was consumed
 */
export function createSelectionKeyHandlers(getContext, store) {

  function handleSelectionKeys(e) {
    const { state, doc, basesPerRow } = getContext();
    if (!doc) return false;

    // A column-range selection from a ruler drag: Escape clears it; Arrow keys collapse to cursor.
    if (state.columnSelection) {
      if (e.key === 'Escape') {
        store.setColumnSelection(null);
        return true;
      }
      if (e.key === 'ArrowLeft') {
        store.setColumnCursor(Math.min(state.columnSelection.start, state.columnSelection.end));
        return true;
      }
      if (e.key === 'ArrowRight') {
        store.setColumnCursor(Math.max(state.columnSelection.start, state.columnSelection.end));
        return true;
      }
    }

    // A column cursor spans every row; it moves independently of any one row's
    // cursor/selection and only understands Left/Right and Escape.
    if (state.columnCursor !== null) {
      const maxLen = state.documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
      switch (e.key) {
        case 'ArrowLeft':
          store.setColumnCursor(Math.max(0, state.columnCursor - 1));
          return true;
        case 'ArrowRight':
          store.setColumnCursor(Math.min(maxLen - 1, state.columnCursor + 1));
          return true;
        case 'Escape':
          store.setColumnCursor(null);
          return true;
        default:
          return false;
      }
    }

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
