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
        fullscreen: false,
      },
      editingEnabled: false,
      dragInsertIndex: null, // transient drag-to-move preview position
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
      set({ workspace: { ...workspace, editingEnabled: !workspace.editingEnabled } });
    },

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
