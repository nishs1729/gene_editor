import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMouseHandlers, createSelectionKeyHandlers } from '../selection.js';
import { createDocument } from '../sequenceModel.js';

// selection.js attaches drag tracking to the window; node has none.
vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });

function key(k, opts = {}) {
  return { key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...opts };
}

function makeStore() {
  return {
    setSelection: vi.fn(),
    setCursorPos: vi.fn(),
    setActiveDoc: vi.fn(),
    setColumnCursor: vi.fn(),
    setDragInsertIndex: vi.fn(),
    moveRange: vi.fn(),
    toggleDocSelection: vi.fn(),
    clearDocSelection: vi.fn(),
    selectDocRange: vi.fn(),
    setNameGutterWidth: vi.fn(),
    showToast: vi.fn(),
  };
}

describe('selection keys — single document', () => {
  let store, handle, doc;

  beforeEach(() => {
    store = makeStore();
    doc = { ...createDocument('a', 'ACGTACGTACGT'), cursorPos: 5, selection: null };
    ({ handleSelectionKeys: handle } = createSelectionKeyHandlers(
      () => ({ state: { documents: [doc], columnCursor: null }, doc, basesPerRow: 4 }),
      store
    ));
  });

  it('moves the cursor left and right', () => {
    expect(handle(key('ArrowLeft'))).toBe(true);
    expect(store.setCursorPos).toHaveBeenCalledWith(4);
    handle(key('ArrowRight'));
    expect(store.setCursorPos).toHaveBeenCalledWith(6);
  });

  it('clamps at both ends', () => {
    doc.cursorPos = 0;
    handle(key('ArrowLeft'));
    expect(store.setCursorPos).toHaveBeenCalledWith(0);
    doc.cursorPos = doc.raw.length;
    handle(key('ArrowRight'));
    expect(store.setCursorPos).toHaveBeenCalledWith(doc.raw.length);
  });

  it('moves a whole wrapped row vertically', () => {
    handle(key('ArrowDown'));
    expect(store.setCursorPos).toHaveBeenCalledWith(9);
    handle(key('ArrowUp'));
    expect(store.setCursorPos).toHaveBeenCalledWith(1);
  });

  it('Home and End work within the wrapped row', () => {
    handle(key('Home'));
    expect(store.setCursorPos).toHaveBeenCalledWith(4);
    handle(key('End'));
    expect(store.setCursorPos).toHaveBeenCalledWith(8);
  });

  it('extends a selection with Shift instead of moving the cursor', () => {
    handle(key('ArrowRight', { shiftKey: true }));
    expect(store.setSelection).toHaveBeenCalledWith(5, 6);
    expect(store.setCursorPos).not.toHaveBeenCalled();
  });

  it('extends from the far end of an existing selection', () => {
    doc.selection = { start: 2, end: 5 };
    handle(key('ArrowRight', { shiftKey: true }));
    expect(store.setSelection).toHaveBeenCalledWith(2, 6);
  });

  it('Ctrl+A selects everything', () => {
    expect(handle(key('a', { ctrlKey: true }))).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(0, doc.raw.length);
  });

  it('leaves unrelated keys to the editing handler', () => {
    expect(handle(key('a'))).toBe(false);
    expect(handle(key('Backspace'))).toBe(false);
  });
});

describe('selection keys — stacked documents', () => {
  let store, handle, docs, state;

  beforeEach(() => {
    store = makeStore();
    docs = [
      { ...createDocument('a', 'ACGTACGT'), cursorPos: 2, selection: null },
      { ...createDocument('b', 'ACGTACGT'), cursorPos: 0, selection: null },
      { ...createDocument('c', 'ACGTACGT'), cursorPos: 0, selection: null },
    ];
    state = { documents: docs, columnCursor: null };
    ({ handleSelectionKeys: handle } = createSelectionKeyHandlers(
      () => ({ state, doc: docs[1], basesPerRow: 4 }),
      store
    ));
  });

  it('up and down move between sequences, since stacked rows are unwrapped', () => {
    handle(key('ArrowUp'));
    expect(store.setActiveDoc).toHaveBeenCalledWith(docs[0].id);
    handle(key('ArrowDown'));
    expect(store.setActiveDoc).toHaveBeenCalledWith(docs[2].id);
    expect(store.setCursorPos).not.toHaveBeenCalled();
  });

  it('stops at the first and last sequence', () => {
    ({ handleSelectionKeys: handle } = createSelectionKeyHandlers(
      () => ({ state, doc: docs[0], basesPerRow: 4 }), store
    ));
    expect(handle(key('ArrowUp'))).toBe(true);
    expect(store.setActiveDoc).not.toHaveBeenCalled();
  });

  it('Home and End span the whole unwrapped sequence', () => {
    handle(key('End'));
    expect(store.setCursorPos).toHaveBeenCalledWith(8);
    handle(key('Home'));
    expect(store.setCursorPos).toHaveBeenCalledWith(0);
  });
});

