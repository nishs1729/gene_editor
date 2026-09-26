import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEditingKeyHandler } from '../editing.js';
import { createDocument } from '../sequenceModel.js';

/**
 * A keydown event as the handler sees it. `code` defaults to the physical key a
 * letter would come from, which is what the Alt bindings read.
 */
function key(k, opts = {}) {
  return {
    key: k,
    code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...opts,
  };
}
const space = (opts = {}) => key(' ', { code: 'Space', ...opts });

function makeStore() {
  return {
    save: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    substitute: vi.fn(),
    insertAt: vi.fn(),
    deleteRange: vi.fn(),
    replaceRange: vi.fn(),
    setCursorPos: vi.fn(),
    setColumnCursor: vi.fn(),
    startRename: vi.fn(),
    deleteSelectedDocs: vi.fn(),
    substituteColumn: vi.fn(),
    insertColumn: vi.fn(),
    deleteColumn: vi.fn(),
    deleteColumnRange: vi.fn(),
    substituteColumnRange: vi.fn(),
    replaceColumnRange: vi.fn(),
    showToast: vi.fn(),
  };
}

let store;
let context;
let onKeyDown;

/** Build a handler over one editable row, plus optional column-cursor or column-selection state. */
function setup({ raw = 'ACGTACGT', cursorPos = 3, selection = null, editingEnabled = true, columnCursor = null, columnSelection = null, documents = null } = {}) {
  const doc = { ...createDocument('row', raw), cursorPos, selection };
  const allDocs = documents ?? [doc, { ...createDocument('other', raw) }];
  context = {
    state: { documents: allDocs, columnCursor, columnSelection },
    doc,
    editingEnabled,
  };
  store = makeStore();
  onKeyDown = createEditingKeyHandler(() => context, store, () => false);
  return doc;
}

beforeEach(() => setup());

describe('row editing — typing', () => {
  it('inserts rather than overwrites, as Geneious does', () => {
    onKeyDown(key('g'));
    expect(store.insertAt).toHaveBeenCalledWith(3, 'G');
    expect(store.setCursorPos).toHaveBeenCalledWith(4);
    expect(store.substitute).not.toHaveBeenCalled();
  });

  it('substitutes in place with Alt, leaving the length unchanged', () => {
    onKeyDown(key('g', { altKey: true }));
    expect(store.substitute).toHaveBeenCalledWith(3, 'G');
    expect(store.insertAt).not.toHaveBeenCalled();
  });

  it('reads the physical key under Alt, since macOS emits accented glyphs there', () => {
    onKeyDown(key('ø', { altKey: true, code: 'KeyO' }));
    expect(store.substitute).not.toHaveBeenCalled(); // O is not a valid base
    onKeyDown(key('©', { altKey: true, code: 'KeyG' }));
    expect(store.substitute).toHaveBeenCalledWith(3, 'G');
  });

  it('replaces a selection in one undoable step', () => {
    setup({ selection: { start: 2, end: 6 } });
    onKeyDown(key('a'));
    expect(store.replaceRange).toHaveBeenCalledWith(2, 6, 'A');
    expect(store.deleteRange).not.toHaveBeenCalled();
    expect(store.setCursorPos).toHaveBeenCalledWith(3);
  });

  it('fills a selection with Alt+base without changing its length', () => {
    setup({ selection: { start: 2, end: 6 } });
    onKeyDown(key('a', { altKey: true }));
    expect(store.replaceRange).toHaveBeenCalledWith(2, 6, 'AAAA');
  });

  it('ignores characters that are not IUPAC codes', () => {
    onKeyDown(key('z'));
    onKeyDown(key('7'));
    expect(store.insertAt).not.toHaveBeenCalled();
  });

  it('accepts IUPAC ambiguity codes', () => {
    onKeyDown(key('y'));
    expect(store.insertAt).toHaveBeenCalledWith(3, 'Y');
  });
});

