import { describe, it, expect, beforeEach, vi } from 'vitest';

// store.js reads localStorage at module load, so the stub has to be in place
// before the dynamic import below.
function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}
const storage = makeLocalStorage();
vi.stubGlobal('localStorage', storage);

const { default: useStore, getActiveDoc, MIN_ZOOM, MAX_ZOOM, MIN_GUTTER_WIDTH, MAX_GUTTER_WIDTH } =
  await import('../store.js');

const RECORDS = [
  { name: 'alpha', sequence: 'ACGTACGT' },
  { name: 'beta', sequence: 'ACGTACGT' },
  { name: 'gamma', sequence: 'ACGTTCGT' },
];

const get = () => useStore.getState();
const ws = () => get().workspace;
const docs = () => ws().documents;
const ids = () => docs().map(d => d.id);

beforeEach(() => {
  storage.clear();
  get().loadWorkspace(RECORDS);
  // loadWorkspace deliberately preserves view settings, so reset them explicitly.
  useStore.setState(s => ({
    workspace: {
      ...s.workspace,
      viewSettings: {
        lineWidth: 0,
        showComplement: false,
        showConsensus: true,
        consensusThreshold: 0.5,
        highlightMode: 'none',
        referenceDocId: null,
        fullscreen: false,
        zoom: 1,
        nameGutterWidth: null,
      },
    },
    toast: null,
  }));
});

