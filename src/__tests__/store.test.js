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

  it('remembers the file the records came from, and forgets the last one', () => {
    get().loadWorkspace(RECORDS, 'aligned.fasta');
    expect(ws().fileName).toBe('aligned.fasta');
    get().loadWorkspace(RECORDS);
    expect(ws().fileName).toBe('');
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
    const refId = ids()[2];
    get().toggleReferenceDoc(refId);
    get().setHighlightMode('reference');
    expect(ws().viewSettings.referenceDocId).toBe(refId);
    get().setHighlightMode('none');
    expect(ws().viewSettings.referenceDocId).toBe(refId);
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

  it('clamps to the range the canvas can draw', () => {
    get().setZoom(99);
    expect(ws().viewSettings.zoom).toBe(MAX_ZOOM);
    get().setZoom(0.0000001);
    expect(ws().viewSettings.zoom).toBe(MIN_ZOOM);
  });
});

describe('minimum zoom follows the window', () => {
  it('starts at the absolute floor, before the canvas has measured anything', () => {
    expect(ws().minZoom).toBe(MIN_ZOOM);
  });

  it('takes the fit-to-window zoom as the limit on zooming out', () => {
    get().setMinZoom(0.05);
    expect(ws().minZoom).toBe(0.05);

    get().setZoom(0.001); // further out than everything-in-view
    expect(ws().viewSettings.zoom).toBe(0.05);
  });

  it('pulls the view back in when the window grows', () => {
    get().setMinZoom(0.05);
    get().setZoom(0.05); // sitting exactly at the limit
    // A wider window needs less zooming out to show the same alignment.
    get().setMinZoom(0.2);
    expect(ws().viewSettings.zoom).toBe(0.2);
  });

  it('leaves the view alone when the window shrinks', () => {
    get().setMinZoom(0.2);
    get().setZoom(1);
    get().setMinZoom(0.05); // a narrower window: more zooming out is now possible
    expect(ws().viewSettings.zoom).toBe(1);
  });

  it('never demands more than 100%, however short the sequence', () => {
    // A 10 base sequence in a wide window "fits" at several hundred percent,
    // which must not become the floor — you would be unable to zoom out at all.
    get().setMinZoom(8);
    expect(ws().minZoom).toBe(1);
  });

  it('keeps the absolute floor under an alignment too long to ever fit', () => {
    get().setMinZoom(0.0000001);
    expect(ws().minZoom).toBe(MIN_ZOOM);
  });

  it('ignores a value that has not moved', () => {
    get().setMinZoom(0.05);
    const before = ws();
    get().setMinZoom(0.05);
    expect(ws()).toBe(before);
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
    const refId = ids()[1];
    get().toggleReferenceDoc(refId);
    expect(ws().viewSettings.referenceDocId).toBe(refId);
    get().toggleReferenceDoc(refId);
    expect(ws().viewSettings.referenceDocId).toBe(null);
  });

  it('moves the reference sequence to the top of the document list', () => {
    const refId = ids()[1]; // beta
    get().toggleReferenceDoc(refId);
    expect(docs()[0].id).toBe(refId);
    expect(docs().map(d => d.name)).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('leaves the order unchanged when the reference is cleared', () => {
    const refId = ids()[1];
    get().toggleReferenceDoc(refId); // beta → top
    get().toggleReferenceDoc(refId); // clear
    expect(docs().map(d => d.name)).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('moves the reference straight to another sequence', () => {
    const firstRefId = ids()[1];  // beta (originally index 1)
    const secondRefId = ids()[2]; // gamma (originally index 2)
    get().toggleReferenceDoc(firstRefId);
    // after first toggle: [beta, alpha, gamma] — gamma is now at index 2
    get().toggleReferenceDoc(secondRefId);
    expect(ws().viewSettings.referenceDocId).toBe(secondRefId);
    expect(docs()[0].id).toBe(secondRefId);
  });

  it('clears the row selection, which would otherwise cover the reference tint', () => {
    const refId = ids()[1];
    get().toggleDocSelection(refId);
    get().toggleReferenceDoc(refId);
    expect(ws().selectedDocIds.size).toBe(0);
  });

  it('turns reference highlighting off when the reference is removed', () => {
    const refId = ids()[1];
    get().toggleReferenceDoc(refId);
    get().setHighlightMode('reference');
    get().toggleReferenceDoc(refId);
    expect(ws().viewSettings.highlightMode).toBe('none');
  });

  it('leaves consensus highlighting alone', () => {
    const refId = ids()[1];
    get().setHighlightMode('consensus');
    get().toggleReferenceDoc(refId);
    get().toggleReferenceDoc(refId);
    expect(ws().viewSettings.highlightMode).toBe('consensus');
  });

  it('drops a reference that gets deleted', () => {
    const refId = ids()[1];
    get().toggleReferenceDoc(refId);
    get().toggleDocSelection(refId);
    get().deleteSelectedDocs();
    expect(ws().viewSettings.referenceDocId).toBe(null);
  });

  it('keeps a reference that survives the deletion', () => {
    const reference = ids()[0];
    get().toggleReferenceDoc(reference);
    const nonRefId = ids()[1]; // what was originally gamma, but capture after reorder
    get().toggleDocSelection(nonRefId);
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
    get().toggleEditingEnabled()
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

  it('records the deletion in workspaceHistory', () => {
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs();
    expect(ws().workspaceHistory.length).toBe(1);
    expect(ws().workspaceHistory[0].type).toBe('deleteDocuments');
  });
});

describe('workspace undo/redo (deleteSelectedDocs)', () => {
  it('undo restores the deleted document in its original position', () => {
    const originalNames = docs().map(d => d.name);
    get().toggleDocSelection(ids()[1]); // delete 'beta' (index 1)
    get().deleteSelectedDocs();
    expect(docs().map(d => d.name)).toEqual(['alpha', 'gamma']);

    get().undo();
    expect(docs().map(d => d.name)).toEqual(originalNames);
  });

  it('undo restores multiple deleted docs in their original positions', () => {
    get().toggleDocSelection(ids()[0]); // alpha at 0
    get().toggleDocSelection(ids()[2]); // gamma at 2
    get().deleteSelectedDocs();
    expect(docs().map(d => d.name)).toEqual(['beta']);

    get().undo();
    expect(docs().map(d => d.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('undo restores the active document focus', () => {
    get().toggleDocSelection(ids()[0]); // deleting the active doc
    get().deleteSelectedDocs();

    get().undo();
    expect(ws().activeDocId).toBe(ids()[0]);
  });

  it('undo is a no-op when workspaceHistory is empty', () => {
    const before = docs();
    get().undo(); // nothing to undo
    expect(docs()).toBe(before);
  });

  it('redo re-deletes after an undo', () => {
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs();
    get().undo();
    expect(docs().map(d => d.name)).toEqual(['alpha', 'beta', 'gamma']);

    get().redo();
    expect(docs().map(d => d.name)).toEqual(['alpha', 'gamma']);
  });

  it('redo is a no-op when workspaceFuture is empty', () => {
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs();
    const before = docs();
    get().redo(); // no undo has been done
    expect(docs()).toBe(before);
  });

  it('a new deletion clears the workspace redo future', () => {
    get().toggleDocSelection(ids()[2]);
    get().deleteSelectedDocs();
    get().undo();
    expect(ws().workspaceFuture.length).toBe(1);

    // A new deletion should clear the future
    get().toggleDocSelection(ids()[0]);
    get().deleteSelectedDocs();
    expect(ws().workspaceFuture.length).toBe(0);
  });

  it('undo restores the reference doc that was deleted', () => {
    const refId = ids()[1]; // capture before toggle reorders
    get().toggleReferenceDoc(refId);
    get().toggleDocSelection(refId);
    get().deleteSelectedDocs();
    expect(ws().viewSettings.referenceDocId).toBe(null);

    get().undo();
    expect(ws().viewSettings.referenceDocId).toBe(refId);
  });

  it('undo preserves the per-document edit history of restored docs', () => {
    get().toggleEditingEnabled();
    get().substitute(0, 'T'); // edit alpha
    get().toggleDocSelection(ids()[1]); // delete beta
    get().deleteSelectedDocs();
    get().undo(); // restore beta

    // alpha still has its edit history
    const alpha = docs().find(d => d.name === 'alpha');
    expect(alpha.history.length).toBe(1);
  });

  it('loadWorkspace clears both workspace history stacks', () => {
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs();
    expect(ws().workspaceHistory.length).toBe(1);

    get().loadWorkspace([{ name: 'new', sequence: 'ACGT' }]);
    expect(ws().workspaceHistory.length).toBe(0);
    expect(ws().workspaceFuture.length).toBe(0);
  });

  it('multiple sequential deletions can all be undone in order', () => {
    get().toggleDocSelection(ids()[2]);
    get().deleteSelectedDocs(); // remove gamma → [alpha, beta]
    get().toggleDocSelection(ids()[1]);
    get().deleteSelectedDocs(); // remove beta  → [alpha]

    get().undo(); // restore beta  → [alpha, beta]
    expect(docs().map(d => d.name)).toEqual(['alpha', 'beta']);

    get().undo(); // restore gamma → [alpha, beta, gamma]
    expect(docs().map(d => d.name)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('column cursor', () => {
  it('is preserved when editing is locked again', () => {
    get().toggleEditingEnabled();
    get().setColumnCursor(4);
    expect(ws().columnCursor).toBe(4);
    get().toggleEditingEnabled();
    expect(ws().columnCursor).toBe(4);
  });

  it('can be placed even when editing is locked', () => {
    expect(ws().editingEnabled).toBe(false);
    get().setColumnCursor(2);
    expect(ws().columnCursor).toBe(2);
    get().setColumnSelection({ start: 1, end: 4 });
    expect(ws().columnSelection).toEqual({ start: 1, end: 4 });
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

  it('deletes a column range across all documents', () => {
    get().deleteColumnRange(1, 4);
    expect(docs().map(d => d.raw)).toEqual(['AACGT', 'AACGT', 'ATCGT']);
  });

  it('substitutes a column range with gaps across all documents', () => {
    get().substituteColumnRange(1, 4, '-');
    expect(docs().map(d => d.raw)).toEqual(['A---ACGT', 'A---ACGT', 'A---TCGT']);
  });

  it('mutually excludes columnCursor and columnSelection', () => {
    get().setColumnCursor(3);
    expect(ws().columnCursor).toBe(3);
    expect(ws().columnSelection).toBe(null);

    get().setColumnSelection({ start: 2, end: 5 });
    expect(ws().columnSelection).toEqual({ start: 2, end: 5 });
    expect(ws().columnCursor).toBe(null);

    get().setColumnCursor(4);
    expect(ws().columnCursor).toBe(4);
    expect(ws().columnSelection).toBe(null);
  });

  it('undoes multiline column edits across all affected documents', () => {
    get().substituteColumn(0, 'T');
    expect(docs().map(d => d.raw)).toEqual(['TCGTACGT', 'TCGTACGT', 'TCGTTCGT']);

    // Undoing must undo ALL documents, not just the active one
    get().undo();
    expect(docs().map(d => d.raw)).toEqual(['ACGTACGT', 'ACGTACGT', 'ACGTTCGT']);

    // Redoing re-applies the edit to all documents
    get().redo();
    expect(docs().map(d => d.raw)).toEqual(['TCGTACGT', 'TCGTACGT', 'TCGTTCGT']);
  });

  it('undoes multiline column deletion across all documents', () => {
    get().deleteColumn(0);
    expect(docs().map(d => d.raw)).toEqual(['CGTACGT', 'CGTACGT', 'CGTTCGT']);

    get().undo();
    expect(docs().map(d => d.raw)).toEqual(['ACGTACGT', 'ACGTACGT', 'ACGTTCGT']);

    get().redo();
    expect(docs().map(d => d.raw)).toEqual(['CGTACGT', 'CGTACGT', 'CGTTCGT']);
  });

  it('undoes multiline column range replacement across all documents', () => {
    get().replaceColumnRange(0, 3, 'G');
    expect(docs().map(d => d.raw)).toEqual(['GTACGT', 'GTACGT', 'GTTCGT']);

    get().undo();
    expect(docs().map(d => d.raw)).toEqual(['ACGTACGT', 'ACGTACGT', 'ACGTTCGT']);

    get().redo();
    expect(docs().map(d => d.raw)).toEqual(['GTACGT', 'GTACGT', 'GTTCGT']);
  });

  it('interleaves single-document and multiline edits in undo/redo history', () => {
    // 1. Single-doc edit on doc 0
    get().substitute(0, 'T');
    expect(docs().map(d => d.raw)).toEqual(['TCGTACGT', 'ACGTACGT', 'ACGTTCGT']);

    // 2. Multiline edit on column 7
    get().substituteColumn(7, '-');
    expect(docs().map(d => d.raw)).toEqual(['TCGTACG-', 'ACGTACG-', 'ACGTTCG-']);

    // 3. Undo multiline edit first
    get().undo();
    expect(docs().map(d => d.raw)).toEqual(['TCGTACGT', 'ACGTACGT', 'ACGTTCGT']);

    // 4. Undo single-doc edit second
    get().undo();
    expect(docs().map(d => d.raw)).toEqual(['ACGTACGT', 'ACGTACGT', 'ACGTTCGT']);

    // 5. Redo single-doc edit
    get().redo();
    expect(docs().map(d => d.raw)).toEqual(['TCGTACGT', 'ACGTACGT', 'ACGTTCGT']);

    // 6. Redo multiline edit
    get().redo();
    expect(docs().map(d => d.raw)).toEqual(['TCGTACG-', 'ACGTACG-', 'ACGTTCG-']);
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

describe('track order', () => {
  it('moves a document to a new position and undoes as one step', () => {
    const [a, b, c] = ids();
    get().reorderDoc(c, 0);
    expect(ids()).toEqual([c, a, b]);

    get().undo();
    expect(ids()).toEqual([a, b, c]);

    get().redo();
    expect(ids()).toEqual([c, a, b]);
  });

  it('keeps the reference at the top: it cannot be dragged, nor dropped over', () => {
    const [a, b, c] = ids();
    get().toggleReferenceDoc(b); // moves beta to the top
    expect(ids()).toEqual([b, a, c]);

    get().reorderDoc(b, 2);
    expect(ids()).toEqual([b, a, c]);

    get().reorderDoc(c, 0);
    expect(ids()).toEqual([b, c, a]);
  });

  it('records nothing when the order would not change', () => {
    const before = ws().workspaceHistory.length;
    get().reorderDoc(ids()[0], 0);
    expect(ws().workspaceHistory).toHaveLength(before);
  });

  it('sorts by name in both directions', () => {
    get().sortDocs('name-desc');
    expect(docs().map(d => d.name)).toEqual(['gamma', 'beta', 'alpha']);

    get().sortDocs('name-asc');
    expect(docs().map(d => d.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('sorts by length', () => {
    get().loadWorkspace([
      { name: 'short', sequence: 'AC' },
      { name: 'long', sequence: 'ACGTACGT' },
      { name: 'middle', sequence: 'ACGT' },
    ]);
    get().sortDocs('length-desc');
    expect(docs().map(d => d.name)).toEqual(['long', 'middle', 'short']);

    get().sortDocs('length-asc');
    expect(docs().map(d => d.name)).toEqual(['short', 'middle', 'long']);
  });

  it('sorts the rest around a pinned reference', () => {
    const gamma = docs()[2].id;
    get().toggleReferenceDoc(gamma);
    get().sortDocs('name-asc');
    expect(docs().map(d => d.name)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('orders by similarity to the reference, closest first', () => {
    // alpha and beta are identical; gamma differs at one position.
    get().toggleReferenceDoc(ids()[1]); // beta to the top
    get().sortDocs('similarity');
    expect(docs().map(d => d.name)).toEqual(['beta', 'alpha', 'gamma']);
  });
});

describe('track visibility and pinning', () => {
  it('hides a track without deleting it, and shows it again', () => {
    const [a] = ids();
    get().toggleDocHidden(a);
    expect(ws().hiddenDocIds.has(a)).toBe(true);
    expect(docs()).toHaveLength(3);

    get().showAllDocs();
    expect(ws().hiddenDocIds.size).toBe(0);
  });

  it('moves the keyboard focus off a row it just hid', () => {
    const [a, b] = ids();
    expect(ws().activeDocId).toBe(a);
    get().toggleDocHidden(a);
    expect(ws().activeDocId).toBe(b);
  });

  it('pins and unpins a track', () => {
    const [a] = ids();
    get().togglePinnedDoc(a);
    expect(ws().pinnedDocIds.has(a)).toBe(true);
    get().togglePinnedDoc(a);
    expect(ws().pinnedDocIds.has(a)).toBe(false);
  });
});

describe('groups', () => {
  it('groups the selected sequences and collapses them', () => {
    const [a, b] = ids();
    get().toggleDocSelection(a);
    get().toggleDocSelection(b);
    get().createGroup('Isolates');

    expect(ws().groups).toHaveLength(1);
    expect(ws().groups[0]).toMatchObject({ name: 'Isolates', docIds: [a, b], collapsed: false });
    expect(ws().selectedDocIds.size).toBe(0);

    get().toggleGroupCollapsed(ws().groups[0].id);
    expect(ws().groups[0].collapsed).toBe(true);
  });

  it('will not make an empty group', () => {
    get().createGroup('Nothing');
    expect(ws().groups).toHaveLength(0);
    expect(get().toast.type).toBe('warning');
  });

  it('moves a sequence out of its old group when it joins another', () => {
    const [a, b, c] = ids();
    get().toggleDocSelection(a);
    get().createGroup('One');
    get().toggleDocSelection(b);
    get().toggleDocSelection(c);
    get().createGroup('Two');

    get().toggleDocSelection(b);
    get().addSelectionToGroup(ws().groups[0].id);
    expect(ws().groups[0].docIds).toEqual([a, b]);
    expect(ws().groups[1].docIds).toEqual([c]);
  });

  it('drops a group whose last member leaves', () => {
    const [a, b] = ids();
    get().toggleDocSelection(a);
    get().createGroup('One');
    get().toggleDocSelection(b);
    get().createGroup('Two');
    get().toggleDocSelection(a);
    get().addSelectionToGroup(ws().groups[1].id);
    expect(ws().groups.map(g => g.name)).toEqual(['Two']);
  });

  it('ungroups without touching the sequences', () => {
    get().toggleDocSelection(ids()[0]);
    get().createGroup('One');
    get().ungroup(ws().groups[0].id);
    expect(ws().groups).toHaveLength(0);
    expect(docs()).toHaveLength(3);
  });
});

describe('alignment cleanup', () => {
  beforeEach(() => {
    get().loadWorkspace([
      { name: 'a', sequence: '--ACG-T--' },
      { name: 'b', sequence: '-AACG-T--' },
      { name: 'c', sequence: '--ACG-T--' },
    ]);
  });

  it('strips the columns that are a gap in every row, as one undo step', () => {
    get().stripGapColumns();
    expect(docs().map(d => d.raw)).toEqual(['-ACGT', 'AACGT', '-ACGT']);

    get().undo();
    expect(docs().map(d => d.raw)).toEqual(['--ACG-T--', '-AACG-T--', '--ACG-T--']);
  });

  it('trims ragged ends to a coverage threshold', () => {
    get().trimEnds(1);
    expect(docs().map(d => d.raw)).toEqual(['ACG-T', 'ACG-T', 'ACG-T']);
  });

  it('pads sequences to a common length', () => {
    get().loadWorkspace([
      { name: 'a', sequence: 'ACGT' },
      { name: 'b', sequence: 'AC' },
    ]);
    get().padSequences();
    expect(docs().map(d => d.raw)).toEqual(['ACGT', 'AC--']);
  });

  it('says so rather than recording an edit when there is nothing to do', () => {
    get().loadWorkspace([{ name: 'a', sequence: 'ACGT' }, { name: 'b', sequence: 'ACGT' }]);
    get().stripGapColumns();
    expect(ws().workspaceHistory).toHaveLength(0);
    expect(get().toast.message).toMatch(/No all-gap columns/);
  });
});

describe('transforms', () => {
  it('transforms the active sequence only', () => {
    get().applyTransform('reverseComplement', 'active');
    expect(docs()[0].raw).toBe('ACGTACGT');
    expect(docs()[1].raw).toBe('ACGTACGT');
  });

  it('transcribes to RNA and back', () => {
    get().applyTransform('transcribe', 'active');
    expect(docs()[0].raw).toBe('ACGUACGU');
    get().applyTransform('reverseTranscribe', 'active');
    expect(docs()[0].raw).toBe('ACGTACGT');
  });

  it('transforms every selected sequence as one undo step', () => {
    const [a, b] = ids();
    get().toggleDocSelection(a);
    get().toggleDocSelection(b);
    get().applyTransform('complement', 'selected');
    expect(docs()[0].raw).toBe('TGCATGCA');
    expect(docs()[1].raw).toBe('TGCATGCA');
    expect(docs()[2].raw).toBe('ACGTTCGT');

    get().undo();
    expect(docs()[0].raw).toBe('ACGTACGT');
    expect(docs()[1].raw).toBe('ACGTACGT');
  });

  it('transforms just the selected span', () => {
    get().setSelection(0, 4);
    get().applyTransform('complement', 'span');
    expect(docs()[0].raw).toBe('TGCAACGT');
  });

  it('asks for a selection rather than guessing at one', () => {
    get().applyTransform('reverse', 'selected');
    expect(get().toast.type).toBe('warning');
    expect(docs()[0].raw).toBe('ACGTACGT');
  });
});

describe('find and replace', () => {
  beforeEach(() => {
    get().patchFind({
      query: '', replacement: '',
      options: { mode: 'iupac', mismatches: 0, reverseComplement: false, allSequences: true },
    });
  });

  it('finds matches across every sequence', () => {
    get().patchFind({ query: 'ACGT' });
    const matches = get().runSearch();
    expect(matches).toHaveLength(5); // alpha x2, beta x2, gamma x1
    expect(get().find.activeIndex).toBe(0);
  });

  it('searches only the active sequence when told to', () => {
    get().patchFind({ query: 'ACGT', options: { allSequences: false } });
    expect(get().runSearch()).toHaveLength(2);
  });

  it('steps through the matches and wraps round', () => {
    get().patchFind({ query: 'ACGT' });
    get().runSearch();
    get().stepMatch(1);
    expect(get().find.activeIndex).toBe(1);
    get().stepMatch(-1);
    expect(get().find.activeIndex).toBe(0);
    get().stepMatch(-1);
    expect(get().find.activeIndex).toBe(4);
  });

  it('replaces every match as a single undo step', () => {
    get().patchFind({ query: 'ACGT', replacement: 'TTTT' });
    get().runSearch();
    get().replaceAllMatches();
    expect(docs().map(d => d.raw)).toEqual(['TTTTTTTT', 'TTTTTTTT', 'TTTTTCGT']);

    get().undo();
    expect(docs().map(d => d.raw)).toEqual(['ACGTACGT', 'ACGTACGT', 'ACGTTCGT']);
  });

  it('replaces one match without touching the others', () => {
    get().patchFind({ query: 'ACGT', replacement: 'TTTT' });
    get().runSearch();
    get().replaceActiveMatch();
    expect(docs()[0].raw).toBe('TTTTACGT');
    expect(docs()[1].raw).toBe('ACGTACGT');
  });

  it('closes the bar and drops the highlights with it', () => {
    get().patchFind({ query: 'ACGT' });
    get().runSearch();
    get().openFind();
    get().closeFind();
    expect(get().find.open).toBe(false);
    expect(get().find.matches).toEqual([]);
  });
});

describe('selectOnlyDoc', () => {
  it('makes one row the whole selection', () => {
    const [a, b, c] = ids();
    get().toggleDocSelection(a);
    get().toggleDocSelection(b);
    expect(ws().selectedDocIds.size).toBe(2);

    get().selectOnlyDoc(c);
    expect([...ws().selectedDocIds]).toEqual([c]);
  });

  it('anchors a following Shift+click range', () => {
    const [a, b, c] = ids();
    get().selectOnlyDoc(a);
    get().selectDocRange(c);
    expect([...ws().selectedDocIds].sort()).toEqual([a, b, c].sort());
  });

  it('does not churn the store when that row is already the selection', () => {
    const [a] = ids();
    get().selectOnlyDoc(a);
    const before = ws();
    get().selectOnlyDoc(a);
    expect(ws()).toBe(before);
  });
});