describe('selection keys — column cursor', () => {
  let store, handle, state;

  beforeEach(() => {
    store = makeStore();
    state = {
      documents: [createDocument('a', 'ACGT'), createDocument('b', 'ACGTACGTAC')],
      columnCursor: 3,
    };
    ({ handleSelectionKeys: handle } = createSelectionKeyHandlers(
      () => ({ state, doc: state.documents[0], basesPerRow: 4 }),
      store
    ));
  });

  it('moves the column cursor, not the row cursor', () => {
    handle(key('ArrowRight'));
    expect(store.setColumnCursor).toHaveBeenCalledWith(4);
    handle(key('ArrowLeft'));
    expect(store.setColumnCursor).toHaveBeenCalledWith(2);
    expect(store.setCursorPos).not.toHaveBeenCalled();
  });

  it('clamps to the longest sequence, not the active one', () => {
    state.columnCursor = 9;
    handle(key('ArrowRight'));
    expect(store.setColumnCursor).toHaveBeenCalledWith(9);
  });

  it('does not run off the left edge', () => {
    state.columnCursor = 0;
    handle(key('ArrowLeft'));
    expect(store.setColumnCursor).toHaveBeenCalledWith(0);
  });

  it('Escape leaves column mode', () => {
    expect(handle(key('Escape'))).toBe(true);
    expect(store.setColumnCursor).toHaveBeenCalledWith(null);
  });

  it('passes every other key through to the editing handler', () => {
    expect(handle(key('a'))).toBe(false);
    expect(handle(key('Backspace'))).toBe(false);
    expect(handle(key('ArrowUp'))).toBe(false);
    expect(handle(key('a', { ctrlKey: true }))).toBe(false);
  });
});