describe('loadWorkspace', () => {
  it('creates one document per record and focuses the first', () => {
    expect(docs().map(d => d.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(ws().activeDocId).toBe(docs()[0].id);
    expect(getActiveDoc(get()).raw).toBe('ACGTACGT');
  });

  it('locks editing, as newly opened documents do in Geneious', () => {
    get().toggleEditingEnabled();
    expect(ws().editingEnabled).toBe(true);
    get().loadWorkspace(RECORDS);
    expect(ws().editingEnabled).toBe(false);
  });

  it('clears selection, column cursor and the stale reference', () => {
    get().toggleDocSelection(ids()[1]);
    get().toggleEditingEnabled();
    get().setColumnCursor(3);
    const staleId = ids()[1];

    get().loadWorkspace(RECORDS);
    expect(ws().selectedDocIds.size).toBe(0);
    expect(ws().columnCursor).toBe(null);
    expect(ws().viewSettings.referenceDocId).not.toBe(staleId);
    expect(ws().viewSettings.referenceDocId).toBe(null);
  });
});

describe('consensus view settings', () => {
  it('toggles the consensus row', () => {
    expect(ws().viewSettings.showConsensus).toBe(true);
    get().toggleConsensus();
    expect(ws().viewSettings.showConsensus).toBe(false);
  });

  it('sets the consensus threshold', () => {
    get().setConsensusThreshold(0.9);
    expect(ws().viewSettings.consensusThreshold).toBe(0.9);
  });

  it('clamps the threshold to a valid fraction', () => {
    get().setConsensusThreshold(2);
    expect(ws().viewSettings.consensusThreshold).toBe(1);
    get().setConsensusThreshold(-0.5);
    expect(ws().viewSettings.consensusThreshold).toBe(0);
  });
});

describe('highlighting', () => {
  it('defaults to no highlighting', () => {
    expect(ws().viewSettings.highlightMode).toBe('none');
  });

  it('switches mode', () => {
    get().setHighlightMode('consensus');
    expect(ws().viewSettings.highlightMode).toBe('consensus');
  });

  it('picks a reference automatically when reference mode is chosen', () => {
    useStore.setState(s => ({
      workspace: {
        ...s.workspace,
        viewSettings: { ...s.workspace.viewSettings, referenceDocId: null },
      },
    }));
    get().setHighlightMode('reference');
    expect(ws().viewSettings.referenceDocId).toBe(ids()[0]);
  });

  it('keeps an explicitly chosen reference across mode changes', () => {
    get().toggleReferenceDoc(ids()[2]);
    get().setHighlightMode('reference');
    expect(ws().viewSettings.referenceDocId).toBe(ids()[2]);
    get().setHighlightMode('none');
    expect(ws().viewSettings.referenceDocId).toBe(ids()[2]);
  });
});

describe('zoom', () => {
  it('starts at the base font size', () => {
    expect(ws().viewSettings.zoom).toBe(1);
  });

  it('sets a zoom factor', () => {
    get().setZoom(2);
    expect(ws().viewSettings.zoom).toBe(2);
  });

  it('clamps to the range the canvas stays legible in', () => {
    get().setZoom(99);
    expect(ws().viewSettings.zoom).toBe(MAX_ZOOM);
    get().setZoom(0.001);
    expect(ws().viewSettings.zoom).toBe(MIN_ZOOM);
  });
});

describe('name column width', () => {
  it('sizes itself to the names until it is dragged', () => {
    expect(ws().viewSettings.nameGutterWidth).toBe(null);
  });

  it('takes a dragged width', () => {
    get().setNameGutterWidth(240);
    expect(ws().viewSettings.nameGutterWidth).toBe(240);
  });

  it('rounds to whole pixels', () => {
    get().setNameGutterWidth(180.6);
    expect(ws().viewSettings.nameGutterWidth).toBe(181);
  });

  it('clamps a drag past either end', () => {
    get().setNameGutterWidth(5000);
    expect(ws().viewSettings.nameGutterWidth).toBe(MAX_GUTTER_WIDTH);
    get().setNameGutterWidth(-40);
    expect(ws().viewSettings.nameGutterWidth).toBe(MIN_GUTTER_WIDTH);
  });

  it('goes back to sizing itself when cleared', () => {
    get().setNameGutterWidth(240);
    get().setNameGutterWidth(null);
    expect(ws().viewSettings.nameGutterWidth).toBe(null);
  });
});

describe('reference sequence', () => {
  it('makes a sequence the reference, and a second toggle clears it', () => {
    get().toggleReferenceDoc(ids()[1]);
    expect(ws().viewSettings.referenceDocId).toBe(ids()[1]);
    get().toggleReferenceDoc(ids()[1]);
    expect(ws().viewSettings.referenceDocId).toBe(null);
  });

  it('moves the reference straight to another sequence', () => {
    get().toggleReferenceDoc(ids()[1]);
    get().toggleReferenceDoc(ids()[2]);
    expect(ws().viewSettings.referenceDocId).toBe(ids()[2]);
  });

  it('clears the row selection, which would otherwise cover the reference tint', () => {
    get().toggleDocSelection(ids()[1]);
    get().toggleReferenceDoc(ids()[1]);
    expect(ws().selectedDocIds.size).toBe(0);
  });

  it('turns reference highlighting off when the reference is removed', () => {
    get().toggleReferenceDoc(ids()[1]);
    get().setHighlightMode('reference');
    get().toggleReferenceDoc(ids()[1]);
    expect(ws().viewSettings.highlightMode).toBe('none');
  });

  it('leaves consensus highlighting alone', () => {
    get().setHighlightMode('consensus');
    get().toggleReferenceDoc(ids()[1]);
    get().toggleReferenceDoc(ids()[1]);
    expect(ws().viewSettings.highlightMode).toBe('consensus');
  });

  it('drops a reference that gets deleted', () => {
    get().toggleReferenceDoc(ids()[1]);
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs();
    expect(ws().viewSettings.referenceDocId).toBe(null);
  });

  it('keeps a reference that survives the deletion', () => {
    const reference = ids()[0];
    get().toggleReferenceDoc(reference);
    get().toggleDocSelection(ids()[2]);
    get().deleteSelectedDocs();
    expect(ws().viewSettings.referenceDocId).toBe(reference);
  });
});

describe('renaming', () => {
  it('opens and cancels the rename prompt', () => {
    get().startRename(ids()[1]);
    expect(ws().renamingDocId).toBe(ids()[1]);
    get().cancelRename();
    expect(ws().renamingDocId).toBe(null);
  });

  it('renames a sequence, marks it unsaved and closes the prompt', () => {
    get().startRename(ids()[1]);
    get().renameDoc(ids()[1], 'beta v2');
    expect(docs()[1].name).toBe('beta v2');
    expect(docs()[1].dirty).toBe(true);
    expect(ws().renamingDocId).toBe(null);
  });

  it('trims surrounding whitespace', () => {
    get().renameDoc(ids()[1], '  beta v2  ');
    expect(docs()[1].name).toBe('beta v2');
  });

  it('rejects an empty name, which would leave the row unidentifiable', () => {
    get().renameDoc(ids()[1], '   ');
    expect(docs()[1].name).toBe('beta');
    expect(docs()[1].dirty).toBe(false);
  });

  it('leaves the document untouched when the name has not changed', () => {
    const before = docs()[1];
    get().renameDoc(ids()[1], 'beta');
    expect(docs()[1]).toBe(before);
  });

  it('saves the new name', () => {
    get().renameDoc(ids()[1], 'beta v2');
    get().save();
    const saved = JSON.parse(storage.getItem('geneEditor.workspace'));
    expect(saved.documents[1].name).toBe('beta v2');
  });
});

describe('row multi-select', () => {
  it('toggles a document in and out of the selection', () => {
    const id = ids()[1];
    get().toggleDocSelection(id);
    expect([...ws().selectedDocIds]).toEqual([id]);
    get().toggleDocSelection(id);
    expect(ws().selectedDocIds.size).toBe(0);
  });

  it('shift-selects the inclusive range from the last click', () => {
    get().toggleDocSelection(ids()[0]);
    get().selectDocRange(ids()[2]);
    expect(ws().selectedDocIds.size).toBe(3);
  });

  it('range-selects backwards too', () => {
    get().toggleDocSelection(ids()[2]);
    get().selectDocRange(ids()[0]);
    expect(ws().selectedDocIds.size).toBe(3);
  });

  it('falls back to a plain toggle when there is no anchor', () => {
    get().selectDocRange(ids()[1]);
    expect([...ws().selectedDocIds]).toEqual([ids()[1]]);
  });

  it('clears the selection', () => {
    get().toggleDocSelection(ids()[0]);
    get().clearDocSelection();
    expect(ws().selectedDocIds.size).toBe(0);
  });
});

describe('deleteSelectedDocs', () => {
  it('removes exactly the checked documents', () => {
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs();
    expect(docs().map(d => d.name)).toEqual(['alpha', 'gamma']);
    expect(ws().selectedDocIds.size).toBe(0);
  });

  it('moves focus off a deleted active document', () => {
    get().toggleDocSelection(ids()[0]);
    get().deleteSelectedDocs();
    expect(ws().activeDocId).toBe(docs()[0].id);
    expect(getActiveDoc(get()).name).toBe('beta');
  });

  it('leaves focus alone when the active document survives', () => {
    const activeBefore = ws().activeDocId;
    get().toggleDocSelection(ids()[2]);
    get().deleteSelectedDocs();
    expect(ws().activeDocId).toBe(activeBefore);
  });

  it('does nothing when nothing is checked', () => {
    const before = docs();
    get().deleteSelectedDocs();
    expect(docs()).toBe(before);
  });

  it('drops the column cursor, which no longer describes the same rows', () => {
    get().toggleEditingEnabled();
    get().setColumnCursor(2);
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs();
    expect(ws().columnCursor).toBe(null);
  });

  it('reports what it deleted', () => {
    get().toggleDocSelection(ids()[0]);
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs();
    expect(get().toast.message).toBe('Deleted 2 sequences');
  });
});

describe('column cursor', () => {
  it('is dropped when editing is locked again', () => {
    get().toggleEditingEnabled();
    get().setColumnCursor(4);
    expect(ws().columnCursor).toBe(4);
    get().toggleEditingEnabled();
    expect(ws().columnCursor).toBe(null);
  });
});

describe('column edits', () => {
  it('substitutes the same column in every document', () => {
    get().substituteColumn(0, 'T');
    expect(docs().map(d => d.raw)).toEqual(['TCGTACGT', 'TCGTACGT', 'TCGTTCGT']);
  });

  it('inserts a column into every document, preserving alignment', () => {
    get().insertColumn(2, '-');
    expect(docs().map(d => d.raw)).toEqual(['AC-GTACGT', 'AC-GTACGT', 'AC-GTTCGT']);
    expect(new Set(docs().map(d => d.raw.length)).size).toBe(1);
  });

  it('deletes a column from every document, preserving alignment', () => {
    get().deleteColumn(0);
    expect(docs().map(d => d.raw)).toEqual(['CGTACGT', 'CGTACGT', 'CGTTCGT']);
    expect(new Set(docs().map(d => d.raw.length)).size).toBe(1);
  });

  it('skips documents that are too short rather than padding them', () => {
    get().loadWorkspace([
      { name: 'long', sequence: 'ACGTACGT' },
      { name: 'short', sequence: 'ACG' },
    ]);
    get().substituteColumn(5, 'T');
    expect(docs().map(d => d.raw)).toEqual(['ACGTATGT', 'ACG']);

    get().deleteColumn(5);
    expect(docs().map(d => d.raw)).toEqual(['ACGTAGT', 'ACG']);
  });

  it('records one undoable command per document', () => {
    get().substituteColumn(0, 'T');
    for (const doc of docs()) {
      expect(doc.history.length).toBe(1);
      expect(doc.history[0].type).toBe('substitute');
    }
  });

  it('keeps the stats panel in sync with the active document', () => {
    get().insertColumn(0, 'G');
    expect(get().stats.length).toBe(9);
  });
});

describe('active-document editing', () => {
  it('only touches the active document', () => {
    get().substitute(0, 'T');
    expect(docs().map(d => d.raw)).toEqual(['TCGTACGT', 'ACGTACGT', 'ACGTTCGT']);
  });

  it('gives each document its own undo history', () => {
    get().substitute(0, 'T');
    get().setActiveDoc(ids()[1]);
    get().substitute(1, 'T');
    get().undo();
    expect(docs().map(d => d.raw)).toEqual(['TCGTACGT', 'ACGTACGT', 'ACGTTCGT']);
  });
});

describe('save', () => {
  it('persists only names and sequences', () => {
    get().save();
    const stored = JSON.parse(storage.getItem('geneEditor.workspace'));
    expect(stored.documents).toEqual([
      { name: 'alpha', raw: 'ACGTACGT' },
      { name: 'beta', raw: 'ACGTACGT' },
      { name: 'gamma', raw: 'ACGTTCGT' },
    ]);
  });

  it('clears the dirty flags it just wrote out', () => {
    get().substitute(0, 'T');
    expect(docs().some(d => d.dirty)).toBe(true);
    get().save();
    expect(docs().some(d => d.dirty)).toBe(false);
  });
});

describe('theme', () => {
  it('toggles and persists the preference', () => {
    const start = get().theme;
    get().toggleTheme();
    expect(get().theme).not.toBe(start);
    expect(storage.getItem('geneEditor.theme')).toBe(get().theme);
  });
});

describe('toast', () => {
  it('replaces the previous message rather than letting its timer cut the new one short', () => {
    vi.useFakeTimers();
    try {
      get().showToast('first');
      vi.advanceTimersByTime(2500);
      get().showToast('second');
      vi.advanceTimersByTime(2500);
      // The first toast's 3s timer has now passed, but it must not clear the second.
      expect(get().toast?.message).toBe('second');
      vi.advanceTimersByTime(600);
      expect(get().toast).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });
});
