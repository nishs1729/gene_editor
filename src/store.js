// Zustand store wrapping a workspace of SequenceDocuments.
// Selector-based subscriptions keep canvas redraws decoupled from React reconciliation.

import { create } from 'zustand';
import {
  createDocument,
  substitute as modelSubstitute,
  insertAt as modelInsertAt,
  deleteRange as modelDeleteRange,
  replaceRange as modelReplaceRange,
  moveRange as modelMoveRange,
  reverseComplementDoc as modelReverseComplement,
  undo as modelUndo,
  redo as modelRedo,
  getStats,
} from './sequenceModel.js';
import { DEFAULT_THEME } from './theme.js';

const STORAGE_KEY = 'geneEditor.workspace';
const THEME_KEY = 'geneEditor.theme';

const EMPTY_STATS = { length: 0, ungappedLength: 0, gaps: 0, gcPercent: 0, counts: {} };

function loadPersistedTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// Only names and sequences are persisted — undo history would balloon the payload
// and is not meaningful across sessions.
function loadPersistedDocuments() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed?.documents)) return [];
    return parsed.documents
      .filter(d => typeof d?.raw === 'string')
      .map(d => createDocument(d.name ?? '', d.raw));
  } catch {
    return [];
  }
}

const initialDocuments = loadPersistedDocuments();

let toastTimer = null;