describe('mouse handling', () => {
  let store, renderer, hit, state, handlers, canvas;

  function mouse(opts = {}) {
    return { clientX: 100, clientY: 100, detail: 1, shiftKey: false, preventDefault: vi.fn(), ...opts };
  }

  beforeEach(() => {
    store = makeStore();
    hit = null;
    canvas = {
      style: {},
      focus: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    };
    renderer = {
      canvas,
      hitTest: () => hit,
      indexToPixel: () => null,
    };
    state = {
      documents: [createDocument('a', 'ACGTACGT'), createDocument('b', 'ACGTACGT')],
      activeDocId: null,
      selectedDocIds: new Set(),
      columnCursor: null,
    };
    state.activeDocId = state.documents[0].id;
    handlers = createMouseHandlers(
      renderer,
      () => ({ state, scroll: { top: 0, left: 0 }, editingEnabled: true }),
      store
    );
  });

  it('focuses the canvas, since preventDefault would otherwise suppress it', () => {
    // This is the bug that made typing silently do nothing after a click.
    hit = { kind: 'seq', docId: state.documents[0].id, index: 4 };
    handlers.onMouseDown(mouse());
    expect(canvas.focus).toHaveBeenCalled();
  });

  it('places a column cursor from a ruler click', () => {
    hit = { kind: 'ruler', index: 12 };
    handlers.onMouseDown(mouse());
    expect(store.setColumnCursor).toHaveBeenCalledWith(12);
  });

  it('refuses a ruler click while the sequences are locked', () => {
    handlers = createMouseHandlers(
      renderer,
      () => ({ state, scroll: { top: 0, left: 0 }, editingEnabled: false }),
      store
    );
    hit = { kind: 'ruler', index: 12 };
    handlers.onMouseDown(mouse());
    expect(store.setColumnCursor).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(expect.stringContaining('Allow Editing'), 'warning');
  });

  it('Ctrl+click selects a whole sequence', () => {
    hit = { kind: 'name', docId: state.documents[1].id };
    handlers.onMouseDown(mouse({ ctrlKey: true }));
    expect(store.toggleDocSelection).toHaveBeenCalledWith(state.documents[1].id);
    expect(store.clearDocSelection).not.toHaveBeenCalled();
  });

  it('Cmd+click does the same on macOS', () => {
    hit = { kind: 'name', docId: state.documents[1].id };
    handlers.onMouseDown(mouse({ metaKey: true }));
    expect(store.toggleDocSelection).toHaveBeenCalledWith(state.documents[1].id);
  });

  it('Ctrl+click works over the sequence too, without moving the base cursor', () => {
    hit = { kind: 'seq', docId: state.documents[1].id, index: 4 };
    handlers.onMouseDown(mouse({ ctrlKey: true }));
    expect(store.toggleDocSelection).toHaveBeenCalledWith(state.documents[1].id);
    expect(store.setCursorPos).not.toHaveBeenCalled();
  });

  it('double-clicking a name selects that sequence', () => {
    hit = { kind: 'name', docId: state.documents[1].id };
    handlers.onMouseDown(mouse({ detail: 2 }));
    expect(store.toggleDocSelection).toHaveBeenCalledWith(state.documents[1].id);
  });

  it('shift-clicking a name range-selects', () => {
    hit = { kind: 'name', docId: state.documents[1].id };
    handlers.onMouseDown(mouse({ shiftKey: true }));
    expect(store.selectDocRange).toHaveBeenCalledWith(state.documents[1].id);
  });

  it('a plain click clears the whole-sequence selection', () => {
    state.selectedDocIds = new Set([state.documents[0].id, state.documents[1].id]);
    hit = { kind: 'seq', docId: state.documents[0].id, index: 4 };
    handlers.onMouseDown(mouse());
    expect(store.clearDocSelection).toHaveBeenCalled();
  });

  it('a plain click on a name clears the selection and focuses that row', () => {
    state.selectedDocIds = new Set([state.documents[0].id]);
    hit = { kind: 'name', docId: state.documents[1].id };
    handlers.onMouseDown(mouse());
    expect(store.clearDocSelection).toHaveBeenCalled();
    expect(store.setActiveDoc).toHaveBeenCalledWith(state.documents[1].id);
    expect(store.toggleDocSelection).not.toHaveBeenCalled();
  });

  it('does not churn the store when nothing is selected', () => {
    hit = { kind: 'seq', docId: state.documents[0].id, index: 4 };
    handlers.onMouseDown(mouse());
    expect(store.clearDocSelection).not.toHaveBeenCalled();
  });

  it('shift-clicking a sequence still extends the base selection, not the row selection', () => {
    hit = { kind: 'seq', docId: state.documents[0].id, index: 6 };
    handlers.onMouseDown(mouse({ shiftKey: true }));
    expect(store.selectDocRange).not.toHaveBeenCalled();
    expect(store.setSelection).toHaveBeenCalled();
  });

  it('clicking a sequence leaves column mode', () => {
    state.columnCursor = 5;
    hit = { kind: 'seq', docId: state.documents[0].id, index: 4 };
    handlers.onMouseDown(mouse());
    expect(store.setColumnCursor).toHaveBeenCalledWith(null);
    expect(store.setCursorPos).toHaveBeenCalledWith(4);
  });

  it('double-click selects one base, triple-click the whole sequence', () => {
    hit = { kind: 'seq', docId: state.documents[0].id, index: 4 };
    handlers.onMouseDown(mouse({ detail: 2 }));
    expect(store.setSelection).toHaveBeenCalledWith(4, 5);
    handlers.onMouseDown(mouse({ detail: 3 }));
    expect(store.setSelection).toHaveBeenCalledWith(0, 8);
  });

  it('ignores clicks that hit nothing', () => {
    hit = null;
    const e = mouse();
    handlers.onMouseDown(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(canvas.focus).not.toHaveBeenCalled();
  });

  it('shows a pointer over names and a column cursor over the ruler', () => {
    hit = { kind: 'name', docId: state.documents[0].id };
    handlers.onMouseMove(mouse());
    expect(canvas.style.cursor).toBe('pointer');

    hit = { kind: 'ruler', index: 3 };
    handlers.onMouseMove(mouse());
    expect(canvas.style.cursor).toBe('col-resize');

    hit = { kind: 'seq', docId: state.documents[0].id, index: 3 };
    handlers.onMouseMove(mouse());
    expect(canvas.style.cursor).toBe('text');

    hit = null;
    handlers.onMouseMove(mouse());
    expect(canvas.style.cursor).toBe('default');
  });

  it('names always look clickable, since they are always a selection target', () => {
    hit = { kind: 'name', docId: state.documents[0].id };
    handlers.onMouseMove(mouse());
    expect(canvas.style.cursor).toBe('pointer');
  });
});


describe('dragging the name-column divider', () => {
  let store, renderer, hit, handlers, canvas;

  const mouse = (opts = {}) =>
    ({ clientX: 100, clientY: 100, detail: 1, shiftKey: false, preventDefault: vi.fn(), ...opts });
  /** The window-level move handler selection.js installs for the duration of a drag. */
  const dragMove = () => window.addEventListener.mock.calls.find(c => c[0] === 'mousemove')[1];

  beforeEach(() => {
    window.addEventListener.mockClear();
    store = makeStore();
    hit = { kind: 'gutterEdge' };
    canvas = { style: {}, focus: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    renderer = { canvas, hitTest: () => hit, indexToPixel: () => null };
    handlers = createMouseHandlers(renderer, () => ({
      state: {
        documents: [createDocument('a', 'ACGT'), createDocument('b', 'ACGT')],
        activeDocId: null,
        selectedDocIds: new Set(),
        columnCursor: null,
      },
      scroll: { top: 0, left: 0 },
      editingEnabled: true,
    }), store);
  });

  it('shows a resize cursor over the divider', () => {
    handlers.onMouseMove(mouse());
    expect(canvas.style.cursor).toBe('col-resize');
  });

  it('resizes the column to the pointer', () => {
    handlers.onMouseDown(mouse({ clientX: 150 }));
    dragMove()({ clientX: 210, clientY: 120 });
    expect(store.setNameGutterWidth).toHaveBeenCalledWith(210);
  });

  it('moves no cursor and selects nothing while resizing', () => {
    handlers.onMouseDown(mouse({ clientX: 150 }));
    dragMove()({ clientX: 210, clientY: 120 });
    expect(store.setSelection).not.toHaveBeenCalled();
    expect(store.setCursorPos).not.toHaveBeenCalled();
    expect(store.setActiveDoc).not.toHaveBeenCalled();
    expect(store.setColumnCursor).not.toHaveBeenCalled();
  });
});
