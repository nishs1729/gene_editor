// Zustand store wrapping the SequenceDocument.
// Selector-based subscriptions keep canvas redraws decoupled from React reconciliation.

import { create } from 'zustand';
import {
  createDocument,
  substitute as modelSubstitute,
  insertAt as modelInsertAt,
  deleteRange as modelDeleteRange,
  undo as modelUndo,
  redo as modelRedo,
  getStats,
} from './sequenceModel.js';

const useStore = create((set, get) => ({
  // --- Document state ---
  doc: createDocument(),

  // --- Derived state ---
  stats: { length: 0, gcPercent: 0, counts: {} },

  // --- Toast / notification ---
  toast: null, // { message: string, type: 'info' | 'warning' | 'error' } | null

  // --- Actions ---

  loadDocument: (name, raw) => {
    const doc = createDocument(name, raw);
    set({ doc, stats: getStats(doc.raw) });
  },

  substitute: (pos, char) => {
    const { doc } = get();
    const newDoc = modelSubstitute(doc, pos, char);
    if (newDoc !== doc) {
      set({ doc: newDoc, stats: getStats(newDoc.raw) });
    }
  },

  insertAt: (pos, str) => {
    const { doc } = get();
    const newDoc = modelInsertAt(doc, pos, str);
    if (newDoc !== doc) {
      set({ doc: newDoc, stats: getStats(newDoc.raw) });
    }
  },

  deleteRange: (start, end) => {
    const { doc } = get();
    const newDoc = modelDeleteRange(doc, start, end);
    if (newDoc !== doc) {
      set({ doc: newDoc, stats: getStats(newDoc.raw) });
    }
  },

  undo: () => {
    const { doc } = get();
    const newDoc = modelUndo(doc);
    if (newDoc !== doc) {
      set({ doc: newDoc, stats: getStats(newDoc.raw) });
    }
  },

  redo: () => {
    const { doc } = get();
    const newDoc = modelRedo(doc);
    if (newDoc !== doc) {
      set({ doc: newDoc, stats: getStats(newDoc.raw) });
    }
  },

  setSelection: (start, end) => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        selection: start === end ? null : { start: Math.min(start, end), end: Math.max(start, end) },
        cursorPos: end,
      },
    });
  },

  setCursorPos: (pos) => {
    const { doc } = get();
    set({
      doc: { ...doc, cursorPos: pos, selection: null },
    });
  },

  clearSelection: () => {
    const { doc } = get();
    set({
      doc: { ...doc, selection: null },
    });
  },

  toggleComplement: () => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        viewSettings: {
          ...doc.viewSettings,
          showComplement: !doc.viewSettings.showComplement,
        },
      },
    });
  },

  setLineWidth: (n) => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        viewSettings: { ...doc.viewSettings, lineWidth: n },
      },
    });
  },

  toggleFullscreen: () => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        viewSettings: {
          ...doc.viewSettings,
          fullscreen: !doc.viewSettings.fullscreen,
        },
      },
    });
  },

  showToast: (message, type = 'info') => {
    set({ toast: { message, type } });
    setTimeout(() => {
      set({ toast: null });
    }, 3000);
  },
}));

export default useStore;