const useStore = create((set, get) => {
  /** Apply `fn` to the active document and write the result back. */
  function updateActive(fn) {
    const { workspace } = get();
    const index = workspace.documents.findIndex(d => d.id === workspace.activeDocId);
    if (index === -1) return;

    const doc = workspace.documents[index];
    const newDoc = fn(doc);
    if (newDoc === doc) return;

    const documents = [...workspace.documents];
    documents[index] = newDoc;
    set({
      workspace: { ...workspace, documents },
      stats: getStats(newDoc.raw),
    });
  }

  /** Apply `fn` to every document — the basis of the column-wide edits. */
  function applyToAllDocs(fn) {
    const { workspace } = get();
    const documents = workspace.documents.map(fn);
    const active = documents.find(d => d.id === workspace.activeDocId);
    set({
      workspace: { ...workspace, documents },
      stats: active ? getStats(active.raw) : get().stats,
    });
  }

  function patchViewSettings(patch) {
    const { workspace } = get();
    set({
      workspace: { ...workspace, viewSettings: { ...workspace.viewSettings, ...patch } },
    });
  }

  return {
    workspace: {
      documents: initialDocuments,
      activeDocId: initialDocuments[0]?.id ?? null,
      viewSettings: {
        lineWidth: 0, // 0 = auto-calculate from canvas width
        showComplement: false,
        showConsensus: true, // only rendered when stacked (>1 document) regardless
        consensusThreshold: 0.5, // min share of non-gap calls needed to call a base rather than N
        highlightMode: 'none', // 'none' | 'consensus' | 'reference' — grey out agreeing bases
        referenceDocId: null, // which document 'reference' highlighting compares against
        fullscreen: false,
      },
      editingEnabled: false,
      dragInsertIndex: null, // transient drag-to-move preview position
      selectedDocIds: new Set(), // row (whole-sequence) multi-select, for deletion
      lastSelectionClickId: null, // anchor for shift-click range-select on rows
      columnCursor: null, // alignment-column index; typing edits every row at this column
    },

    theme: loadPersistedTheme(),

    stats: initialDocuments[0] ? getStats(initialDocuments[0].raw) : EMPTY_STATS,

    toast: null, // { message, type: 'info' | 'warning' | 'error' } | null

    // --- Document lifecycle ---

    loadWorkspace: (records) => {
      const documents = records.map(r => createDocument(r.name, r.sequence));
      const { workspace } = get();
      set({
        workspace: {
          ...workspace,
          documents,
          activeDocId: documents[0]?.id ?? null,
          editingEnabled: false, // newly opened documents start locked, as in Geneious
          dragInsertIndex: null,
          selectedDocIds: new Set(),
          columnCursor: null,
          // The old reference belongs to documents that are gone.
          viewSettings: { ...workspace.viewSettings, referenceDocId: documents[0]?.id ?? null },
        },
        stats: documents[0] ? getStats(documents[0].raw) : EMPTY_STATS,
      });
    },

    setActiveDoc: (id) => {
      const { workspace } = get();
      if (workspace.activeDocId === id) return;
      const doc = workspace.documents.find(d => d.id === id);
      if (!doc) return;
      set({
        workspace: { ...workspace, activeDocId: id },
        stats: getStats(doc.raw),
      });
    },

    save: () => {
      const { workspace } = get();
      const payload = {
        documents: workspace.documents.map(d => ({ name: d.name, raw: d.raw })),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        get().showToast('Could not save — sequences exceed available storage', 'error');
        return;
      }
      set({
        workspace: {
          ...workspace,
          documents: workspace.documents.map(d => (d.dirty ? { ...d, dirty: false } : d)),
        },
      });
      get().showToast('Saved', 'info');
    },

    // --- Editing (all target the active document) ---

    substitute: (pos, char) => updateActive(doc => modelSubstitute(doc, pos, char)),
    insertAt: (pos, str) => updateActive(doc => modelInsertAt(doc, pos, str)),
    deleteRange: (start, end) => updateActive(doc => modelDeleteRange(doc, start, end)),
    replaceRange: (start, end, text) => updateActive(doc => modelReplaceRange(doc, start, end, text)),
    moveRange: (start, end, dest) => updateActive(doc => modelMoveRange(doc, start, end, dest)),
    reverseComplementActive: () => updateActive(modelReverseComplement),
    undo: () => updateActive(modelUndo),
    redo: () => updateActive(modelRedo),

    // --- Selection / cursor (active document) ---

    setSelection: (start, end) => updateActive(doc => ({
      ...doc,
      selection: start === end
        ? null
        : { start: Math.min(start, end), end: Math.max(start, end) },
      cursorPos: end,
    })),

    setCursorPos: (pos) => updateActive(doc => ({ ...doc, cursorPos: pos, selection: null })),

    clearSelection: () => updateActive(doc => (doc.selection ? { ...doc, selection: null } : doc)),

    setDragInsertIndex: (index) => {
      const { workspace } = get();
      if (workspace.dragInsertIndex === index) return;
      set({ workspace: { ...workspace, dragInsertIndex: index } });
    },

    // --- View settings (shared across all rows) ---

    toggleComplement: () => patchViewSettings({
      showComplement: !get().workspace.viewSettings.showComplement,
    }),

    setLineWidth: (n) => patchViewSettings({ lineWidth: n }),

    toggleFullscreen: () => patchViewSettings({
      fullscreen: !get().workspace.viewSettings.fullscreen,
    }),

    toggleEditingEnabled: () => {
      const { workspace } = get();
      const editingEnabled = !workspace.editingEnabled;
      set({
        workspace: {
          ...workspace,
          editingEnabled,
          // A column cursor only makes sense while editing is allowed.
          columnCursor: editingEnabled ? workspace.columnCursor : null,
        },
      });
    },

    toggleConsensus: () => patchViewSettings({
      showConsensus: !get().workspace.viewSettings.showConsensus,
    }),

    /** @param {number} fraction - 0-1; agreement required before a base is called. */
    setConsensusThreshold: (fraction) => patchViewSettings({
      consensusThreshold: Math.min(1, Math.max(0, fraction)),
    }),

    /** @param {'none'|'consensus'|'reference'} mode */
    setHighlightMode: (mode) => {
      const { workspace } = get();
      patchViewSettings({
        highlightMode: mode,
        // Switching to reference mode with no reference chosen yet picks the first
        // sequence, so the mode always has something to compare against.
        referenceDocId: mode === 'reference'
          ? (workspace.viewSettings.referenceDocId ?? workspace.documents[0]?.id ?? null)
          : workspace.viewSettings.referenceDocId,
      });
    },

    setReferenceDocId: (id) => patchViewSettings({ referenceDocId: id }),

    // --- Row (whole-sequence) multi-select, for deletion ---

    toggleDocSelection: (id) => {
      const { workspace } = get();
      const selectedDocIds = new Set(workspace.selectedDocIds);
      if (selectedDocIds.has(id)) selectedDocIds.delete(id);
      else selectedDocIds.add(id);
      set({ workspace: { ...workspace, selectedDocIds, lastSelectionClickId: id } });
    },

    selectDocRange: (id) => {
      const { workspace } = get();
      const { documents, lastSelectionClickId, selectedDocIds } = workspace;
      const anchor = documents.findIndex(d => d.id === lastSelectionClickId);
      const target = documents.findIndex(d => d.id === id);
      if (anchor === -1 || target === -1) {
        get().toggleDocSelection(id);
        return;
      }
      const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
      const next = new Set(selectedDocIds);
      for (let i = from; i <= to; i++) next.add(documents[i].id);
      set({ workspace: { ...workspace, selectedDocIds: next, lastSelectionClickId: id } });
    },

    clearDocSelection: () => {
      const { workspace } = get();
      if (workspace.selectedDocIds.size === 0) return;
      set({ workspace: { ...workspace, selectedDocIds: new Set() } });
    },

    deleteSelectedDocs: () => {
      const { workspace } = get();
      const { selectedDocIds } = workspace;
      if (selectedDocIds.size === 0) return;

      const documents = workspace.documents.filter(d => !selectedDocIds.has(d.id));
      const activeDocId = selectedDocIds.has(workspace.activeDocId)
        ? (documents[0]?.id ?? null)
        : workspace.activeDocId;

      set({
        workspace: {
          ...workspace,
          documents,
          activeDocId,
          selectedDocIds: new Set(),
          columnCursor: null,
        },
        stats: documents.find(d => d.id === activeDocId)
          ? getStats(documents.find(d => d.id === activeDocId).raw)
          : EMPTY_STATS,
      });
      get().showToast(
        `Deleted ${selectedDocIds.size} sequence${selectedDocIds.size > 1 ? 's' : ''}`,
        'info'
      );
    },

    // --- Column cursor (alignment-locus editing across every row) ---

    setColumnCursor: (col) => {
      const { workspace } = get();
      set({ workspace: { ...workspace, columnCursor: col } });
    },

    /** Substitute `char` at `col` in every document whose length covers it. */
    substituteColumn: (col, char) => applyToAllDocs(doc =>
      col < doc.raw.length ? modelSubstitute(doc, col, char) : doc
    ),

    /** Insert `char` as a new column at `col` in every document. */
    insertColumn: (col, char) => applyToAllDocs(doc =>
      col <= doc.raw.length ? modelInsertAt(doc, col, char) : doc
    ),

    /** Remove column `col` from every document whose length covers it. */
    deleteColumn: (col) => applyToAllDocs(doc =>
      col < doc.raw.length ? modelDeleteRange(doc, col, col + 1) : doc
    ),

    // --- Theme ---

    setTheme: (theme) => {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        // Persisting the preference is best-effort; the session still applies it.
      }
      set({ theme });
    },

    toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

    // --- Toast ---

    showToast: (message, type = 'info') => {
      // Without clearing the previous timer, an earlier toast's expiry would cut
      // a newer message short.
      clearTimeout(toastTimer);
      set({ toast: { message, type } });
      toastTimer = setTimeout(() => set({ toast: null }), 3000);
    },
  };
});

/** Returns the active SequenceDocument, or null. */
export function getActiveDoc(state) {
  const { documents, activeDocId } = state.workspace;
  return documents.find(d => d.id === activeDocId) ?? null;
}

export default useStore;