describe('space inserts a gap', () => {
  it('inserts a gap at the cursor', () => {
    onKeyDown(space());
    expect(store.insertAt).toHaveBeenCalledWith(3, '-');
    expect(store.setCursorPos).toHaveBeenCalledWith(4);
  });

  it('substitutes a gap in place with Alt', () => {
    onKeyDown(space({ altKey: true }));
    expect(store.substitute).toHaveBeenCalledWith(3, '-');
  });

  it('replaces a selection with a single gap', () => {
    setup({ selection: { start: 1, end: 5 } });
    onKeyDown(space());
    expect(store.replaceRange).toHaveBeenCalledWith(1, 5, '-');
  });

  it('stops the page from scrolling', () => {
    const e = space();
    onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('is blocked while the sequence is locked', () => {
    setup({ editingEnabled: false });
    onKeyDown(space());
    expect(store.insertAt).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(expect.stringContaining('Allow Editing'), 'warning');
  });

  it('also reaches the gap via the hyphen key', () => {
    onKeyDown(key('-', { code: 'Minus' }));
    expect(store.insertAt).toHaveBeenCalledWith(3, '-');
  });
});

describe('row editing — deletion', () => {
  it('backspace removes the base before the cursor', () => {
    onKeyDown(key('Backspace'));
    expect(store.deleteRange).toHaveBeenCalledWith(2, 3);
    expect(store.setCursorPos).toHaveBeenCalledWith(2);
  });

  it('delete removes the base at the cursor', () => {
    onKeyDown(key('Delete'));
    expect(store.deleteRange).toHaveBeenCalledWith(3, 4);
  });

  it('Alt+delete leaves a gap instead of closing the column up', () => {
    onKeyDown(key('Delete', { altKey: true }));
    expect(store.replaceRange).toHaveBeenCalledWith(3, 4, '-');
    expect(store.deleteRange).not.toHaveBeenCalled();
  });

  it('Alt+backspace gaps the preceding base', () => {
    onKeyDown(key('Backspace', { altKey: true }));
    expect(store.replaceRange).toHaveBeenCalledWith(2, 3, '-');
    expect(store.setCursorPos).toHaveBeenCalledWith(2);
  });

  it('deletes a whole selection', () => {
    setup({ selection: { start: 1, end: 4 } });
    onKeyDown(key('Backspace'));
    expect(store.deleteRange).toHaveBeenCalledWith(1, 4);
    expect(store.setCursorPos).toHaveBeenCalledWith(1);
  });

  it('gaps a whole selection with Alt, keeping its length', () => {
    setup({ selection: { start: 1, end: 4 } });
    onKeyDown(key('Backspace', { altKey: true }));
    expect(store.replaceRange).toHaveBeenCalledWith(1, 4, '---');
  });

  it('does nothing at the start of the sequence', () => {
    setup({ cursorPos: 0 });
    onKeyDown(key('Backspace'));
    expect(store.deleteRange).not.toHaveBeenCalled();
  });

  it('does nothing past the end of the sequence', () => {
    setup({ cursorPos: 8 });
    onKeyDown(key('Delete'));
    expect(store.deleteRange).not.toHaveBeenCalled();
  });
});

describe('the edit lock', () => {
  beforeEach(() => setup({ editingEnabled: false, selection: { start: 0, end: 4 } }));

  it('blocks typing and explains why', () => {
    onKeyDown(key('a'));
    expect(store.replaceRange).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(expect.stringContaining('Allow Editing'), 'warning');
  });

  it('blocks deletion and undo', () => {
    onKeyDown(key('Backspace'));
    onKeyDown(key('z', { ctrlKey: true }));
    expect(store.deleteRange).not.toHaveBeenCalled();
    expect(store.undo).not.toHaveBeenCalled();
  });

  it('still allows saving', () => {
    onKeyDown(key('s', { ctrlKey: true }));
    expect(store.save).toHaveBeenCalled();
  });
});

describe('undo / redo / save shortcuts', () => {
  it('Ctrl+Z undoes and Ctrl+Shift+Z redoes', () => {
    onKeyDown(key('z', { ctrlKey: true }));
    expect(store.undo).toHaveBeenCalled();
    onKeyDown(key('z', { ctrlKey: true, shiftKey: true }));
    expect(store.redo).toHaveBeenCalled();
  });

  it('Ctrl+Y also redoes', () => {
    onKeyDown(key('y', { ctrlKey: true }));
    expect(store.redo).toHaveBeenCalled();
  });

  it('Ctrl+S saves', () => {
    onKeyDown(key('s', { ctrlKey: true }));
    expect(store.save).toHaveBeenCalled();
  });

  it('does not treat a modified letter as a base', () => {
    onKeyDown(key('a', { ctrlKey: true }));
    expect(store.insertAt).not.toHaveBeenCalled();
  });
});

describe('column-cursor editing', () => {
  // Two 8-base rows; the column cursor sits at index 3 and edits both at once.
  const cols = opts => setup({ columnCursor: 3, ...opts });

  beforeEach(() => cols());

  it('typing inserts a whole new column, which keeps rows in register', () => {
    onKeyDown(key('g'));
    expect(store.insertColumn).toHaveBeenCalledWith(3, 'G');
    expect(store.setColumnCursor).toHaveBeenCalledWith(4);
    expect(store.insertAt).not.toHaveBeenCalled(); // never falls through to row editing
  });

  it('Alt+base substitutes the column in place', () => {
    onKeyDown(key('g', { altKey: true }));
    expect(store.substituteColumn).toHaveBeenCalledWith(3, 'G');
    expect(store.insertColumn).not.toHaveBeenCalled();
  });

  it('space inserts a gap column', () => {
    onKeyDown(space());
    expect(store.insertColumn).toHaveBeenCalledWith(3, '-');
  });

  it('Alt+space gaps the column in place', () => {
    onKeyDown(space({ altKey: true }));
    expect(store.substituteColumn).toHaveBeenCalledWith(3, '-');
  });

  it('backspace deletes the column before the cursor', () => {
    onKeyDown(key('Backspace'));
    expect(store.deleteColumn).toHaveBeenCalledWith(2);
  });

  it('delete removes the column at the cursor', () => {
    onKeyDown(key('Delete'));
    expect(store.deleteColumn).toHaveBeenCalledWith(3);
  });

  it('keeps the cursor inside the shortened alignment after a delete', () => {
    cols({ columnCursor: 7 });
    onKeyDown(key('Delete'));
    expect(store.setColumnCursor).toHaveBeenCalledWith(6);
  });

  it('Alt+delete gaps the column instead of removing it', () => {
    onKeyDown(key('Delete', { altKey: true }));
    expect(store.substituteColumn).toHaveBeenCalledWith(3, '-');
    expect(store.deleteColumn).not.toHaveBeenCalled();
  });

  it('does not delete past either end of the alignment', () => {
    cols({ columnCursor: 0 });
    onKeyDown(key('Backspace'));
    expect(store.deleteColumn).not.toHaveBeenCalled();
  });

  it('warns on an invalid base rather than silently doing nothing', () => {
    onKeyDown(key('z'));
    expect(store.insertColumn).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(expect.stringContaining('not a valid IUPAC base'), 'warning');
  });

  it('is blocked while the sequences are locked', () => {
    cols({ editingEnabled: false });
    onKeyDown(key('g'));
    expect(store.insertColumn).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(expect.stringContaining('Allow Editing'), 'warning');
  });

  it('measures the alignment by the longest row, not the active one', () => {
    setup({
      columnCursor: 9,
      documents: [createDocument('short', 'ACGT'), createDocument('long', 'ACGTACGTACGT')],
    });
    onKeyDown(key('Delete'));
    expect(store.deleteColumn).toHaveBeenCalledWith(9);
  });

  it('leaves clipboard and save shortcuts alone', () => {
    onKeyDown(key('s', { ctrlKey: true }));
    expect(store.save).toHaveBeenCalled();
    onKeyDown(key('v', { ctrlKey: true }));
    expect(store.insertColumn).not.toHaveBeenCalled();
  });

  it('undo and redo work via keyboard shortcut when column cursor is active', () => {
    onKeyDown(key('z', { ctrlKey: true }));
    expect(store.undo).toHaveBeenCalled();
    onKeyDown(key('z', { ctrlKey: true, shiftKey: true }));
    expect(store.redo).toHaveBeenCalled();
    onKeyDown(key('y', { ctrlKey: true }));
    expect(store.redo).toHaveBeenCalledTimes(2);
  });
});

describe('column-selection editing', () => {
  // Columns 2 to 5 selected across all sequences
  const colSel = opts => setup({ columnSelection: { start: 2, end: 5 }, ...opts });

  beforeEach(() => colSel());

  it('typing replaces the column selection across all rows', () => {
    onKeyDown(key('a'));
    expect(store.replaceColumnRange).toHaveBeenCalledWith(2, 5, 'A');
    expect(store.setColumnCursor).toHaveBeenCalledWith(3);
    expect(store.insertAt).not.toHaveBeenCalled();
  });

  it('backspace deletes the selected column range across all rows', () => {
    onKeyDown(key('Backspace'));
    expect(store.deleteColumnRange).toHaveBeenCalledWith(2, 5);
    expect(store.setColumnCursor).toHaveBeenCalledWith(2);
  });

  it('delete removes the selected column range across all rows', () => {
    onKeyDown(key('Delete'));
    expect(store.deleteColumnRange).toHaveBeenCalledWith(2, 5);
    expect(store.setColumnCursor).toHaveBeenCalledWith(2);
  });

  it('Alt+Backspace gaps the column range in place', () => {
    onKeyDown(key('Backspace', { altKey: true }));
    expect(store.substituteColumnRange).toHaveBeenCalledWith(2, 5, '-');
    expect(store.setColumnCursor).toHaveBeenCalledWith(2);
  });

  it('Alt+Delete gaps the column range in place', () => {
    onKeyDown(key('Delete', { altKey: true }));
    expect(store.substituteColumnRange).toHaveBeenCalledWith(2, 5, '-');
    expect(store.setColumnCursor).toHaveBeenCalledWith(2);
  });

  it('is blocked while editing is disabled', () => {
    colSel({ editingEnabled: false });
    onKeyDown(key('a'));
    expect(store.deleteColumnRange).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(expect.stringContaining('Allow Editing'), 'warning');
  });

  it('warns on an invalid base', () => {
    onKeyDown(key('z'));
    expect(store.deleteColumnRange).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(expect.stringContaining('not a valid IUPAC base'), 'warning');
  });

  it('undo and redo work via keyboard shortcut when column selection is active', () => {
    onKeyDown(key('z', { ctrlKey: true }));
    expect(store.undo).toHaveBeenCalled();
    onKeyDown(key('z', { ctrlKey: true, shiftKey: true }));
    expect(store.redo).toHaveBeenCalled();
    onKeyDown(key('y', { ctrlKey: true }));
    expect(store.redo).toHaveBeenCalledTimes(2);
  });
});

describe('handler precedence', () => {
  it('yields to the selection handler when it consumes the key', () => {
    const consumed = vi.fn(() => true);
    const s = makeStore();
    const handler = createEditingKeyHandler(() => context, s, consumed);
    const e = key('ArrowLeft');
    handler(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(s.insertAt).not.toHaveBeenCalled();
  });

  it('does nothing without an active document outside column mode', () => {
    context = { state: { documents: [], columnCursor: null }, doc: null, editingEnabled: true };
    expect(() => onKeyDown(key('a'))).not.toThrow();
    expect(store.insertAt).not.toHaveBeenCalled();
  });
});

describe('renaming', () => {
  it('opens the rename prompt for the focused row on F2', () => {
    const doc = setup();
    onKeyDown(key('F2'));
    expect(store.startRename).toHaveBeenCalledWith(doc.id);
  });

  it('renames a single selected row in preference to the focused one', () => {
    setup();
    const other = context.state.documents[1];
    context.state.selectedDocIds = new Set([other.id]);
    onKeyDown(key('F2'));
    expect(store.startRename).toHaveBeenCalledWith(other.id);
  });

  it('falls back to the focused row when the selection is ambiguous', () => {
    const doc = setup();
    context.state.selectedDocIds = new Set(context.state.documents.map(d => d.id));
    onKeyDown(key('F2'));
    expect(store.startRename).toHaveBeenCalledWith(doc.id);
  });

  it('works while the sequence is locked, since a name is not sequence data', () => {
    const doc = setup({ editingEnabled: false });
    onKeyDown(key('F2'));
    expect(store.startRename).toHaveBeenCalledWith(doc.id);
    expect(store.showToast).not.toHaveBeenCalled();
  });

  it('renames rather than typing while a column cursor is placed', () => {
    const doc = setup({ columnCursor: 4 });
    onKeyDown(key('F2'));
    expect(store.startRename).toHaveBeenCalledWith(doc.id);
    expect(store.insertColumn).not.toHaveBeenCalled();
  });
});

describe('deleting selected sequences', () => {
  function withSelectedRows(opts = {}) {
    setup(opts);
    context.state.selectedDocIds = new Set([context.state.documents[1].id]);
  }

  it('deletes the selected rows on Delete', () => {
    withSelectedRows();
    const e = key('Delete');
    onKeyDown(e);
    expect(store.deleteSelectedDocs).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('deletes the rows, not a base at the cursor, while rows are selected', () => {
    withSelectedRows();
    onKeyDown(key('Delete'));
    expect(store.deleteRange).not.toHaveBeenCalled();
  });

  it('still deletes a base when no row is selected', () => {
    setup();
    context.state.selectedDocIds = new Set();
    onKeyDown(key('Delete'));
    expect(store.deleteSelectedDocs).not.toHaveBeenCalled();
    expect(store.deleteRange).toHaveBeenCalledWith(3, 4);
  });

  it('respects the edit lock', () => {
    withSelectedRows({ editingEnabled: false });
    onKeyDown(key('Delete'));
    expect(store.deleteSelectedDocs).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(expect.stringMatching(/Allow Editing/), 'warning');
  });

  it('leaves Backspace to the bases, so editing never removes a row by accident', () => {
    withSelectedRows();
    onKeyDown(key('Backspace'));
    expect(store.deleteSelectedDocs).not.toHaveBeenCalled();
  });

  it('leaves Alt+Delete (delete in place) alone', () => {
    withSelectedRows();
    onKeyDown(key('Delete', { altKey: true }));
    expect(store.deleteSelectedDocs).not.toHaveBeenCalled();
  });
});
