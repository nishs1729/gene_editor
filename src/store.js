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
  setRaw as modelSetRaw,
  transformSpan,
  TRANSFORMS,
  undo as modelUndo,
  redo as modelRedo,
  getStats,
} from './sequenceModel.js';
import { stripAllGapColumns, trimRaggedEnds, padToLength } from './alignmentTools.js';
import { findMatches, applyReplacements } from './search.js';
import { percentIdentity } from './conservation.js';
import { createFeature, upsertFeature, removeFeature } from './annotations.js';
import { DEFAULT_THEME } from './theme.js';
import { DEFAULT_PALETTE, PALETTES } from './palettes.js';
import { GAP_CHAR } from './iupac.js';
import { PROJECT_FORMAT, serializeProject, deserializeProject } from './project.js';

const STORAGE_KEY = 'geneEditor.workspace';
const THEME_KEY = 'geneEditor.theme';

// Zoom range, in multiples of a base column's natural width. Zoom is horizontal
// only: at the low end columns become colour bars for reading an alignment's
// shape, at the high end they are wide enough to pick a single base out of.
// Zooming out stops when the whole alignment fills the window: past that there
// is nothing further to reveal, only empty canvas. That limit depends on the
// sequences and the window, so it lives in `workspace.minZoom` and is refreshed
// by the canvas. MIN_ZOOM is only the absolute floor under it.
export const MIN_ZOOM = 0.0002;
export const MAX_ZOOM = 4;

/** @param {number} zoom */
export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// How far the name column can be dragged: narrow enough to be nearly out of the
// way, wide enough for the long names sequencing pipelines produce.
export const MIN_GUTTER_WIDTH = 40;
export const MAX_GUTTER_WIDTH = 600;

/** @param {number} px */
export function clampGutterWidth(px) {
  return Math.round(Math.min(MAX_GUTTER_WIDTH, Math.max(MIN_GUTTER_WIDTH, px)));
}

const EMPTY_STATS = { length: 0, ungappedLength: 0, gaps: 0, gcPercent: 0, counts: {} };

function loadPersistedTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// The view settings a freshly-opened file starts with — kept as one object so a
// new file entry and the very first workspace can build from the same defaults.
const DEFAULT_VIEW_SETTINGS = {
  lineWidth: 0, // 0 = auto-calculate from canvas width
  showComplement: false,
  showConsensus: true, // only rendered when stacked (>1 document) regardless
  consensusThreshold: 0.5, // min share of non-gap calls needed to call a base rather than N
  highlightMode: 'none', // 'none' | 'consensus' | 'reference' — grey out agreeing bases
  referenceDocId: null, // which document 'reference' highlighting compares against
  fullscreen: false,
  zoom: 1, // ctrl+wheel scale on the width of a base column
  nameGutterWidth: null, // null = sized to the longest name; a number = dragged
  colorPalette: DEFAULT_PALETTE, // base colours; independent of the light/dark theme
  showColumnGuides: false, // faint banding every ten columns
  showMinimap: true, // overview strip under the ruler
  showConservation: false, // per-column conservation histogram
  showAnnotations: true, // feature lane under each sequence
  conservationMetric: 'identity', // 'identity' | 'entropy'
};

// Multiple files can be open at once, switched between from the files panel.
// Only the *active* file's state lives at the top level of `workspace` (as
// `documents`, `activeDocId`, `viewSettings`, undo stacks, and so on) so every
// other action can keep reading/writing those fields exactly as it always has.
// `workspace.files` holds the rest, each a full snapshot of those same fields
// for a file that isn't the one currently on screen; switching files moves the
// outgoing file's live state into its entry and the incoming entry's state up
// to the top level.
function makeFileEntry(documents, name, viewSettings) {
  return {
    id: `file-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    name,
    documents,
    activeDocId: documents[0]?.id ?? null,
    editingEnabled: false, // newly opened documents start locked, as in Geneious
    minZoom: MIN_ZOOM,
    hiddenDocIds: new Set(),
    pinnedDocIds: new Set(),
    groups: [],
    selectedDocIds: new Set(),
    lastSelectionClickId: null,
    columnCursor: null,
    columnSelection: null,
    renamingDocId: null,
    workspaceHistory: [],
    workspaceFuture: [],
    // A reference belongs to documents that came with the old file, and a
    // reference is an explicit choice, so a new file starts without one.
    viewSettings: { ...viewSettings, referenceDocId: null },
  };
}

/**
 * A file entry built from a file state read out of a project. Settings the app
 * has gained since the project was saved take their defaults.
 */
function fileEntryFromState(state) {
  return {
    ...makeFileEntry(state.documents, state.name, DEFAULT_VIEW_SETTINGS),
    ...state,
    viewSettings: { ...DEFAULT_VIEW_SETTINGS, ...state.viewSettings, fullscreen: false },
    minZoom: MIN_ZOOM,
    renamingDocId: null,
  };
}

/** The fields of `entry` that get spread onto the top level of `workspace`. */
function fileFieldsOf(entry) {
  const { id, name, ...fields } = entry;
  return fields;
}

/** The top-level workspace fields while no file is open. */
function emptyFileFields(viewSettings) {
  return fileFieldsOf(makeFileEntry([], '', viewSettings));
}

/** Stats for a file's active sequence. */
function statsFor({ documents = [], activeDocId }) {
  const doc = documents.find(d => d.id === activeDocId);
  return doc ? getStats(doc.raw) : EMPTY_STATS;
}

/** Package the currently active file's live top-level state back into an entry. */
function snapshotActiveFile(workspace) {
  return {
    id: workspace.activeFileId,
    name: workspace.fileName,
    documents: workspace.documents,
    activeDocId: workspace.activeDocId,
    editingEnabled: workspace.editingEnabled,
    minZoom: workspace.minZoom,
    hiddenDocIds: workspace.hiddenDocIds,
    pinnedDocIds: workspace.pinnedDocIds,
    groups: workspace.groups,
    selectedDocIds: workspace.selectedDocIds,
    lastSelectionClickId: workspace.lastSelectionClickId,
    columnCursor: workspace.columnCursor,
    columnSelection: workspace.columnSelection,
    renamingDocId: workspace.renamingDocId,
    workspaceHistory: workspace.workspaceHistory,
    workspaceFuture: workspace.workspaceFuture,
    viewSettings: workspace.viewSettings,
  };
}

/**
 * Every open file, in panel order, with the active one's live state folded back
 * in — the whole session, as a project saves it.
 */
export function currentFiles(workspace) {
  return workspace.files.map(f => (f.id === workspace.activeFileId ? snapshotActiveFile(workspace) : f));
}

/** The session as a project, ready to write out. */
export function projectOf(workspace, options) {
  const index = workspace.files.findIndex(f => f.id === workspace.activeFileId);
  return serializeProject(currentFiles(workspace), index, options);
}

/**
 * What Save left in browser storage: a project, or — from before projects
 * existed — a bare list of names and sequences.
 * @returns {{files: object[], activeIndex: number}}
 */
function loadPersistedFiles() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { files: [], activeIndex: 0 };
    const parsed = JSON.parse(stored);
    if (parsed?.format === PROJECT_FORMAT) {
      const { files, activeIndex } = deserializeProject(parsed);
      return { files: files.map(fileEntryFromState), activeIndex };
    }
    const documents = Array.isArray(parsed?.documents)
      ? parsed.documents
          .filter(d => typeof d?.raw === 'string')
          .map(d => createDocument(d.name ?? '', d.raw))
      : [];
    return {
      files: documents.length > 0 ? [makeFileEntry(documents, '', DEFAULT_VIEW_SETTINGS)] : [],
      activeIndex: 0,
    };
  } catch {
    return { files: [], activeIndex: 0 };
  }
}

const persisted = loadPersistedFiles();
const initialFile = persisted.files[persisted.activeIndex] ?? null;

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

  /** Apply an edit `fn` to the active document and record it in undo history. */
  function editActive(fn) {
    const { workspace } = get();
    const index = workspace.documents.findIndex(d => d.id === workspace.activeDocId);
    if (index === -1) return;

    const doc = workspace.documents[index];
    const newDoc = fn(doc);
    if (newDoc === doc || newDoc.raw === doc.raw) return;

    const documents = [...workspace.documents];
    documents[index] = newDoc;
    const command = {
      type: 'docEdit',
      docId: workspace.activeDocId,
    };
    set({
      workspace: {
        ...workspace,
        documents,
        workspaceHistory: [...workspace.workspaceHistory, command],
        workspaceFuture: [],
      },
      stats: getStats(newDoc.raw),
    });
  }

  /** Apply `fn` to every document — the basis of the column-wide edits. */
  function applyToAllDocs(fn) {
    const { workspace } = get();
    const prevDocs = workspace.documents;
    const documents = prevDocs.map(fn);
    const changedDocIds = [];
    for (let i = 0; i < prevDocs.length; i++) {
      if (documents[i].raw !== prevDocs[i].raw) {
        changedDocIds.push(prevDocs[i].id);
      }
    }
    if (changedDocIds.length === 0) return;

    const command = {
      type: 'multilineEdit',
      docIds: changedDocIds,
      previousColumnCursor: workspace.columnCursor,
      previousColumnSelection: workspace.columnSelection,
    };

    const active = documents.find(d => d.id === workspace.activeDocId);
    set({
      workspace: {
        ...workspace,
        documents,
        workspaceHistory: [...workspace.workspaceHistory, command],
        workspaceFuture: [],
      },
      stats: active ? getStats(active.raw) : get().stats,
    });
  }

  /**
   * Rewrite whole rows through one undo entry. `fn(doc)` returns the row's new
   * text, or null to leave it alone. Bulk operations (cleanup, transforms,
   * replace-all) use this so one action is one undo, however many rows it touched.
   */
  function batchRawEdit(fn) {
    applyToAllDocs(doc => {
      const next = fn(doc);
      return next == null || next === doc.raw ? doc : modelSetRaw(doc, next);
    });
  }

  /**
   * The state change that puts `target` on screen, with `files` as the full
   * list of open files; a null target leaves the workspace empty.
   */
  function activate(workspace, files, target, extra = {}) {
    return {
      workspace: {
        ...workspace,
        ...(target ? fileFieldsOf(target) : emptyFileFields(workspace.viewSettings)),
        files,
        activeFileId: target?.id ?? null,
        fileName: target?.name ?? '',
        dragInsertIndex: null,
        rowDropIndex: null,
        ...extra,
      },
      stats: target ? statsFor(target) : EMPTY_STATS,
    };
  }

  function patchViewSettings(patch) {
    const { workspace } = get();
    set({
      workspace: { ...workspace, viewSettings: { ...workspace.viewSettings, ...patch } },
    });
  }

  return {
    workspace: {
      // Every loaded file, as a switchable entry — see `makeFileEntry` above.
      // The currently active one's state also lives at the top level of this
      // object (documents, activeDocId, viewSettings, ...); the rest sit here
      // until switched to.
      files: persisted.files,
      activeFileId: initialFile?.id ?? null,
      ...(initialFile ? fileFieldsOf(initialFile) : emptyFileFields(DEFAULT_VIEW_SETTINGS)),
      // The file these documents came from, for the stats panel and the files
      // panel. FASTA names the sequences, not the set, so the file name is the
      // only name the set has.
      fileName: initialFile?.name ?? '',
      dragInsertIndex: null, // transient drag-to-move preview position
      rowDropIndex: null, // transient row-reorder drop line, as a visual row index
      // Files opened or closed since the last Save. Edits are tracked on the
      // documents themselves, as their `dirty` flag.
      unsavedChanges: false,
    },

    theme: loadPersistedTheme(),

    // Projects waiting on the "add or replace?" question, oldest first.
    pendingProjects: [], // Array<{ project, fileName }>

    stats: statsFor(initialFile ?? {}),

    toast: null, // { message, type: 'info' | 'warning' | 'error' } | null

    // Which blocking modal is open, if any: 'help' | 'jump' | 'distance' | 'tree'.
    // The find bar is not one of these — it floats over the canvas and stays
    // usable while the rest of the editor is.
    dialog: null,

    // The annotation being added or edited: { docId, featureId?, start, end }.
    annotationDraft: null,

    // Find & replace. `matches` is kept in the store rather than recomputed per
    // frame because the canvas highlights it on every redraw.
    find: {
      open: false,
      query: '',
      replacement: '',
      options: {
        mode: 'iupac', // 'iupac' | 'literal' | 'regex'
        mismatches: 0,
        reverseComplement: false,
        allSequences: true,
      },
      matches: [], // Array<{ docId, start, end, strand: 1 | -1 }>
      activeIndex: -1,
    },

    // --- Document lifecycle ---

    // Opens `records` as a new file alongside whatever is already open, and
    // switches to it — it does not replace the current file, only adds one.
    loadWorkspace: (records, fileName = '') => {
      const { workspace } = get();
      const documents = records.map(r => createDocument(r.name, r.sequence));
      const newFile = makeFileEntry(documents, fileName, workspace.viewSettings);
      set(activate(workspace, [...currentFiles(workspace), newFile], newFile, { unsavedChanges: true }));
    },

    /** Switch to an already-loaded file, saving the outgoing one's live state first. */
    switchFile: (fileId) => {
      const { workspace } = get();
      if (workspace.activeFileId === fileId) return;
      const files = currentFiles(workspace);
      const target = files.find(f => f.id === fileId);
      if (!target) return;
      set(activate(workspace, files, target));
    },

    /** Close a loaded file. Closing the active one switches to another, if any remain. */
    closeFile: (fileId) => {
      const { workspace } = get();
      if (!workspace.files.some(f => f.id === fileId)) return;
      const survivors = currentFiles(workspace).filter(f => f.id !== fileId);

      if (workspace.activeFileId !== fileId) {
        set({ workspace: { ...workspace, files: survivors, unsavedChanges: true } });
        return;
      }
      set(activate(workspace, survivors, survivors[0] ?? null, { unsavedChanges: true }));
    },

    /**
     * Open a project read from a .gene file, either in place of everything
     * that is open or alongside it; the project's own active file comes to front.
     * @param {{files: object[], activeIndex: number}} project - from deserializeProject
     * @param {'replace'|'add'} mode
     */
    openProject: (project, mode = 'replace', fileName = '') => {
      const { workspace } = get();
      const entries = project.files.map(fileEntryFromState);
      const target = entries[project.activeIndex] ?? entries[0];
      const kept = mode === 'add' ? currentFiles(workspace) : [];
      set(activate(workspace, [...kept, ...entries], target, { unsavedChanges: true }));
      const count = `${entries.length} file${entries.length === 1 ? '' : 's'}`;
      get().showToast(fileName ? `Opened "${fileName}" — ${count}` : `Opened project — ${count}`, 'info');
    },

    /**
     * Open a project, asking first whether it joins or replaces the open files
     * — unless nothing is open, when there is nothing to ask about.
     */
    requestOpenProject: (project, fileName = '') => {
      const { workspace, pendingProjects } = get();
      if (workspace.files.length === 0 && pendingProjects.length === 0) {
        get().openProject(project, 'replace', fileName);
        return;
      }
      set({ pendingProjects: [...pendingProjects, { project, fileName }] });
    },

    /** Answer the open-project question: 'add', 'replace' or 'cancel'. */
    resolvePendingProject: (choice) => {
      const [first, ...rest] = get().pendingProjects;
      if (!first) return;
      set({ pendingProjects: rest });
      if (choice === 'add' || choice === 'replace') get().openProject(first.project, choice, first.fileName);
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

    /**
     * Keep the whole session — every open file, with its recent undo history —
     * in browser storage, as the same project a .gene file holds. If that is
     * too big for the browser's quota, the history is the part let go.
     */
    save: () => {
      const { workspace } = get();
      const write = options => localStorage.setItem(STORAGE_KEY, JSON.stringify(projectOf(workspace, options)));
      let withoutHistory = false;
      try {
        if (workspace.files.length === 0) localStorage.removeItem(STORAGE_KEY);
        else write();
      } catch {
        try {
          write({ includeHistory: false });
          withoutHistory = true;
        } catch {
          get().showToast('Could not save — the sequences exceed the browser\'s storage', 'error');
          return;
        }
      }

      const clean = docs => (docs.some(d => d.dirty) ? docs.map(d => (d.dirty ? { ...d, dirty: false } : d)) : docs);
      set({
        workspace: {
          ...workspace,
          documents: clean(workspace.documents),
          files: workspace.files.map(f => (f.id === workspace.activeFileId ? f : { ...f, documents: clean(f.documents) })),
          unsavedChanges: false,
        },
      });
      get().showToast(
        withoutHistory ? 'Saved — without undo history, which is too large for browser storage' : 'Saved',
        withoutHistory ? 'warning' : 'info'
      );
    },

    // --- Editing (all target the active document) ---

    substitute: (pos, char) => editActive(doc => modelSubstitute(doc, pos, char)),
    insertAt: (pos, str) => editActive(doc => modelInsertAt(doc, pos, str)),
    deleteRange: (start, end) => editActive(doc => modelDeleteRange(doc, start, end)),
    replaceRange: (start, end, text) => editActive(doc => modelReplaceRange(doc, start, end, text)),
    moveRange: (start, end, dest) => editActive(doc => modelMoveRange(doc, start, end, dest)),
    reverseComplementActive: () => editActive(modelReverseComplement),

    undo: () => {
      const { workspace } = get();
      const { workspaceHistory } = workspace;

      // Workspace-level undo (deletion, multiline edit, doc edit).
      if (workspaceHistory.length > 0) {
        const command = workspaceHistory[workspaceHistory.length - 1];
        if (command.type === 'deleteDocuments') {
          // Re-insert the deleted documents at their original positions.
          const documents = [...workspace.documents];
          for (let i = 0; i < command.deletedDocs.length; i++) {
            documents.splice(command.deletedIndices[i], 0, command.deletedDocs[i]);
          }
          const activeDocId = command.previousActiveDocId ?? documents[0]?.id ?? null;
          set({
            workspace: {
              ...workspace,
              documents,
              activeDocId,
              selectedDocIds: command.previousSelectedDocIds,
              // Restore the reference if it was one of the deleted documents.
              viewSettings: command.deletedDocs.some(
                d => d.id === workspace.viewSettings.referenceDocId
              )
                ? workspace.viewSettings
                : {
                    ...workspace.viewSettings,
                    referenceDocId: command.previousReferenceDocId,
                  },
              workspaceHistory: workspaceHistory.slice(0, -1),
              workspaceFuture: [...workspace.workspaceFuture, command],
            },
            stats: documents.find(d => d.id === activeDocId)
              ? getStats(documents.find(d => d.id === activeDocId).raw)
              : EMPTY_STATS,
          });
          return;
        }

        if (command.type === 'features') {
          // Features are swapped the same way an order is: the command carries
          // the list to restore and takes the current one for the other stack.
          const current = workspace.documents.find(d => d.id === command.docId)?.features ?? [];
          set({
            workspace: {
              ...workspace,
              documents: workspace.documents.map(d => (
                d.id === command.docId ? { ...d, features: command.previousFeatures } : d
              )),
              workspaceHistory: workspaceHistory.slice(0, -1),
              workspaceFuture: [
                ...workspace.workspaceFuture,
                { type: 'features', docId: command.docId, previousFeatures: current },
              ],
            },
          });
          return;
        }

        if (command.type === 'reorderDocuments') {
          // Swap the orders round: the command carries the order to restore, and
          // the one it replaces is what redo will need.
          const byId = new Map(workspace.documents.map(d => [d.id, d]));
          const documents = command.previousOrder.map(id => byId.get(id)).filter(Boolean);
          set({
            workspace: {
              ...workspace,
              documents,
              workspaceHistory: workspaceHistory.slice(0, -1),
              workspaceFuture: [
                ...workspace.workspaceFuture,
                { type: 'reorderDocuments', previousOrder: workspace.documents.map(d => d.id) },
              ],
            },
          });
          return;
        }

        if (command.type === 'multilineEdit') {
          const docIdSet = new Set(command.docIds);
          const documents = workspace.documents.map(d =>
            docIdSet.has(d.id) ? modelUndo(d) : d
          );
          const activeDocId = workspace.activeDocId;
          const active = documents.find(d => d.id === activeDocId);
          set({
            workspace: {
              ...workspace,
              documents,
              columnCursor: command.previousColumnCursor !== undefined ? command.previousColumnCursor : workspace.columnCursor,
              columnSelection: command.previousColumnSelection !== undefined ? command.previousColumnSelection : workspace.columnSelection,
              workspaceHistory: workspaceHistory.slice(0, -1),
              workspaceFuture: [...workspace.workspaceFuture, command],
            },
            stats: active ? getStats(active.raw) : EMPTY_STATS,
          });
          return;
        }

        if (command.type === 'docEdit') {
          const documents = workspace.documents.map(d =>
            d.id === command.docId ? modelUndo(d) : d
          );
          const activeDocId = workspace.activeDocId;
          const active = documents.find(d => d.id === activeDocId);
          set({
            workspace: {
              ...workspace,
              documents,
              workspaceHistory: workspaceHistory.slice(0, -1),
              workspaceFuture: [...workspace.workspaceFuture, command],
            },
            stats: active ? getStats(active.raw) : EMPTY_STATS,
          });
          return;
        }
      }

      // Fall back to per-document undo if workspaceHistory is empty.
      updateActive(modelUndo);
    },

    redo: () => {
      const { workspace } = get();
      const { workspaceFuture } = workspace;

      // Workspace-level redo mirrors workspace-level undo.
      if (workspaceFuture.length > 0) {
        const command = workspaceFuture[workspaceFuture.length - 1];
        if (command.type === 'deleteDocuments') {
          const deletedIds = new Set(command.deletedDocs.map(d => d.id));
          const documents = workspace.documents.filter(d => !deletedIds.has(d.id));
          const activeDocId = deletedIds.has(workspace.activeDocId)
            ? (documents[0]?.id ?? null)
            : workspace.activeDocId;
          set({
            workspace: {
              ...workspace,
              documents,
              activeDocId,
              selectedDocIds: new Set(),
              columnCursor: null,
              columnSelection: null,
              viewSettings: deletedIds.has(workspace.viewSettings.referenceDocId)
                ? { ...workspace.viewSettings, referenceDocId: null }
                : workspace.viewSettings,
              workspaceFuture: workspaceFuture.slice(0, -1),
              workspaceHistory: [...workspace.workspaceHistory, command],
            },
            stats: documents.find(d => d.id === activeDocId)
              ? getStats(documents.find(d => d.id === activeDocId).raw)
              : EMPTY_STATS,
          });
          return;
        }

        if (command.type === 'features') {
          const current = workspace.documents.find(d => d.id === command.docId)?.features ?? [];
          set({
            workspace: {
              ...workspace,
              documents: workspace.documents.map(d => (
                d.id === command.docId ? { ...d, features: command.previousFeatures } : d
              )),
              workspaceFuture: workspaceFuture.slice(0, -1),
              workspaceHistory: [
                ...workspace.workspaceHistory,
                { type: 'features', docId: command.docId, previousFeatures: current },
              ],
            },
          });
          return;
        }

        if (command.type === 'reorderDocuments') {
          const byId = new Map(workspace.documents.map(d => [d.id, d]));
          const documents = command.previousOrder.map(id => byId.get(id)).filter(Boolean);
          set({
            workspace: {
              ...workspace,
              documents,
              workspaceFuture: workspaceFuture.slice(0, -1),
              workspaceHistory: [
                ...workspace.workspaceHistory,
                { type: 'reorderDocuments', previousOrder: workspace.documents.map(d => d.id) },
              ],
            },
          });
          return;
        }

        if (command.type === 'multilineEdit') {
          const docIdSet = new Set(command.docIds);
          const documents = workspace.documents.map(d =>
            docIdSet.has(d.id) ? modelRedo(d) : d
          );
          const activeDocId = workspace.activeDocId;
          const active = documents.find(d => d.id === activeDocId);
          set({
            workspace: {
              ...workspace,
              documents,
              workspaceFuture: workspaceFuture.slice(0, -1),
              workspaceHistory: [...workspace.workspaceHistory, command],
            },
            stats: active ? getStats(active.raw) : EMPTY_STATS,
          });
          return;
        }

        if (command.type === 'docEdit') {
          const documents = workspace.documents.map(d =>
            d.id === command.docId ? modelRedo(d) : d
          );
          const activeDocId = workspace.activeDocId;
          const active = documents.find(d => d.id === activeDocId);
          set({
            workspace: {
              ...workspace,
              documents,
              workspaceFuture: workspaceFuture.slice(0, -1),
              workspaceHistory: [...workspace.workspaceHistory, command],
            },
            stats: active ? getStats(active.raw) : EMPTY_STATS,
          });
          return;
        }
      }

      // Fall back to per-document redo.
      updateActive(modelRedo);
    },

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

    /** @param {number} zoom - multiple of the base column width; clamped to the usable range. */
    setZoom: (zoom) => patchViewSettings({
      zoom: Math.max(get().workspace.minZoom, clampZoom(zoom)),
    }),

    /**
     * Set the zoom at which everything fits, which is as far out as the view goes.
     * Called by the canvas whenever the window or the sequences change size.
     * Capped at 1 so a short sequence in a wide window can still be zoomed out to
     * its natural size rather than being pinned at some enormous magnification.
     * @param {number} fitZoom
     */
    setMinZoom: (fitZoom) => {
      const { workspace } = get();
      const minZoom = Math.min(1, Math.max(MIN_ZOOM, fitZoom));
      if (Math.abs(minZoom - workspace.minZoom) < 1e-9) return;

      // A window that just got wider needs less zooming out to show everything,
      // so a view sitting at the old limit has to come back up to the new one.
      const zoom = Math.max(minZoom, workspace.viewSettings.zoom);
      set({
        workspace: {
          ...workspace,
          minZoom,
          viewSettings: workspace.viewSettings.zoom === zoom
            ? workspace.viewSettings
            : { ...workspace.viewSettings, zoom },
        },
      });
    },

    /** @param {number|null} px - null restores sizing to the longest name. */
    setNameGutterWidth: (px) => patchViewSettings({
      nameGutterWidth: px === null ? null : clampGutterWidth(px),
    }),

    toggleFullscreen: () => patchViewSettings({
      fullscreen: !get().workspace.viewSettings.fullscreen,
    }),

    /** @param {string} id - palette id; an unknown one falls back to the default. */
    setColorPalette: (id) => patchViewSettings({
      colorPalette: id in PALETTES ? id : DEFAULT_PALETTE,
    }),

    toggleColumnGuides: () => patchViewSettings({
      showColumnGuides: !get().workspace.viewSettings.showColumnGuides,
    }),

    toggleMinimap: () => patchViewSettings({
      showMinimap: !get().workspace.viewSettings.showMinimap,
    }),

    toggleConservation: () => patchViewSettings({
      showConservation: !get().workspace.viewSettings.showConservation,
    }),

    toggleAnnotations: () => patchViewSettings({
      showAnnotations: !get().workspace.viewSettings.showAnnotations,
    }),

    /** @param {'identity'|'entropy'} metric */
    setConservationMetric: (metric) => patchViewSettings({ conservationMetric: metric }),

    toggleEditingEnabled: () => {
      const { workspace } = get();
      set({
        workspace: {
          ...workspace,
          editingEnabled: !workspace.editingEnabled,
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

    /**
     * Make `id` the reference sequence, or clear the reference if it already is.
     * When a new reference is chosen it is moved to the top of the document list so
     * it acts as a natural anchor for the alignment below it.
     * @param {string} id
     */
    toggleReferenceDoc: (id) => {
      const { workspace } = get();
      const { viewSettings } = workspace;
      const wasReference = viewSettings.referenceDocId === id;

      // Move the chosen sequence to the top when setting (not clearing) the reference.
      const documents = wasReference
        ? workspace.documents
        : [
            workspace.documents.find(d => d.id === id),
            ...workspace.documents.filter(d => d.id !== id),
          ];

      set({
        workspace: {
          ...workspace,
          documents,
          // The row selection has served its purpose; clearing it uncovers the
          // reference tint in the gutter, which a selected row would paint over.
          selectedDocIds: new Set(),
          viewSettings: {
            ...viewSettings,
            referenceDocId: wasReference ? null : id,
            // Highlighting against a reference that no longer exists would
            // silently fall back to the first sequence, so turn it off instead.
            highlightMode: wasReference && viewSettings.highlightMode === 'reference'
              ? 'none'
              : viewSettings.highlightMode,
          },
        },
      });
    },

    // --- Renaming ---

    startRename: (id) => {
      const { workspace } = get();
      set({ workspace: { ...workspace, renamingDocId: id } });
    },

    cancelRename: () => {
      const { workspace } = get();
      if (workspace.renamingDocId === null) return;
      set({ workspace: { ...workspace, renamingDocId: null } });
    },

    /** Rename a document. An empty name is rejected — a nameless row is unidentifiable. */
    renameDoc: (id, name) => {
      const { workspace } = get();
      const index = workspace.documents.findIndex(d => d.id === id);
      const trimmed = name.trim();
      if (index === -1 || trimmed === '' || trimmed === workspace.documents[index].name) {
        set({ workspace: { ...workspace, renamingDocId: null } });
        return;
      }
      const documents = [...workspace.documents];
      documents[index] = { ...documents[index], name: trimmed, dirty: true };
      set({ workspace: { ...workspace, documents, renamingDocId: null } });
    },

    // --- Row (whole-sequence) multi-select ---

    toggleDocSelection: (id) => {
      const { workspace } = get();
      const selectedDocIds = new Set(workspace.selectedDocIds);
      if (selectedDocIds.has(id)) selectedDocIds.delete(id);
      else selectedDocIds.add(id);
      set({ workspace: { ...workspace, selectedDocIds, lastSelectionClickId: id } });
    },

    /**
     * Make `id` the only selected row — what a plain click on a name does.
     * Distinct from toggling: clicking a name means "this one", not "this one as
     * well", and it also anchors a following Shift+click.
     */
    selectOnlyDoc: (id) => {
      const { workspace } = get();
      const already = workspace.selectedDocIds.size === 1 && workspace.selectedDocIds.has(id);
      if (already && workspace.lastSelectionClickId === id) return;
      set({
        workspace: { ...workspace, selectedDocIds: new Set([id]), lastSelectionClickId: id },
      });
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

      // Collect the deleted documents and their original indices so undo can
      // re-insert them in exactly the right positions.
      const deletedDocs = [];
      const deletedIndices = [];
      workspace.documents.forEach((d, i) => {
        if (selectedDocIds.has(d.id)) {
          deletedDocs.push(d);
          deletedIndices.push(i);
        }
      });

      const command = {
        type: 'deleteDocuments',
        deletedDocs,
        deletedIndices,
        previousActiveDocId: workspace.activeDocId,
        previousSelectedDocIds: selectedDocIds,
        previousReferenceDocId: workspace.viewSettings.referenceDocId,
      };

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
          columnSelection: null,
          viewSettings: selectedDocIds.has(workspace.viewSettings.referenceDocId)
            ? { ...workspace.viewSettings, referenceDocId: null }
            : workspace.viewSettings,
          // Record the deletion; any pending workspace redo is now invalidated.
          workspaceHistory: [...workspace.workspaceHistory, command],
          workspaceFuture: [],
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

    // --- Track order, visibility, pinning and grouping ---

    setRowDropIndex: (index) => {
      const { workspace } = get();
      if (workspace.rowDropIndex === index) return;
      set({ workspace: { ...workspace, rowDropIndex: index } });
    },

    /**
     * Move `docId` so it sits at `toIndex` in the document list.
     * A reference sequence is an anchor for everything below it, so it keeps the
     * top slot: nothing can be dropped above it and it cannot itself be dragged.
     * @param {string} docId
     * @param {number} toIndex - position in the pre-move list
     */
    reorderDoc: (docId, toIndex) => {
      const { workspace } = get();
      const from = workspace.documents.findIndex(d => d.id === docId);
      if (from === -1) return;

      const hasReference = workspace.viewSettings.referenceDocId !== null;
      if (hasReference && workspace.documents[0]?.id === docId) return;
      const floor = hasReference ? 1 : 0;

      const documents = [...workspace.documents];
      const [moved] = documents.splice(from, 1);
      const target = Math.max(floor, Math.min(documents.length, toIndex > from ? toIndex - 1 : toIndex));
      documents.splice(target, 0, moved);
      if (documents.every((d, i) => d.id === workspace.documents[i].id)) return;

      set({
        workspace: {
          ...workspace,
          documents,
          rowDropIndex: null,
          workspaceHistory: [
            ...workspace.workspaceHistory,
            { type: 'reorderDocuments', previousOrder: workspace.documents.map(d => d.id) },
          ],
          workspaceFuture: [],
        },
      });
    },

    /** @param {'name-asc'|'name-desc'|'length-desc'|'length-asc'|'similarity'} mode */
    sortDocs: (mode) => {
      const { workspace } = get();
      const { documents, viewSettings } = workspace;
      if (documents.length < 2) return;

      // The reference stays where it is and everything else sorts around it.
      const reference = documents.find(d => d.id === viewSettings.referenceDocId) ?? null;
      const rest = reference ? documents.filter(d => d.id !== reference.id) : [...documents];

      const compare = {
        'name-asc': (a, b) => (a.name || '').localeCompare(b.name || ''),
        'name-desc': (a, b) => (b.name || '').localeCompare(a.name || ''),
        'length-desc': (a, b) => b.raw.length - a.raw.length,
        'length-asc': (a, b) => a.raw.length - b.raw.length,
        similarity: (a, b) => {
          const base = reference ?? documents[0];
          return percentIdentity(b.raw, base.raw) - percentIdentity(a.raw, base.raw);
        },
      }[mode];
      if (!compare) return;

      rest.sort(compare);
      const sorted = reference ? [reference, ...rest] : rest;
      if (sorted.every((d, i) => d.id === documents[i].id)) return;

      set({
        workspace: {
          ...workspace,
          documents: sorted,
          workspaceHistory: [
            ...workspace.workspaceHistory,
            { type: 'reorderDocuments', previousOrder: documents.map(d => d.id) },
          ],
          workspaceFuture: [],
        },
      });
    },

    /** Hide or show one track. Hidden tracks stay in the workspace and in exports. */
    toggleDocHidden: (id) => {
      const { workspace } = get();
      const hiddenDocIds = new Set(workspace.hiddenDocIds);
      if (hiddenDocIds.has(id)) hiddenDocIds.delete(id);
      else hiddenDocIds.add(id);

      // A hidden row cannot be the one the keyboard is aimed at.
      const activeDocId = hiddenDocIds.has(workspace.activeDocId)
        ? (workspace.documents.find(d => !hiddenDocIds.has(d.id))?.id ?? null)
        : workspace.activeDocId;

      set({ workspace: { ...workspace, hiddenDocIds, activeDocId } });
    },

    showAllDocs: () => {
      const { workspace } = get();
      if (workspace.hiddenDocIds.size === 0) return;
      set({ workspace: { ...workspace, hiddenDocIds: new Set() } });
    },

    togglePinnedDoc: (id) => {
      const { workspace } = get();
      const pinnedDocIds = new Set(workspace.pinnedDocIds);
      if (pinnedDocIds.has(id)) pinnedDocIds.delete(id);
      else pinnedDocIds.add(id);
      set({ workspace: { ...workspace, pinnedDocIds } });
    },

    /** Put the selected sequences in a new named group. */
    createGroup: (name) => {
      const { workspace } = get();
      const docIds = [...workspace.selectedDocIds];
      if (docIds.length === 0) {
        get().showToast('Select the sequences to group first', 'warning');
        return;
      }
      const id = `group-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      // A sequence belongs to one group, so grouping it moves it out of any other.
      const groups = workspace.groups
        .map(g => ({ ...g, docIds: g.docIds.filter(d => !docIds.includes(d)) }))
        .filter(g => g.docIds.length > 0);

      set({
        workspace: {
          ...workspace,
          groups: [...groups, { id, name: name || 'New group', docIds, collapsed: false }],
          selectedDocIds: new Set(),
        },
      });
    },

    toggleGroupCollapsed: (groupId) => {
      const { workspace } = get();
      set({
        workspace: {
          ...workspace,
          groups: workspace.groups.map(g => (
            g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
          )),
        },
      });
    },

    /** Move the selected sequences into an existing group. */
    addSelectionToGroup: (groupId) => {
      const { workspace } = get();
      const docIds = [...workspace.selectedDocIds];
      if (docIds.length === 0) return;
      set({
        workspace: {
          ...workspace,
          groups: workspace.groups.map(g => (
            g.id === groupId
              ? { ...g, docIds: [...new Set([...g.docIds, ...docIds])] }
              : { ...g, docIds: g.docIds.filter(d => !docIds.includes(d)) }
          )).filter(g => g.docIds.length > 0),
          selectedDocIds: new Set(),
        },
      });
    },

    ungroup: (groupId) => {
      const { workspace } = get();
      set({ workspace: { ...workspace, groups: workspace.groups.filter(g => g.id !== groupId) } });
    },

    // --- Column cursor (alignment-locus editing across every row) ---

    setColumnCursor: (col) => {
      const { workspace } = get();
      // columnCursor and columnSelection are mutually exclusive: the cursor is a
      // single-column edit locus, the selection is a readable column range.
      set({ workspace: { ...workspace, columnCursor: col, columnSelection: null } });
    },

    setColumnSelection: (sel) => {
      const { workspace } = get();
      // sel is { start, end } with start <= end, or null to clear.
      set({ workspace: { ...workspace, columnSelection: sel, columnCursor: null } });
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

    /** Remove column range [start, end) from every document whose length covers it. */
    deleteColumnRange: (start, end) => applyToAllDocs(doc => {
      const s = Math.max(0, Math.min(start, doc.raw.length));
      const e = Math.max(0, Math.min(end, doc.raw.length));
      return s < e ? modelDeleteRange(doc, s, e) : doc;
    }),

    /** Substitute characters in column range [start, end) with `char` in every document. */
    substituteColumnRange: (start, end, char = GAP_CHAR) => applyToAllDocs(doc => {
      const s = Math.max(0, Math.min(start, doc.raw.length));
      const e = Math.max(0, Math.min(end, doc.raw.length));
      if (s >= e) return doc;
      return modelReplaceRange(doc, s, e, char.repeat(e - s));
    }),

    /** Replace column range [start, end) with `text` in every document whose length covers it. */
    replaceColumnRange: (start, end, text) => applyToAllDocs(doc => {
      const s = Math.max(0, Math.min(start, doc.raw.length));
      const e = Math.max(0, Math.min(end, doc.raw.length));
      return s < e ? modelReplaceRange(doc, s, e, text) : doc;
    }),

    // --- Dialogs ---

    /** @param {'help'|'jump'|'distance'|'tree'|null} name */
    openDialog: (name) => set({ dialog: name }),

    closeDialog: () => {
      if (get().dialog === null) return;
      set({ dialog: null });
    },

    // --- Find & replace ---

    openFind: () => set(s => ({ find: { ...s.find, open: true } })),

    closeFind: () => set(s => ({
      // Matches are dropped with the bar so the canvas stops highlighting them.
      find: { ...s.find, open: false, matches: [], activeIndex: -1 },
    })),

    /** Merge a patch into the find state; `options` merges one level deeper. */
    patchFind: (patch) => set(s => ({
      find: {
        ...s.find,
        ...patch,
        options: patch.options ? { ...s.find.options, ...patch.options } : s.find.options,
      },
    })),

    /** Re-run the current query, keeping the viewport on a match if one still fits. */
    runSearch: () => {
      const { workspace, find } = get();
      const { query, options } = find;
      const targets = options.allSequences
        ? workspace.documents
        : workspace.documents.filter(d => d.id === workspace.activeDocId);
      const matches = query ? findMatches(targets, query, options) : [];
      set({
        find: {
          ...find,
          matches,
          activeIndex: matches.length === 0
            ? -1
            : Math.min(Math.max(find.activeIndex, 0), matches.length - 1),
        },
      });
      return matches;
    },

    /** @param {number} delta - +1 for the next match, -1 for the previous one. */
    stepMatch: (delta) => {
      const { find } = get();
      if (find.matches.length === 0) return null;
      const next = (find.activeIndex + delta + find.matches.length) % find.matches.length;
      set({ find: { ...find, activeIndex: next } });
      return find.matches[next];
    },

    /** Replace the match the readout is on, then re-run the search. */
    replaceActiveMatch: () => {
      const { find, workspace } = get();
      const match = find.matches[find.activeIndex];
      if (!match) return;
      batchRawEdit(doc => (
        doc.id === match.docId
          ? applyReplacements(doc.raw, [match], find.replacement)
          : null
      ));
      // Positions after the replacement have shifted, so the hit list is stale.
      const documents = get().workspace.documents;
      const targets = find.options.allSequences
        ? documents
        : documents.filter(d => d.id === workspace.activeDocId);
      const matches = find.query ? findMatches(targets, find.query, find.options) : [];
      set({
        find: {
          ...get().find,
          matches,
          activeIndex: matches.length === 0 ? -1 : Math.min(find.activeIndex, matches.length - 1),
        },
      });
    },

    /** Replace every match, across every searched row, as a single undo entry. */
    replaceAllMatches: () => {
      const { find } = get();
      if (find.matches.length === 0) return 0;

      const byDoc = new Map();
      for (const m of find.matches) {
        if (!byDoc.has(m.docId)) byDoc.set(m.docId, []);
        byDoc.get(m.docId).push(m);
      }

      batchRawEdit(doc => {
        const hits = byDoc.get(doc.id);
        return hits ? applyReplacements(doc.raw, hits, find.replacement) : null;
      });

      const replaced = find.matches.length;
      set({ find: { ...get().find, matches: [], activeIndex: -1 } });
      get().showToast(`Replaced ${replaced} match${replaced === 1 ? '' : 'es'}`, 'info');
      return replaced;
    },

    // --- Feature annotations ---

    /**
     * Open the annotation editor.
     * @param {{docId: string, featureId?: string, start?: number, end?: number}} draft
     */
    openAnnotation: (draft) => set({ annotationDraft: draft }),

    closeAnnotation: () => {
      if (get().annotationDraft === null) return;
      set({ annotationDraft: null });
    },

    /** Add or update a feature on a document, as one undo entry. */
    saveFeature: (docId, input) => {
      const feature = createFeature(input);
      if (!feature) {
        get().showToast('An annotation needs a span of at least one base', 'warning');
        return;
      }
      const { workspace } = get();
      const doc = workspace.documents.find(d => d.id === docId);
      if (!doc) return;

      set({
        workspace: {
          ...workspace,
          documents: workspace.documents.map(d => (
            d.id === docId ? { ...d, features: upsertFeature(d.features, feature), dirty: true } : d
          )),
          workspaceHistory: [
            ...workspace.workspaceHistory,
            { type: 'features', docId, previousFeatures: doc.features ?? [] },
          ],
          workspaceFuture: [],
        },
        annotationDraft: null,
      });
    },

    deleteFeature: (docId, featureId) => {
      const { workspace } = get();
      const doc = workspace.documents.find(d => d.id === docId);
      if (!doc) return;

      set({
        workspace: {
          ...workspace,
          documents: workspace.documents.map(d => (
            d.id === docId ? { ...d, features: removeFeature(d.features, featureId), dirty: true } : d
          )),
          workspaceHistory: [
            ...workspace.workspaceHistory,
            { type: 'features', docId, previousFeatures: doc.features ?? [] },
          ],
          workspaceFuture: [],
        },
        annotationDraft: null,
      });
    },

    // --- Alignment cleanup (every row, one undo entry each) ---

    stripGapColumns: () => {
      const { workspace } = get();
      const rows = workspace.documents.map(d => d.raw);
      const stripped = stripAllGapColumns(rows);
      const removed = (rows[0]?.length ?? 0) - (stripped[0]?.length ?? 0);
      if (stripped === rows) {
        get().showToast('No all-gap columns to remove', 'info');
        return;
      }
      const byIndex = new Map(workspace.documents.map((d, i) => [d.id, stripped[i]]));
      batchRawEdit(doc => byIndex.get(doc.id));
      get().showToast(`Removed ${removed} all-gap column${removed === 1 ? '' : 's'}`, 'info');
    },

    /** @param {number} minCoverage - 0–1 share of rows that must have a base. */
    trimEnds: (minCoverage) => {
      const { workspace } = get();
      const rows = workspace.documents.map(d => d.raw);
      const trimmed = trimRaggedEnds(rows, minCoverage);
      if (trimmed === rows) {
        get().showToast('Both ends already meet that coverage', 'info');
        return;
      }
      const removed = (rows[0]?.length ?? 0) - (trimmed[0]?.length ?? 0);
      const byIndex = new Map(workspace.documents.map((d, i) => [d.id, trimmed[i]]));
      batchRawEdit(doc => byIndex.get(doc.id));
      get().showToast(`Trimmed ${removed} column${removed === 1 ? '' : 's'} from the ends`, 'info');
    },

    padSequences: () => {
      const { workspace } = get();
      const rows = workspace.documents.map(d => d.raw);
      const padded = padToLength(rows);
      if (padded === rows) {
        get().showToast('Sequences are already the same length', 'info');
        return;
      }
      const byIndex = new Map(workspace.documents.map((d, i) => [d.id, padded[i]]));
      batchRawEdit(doc => byIndex.get(doc.id));
      get().showToast('Padded sequences to a common length', 'info');
    },

    /**
     * Reverse, complement or transcribe.
     * @param {keyof TRANSFORMS} kind
     * @param {'active'|'selected'|'span'} scope
     */
    applyTransform: (kind, scope = 'active') => {
      const transform = TRANSFORMS[kind];
      if (!transform) return;
      const { workspace } = get();
      const active = workspace.documents.find(d => d.id === workspace.activeDocId);

      if (scope === 'span') {
        const selection = active?.selection;
        if (!selection) {
          get().showToast('Select a span first', 'warning');
          return;
        }
        batchRawEdit(doc => (
          doc.id === active.id
            ? transformSpan(doc.raw, selection.start, selection.end, transform.apply)
            : null
        ));
      } else if (scope === 'selected') {
        const targets = workspace.selectedDocIds;
        if (targets.size === 0) {
          get().showToast('Select the sequences to transform first', 'warning');
          return;
        }
        batchRawEdit(doc => (targets.has(doc.id) ? transform.apply(doc.raw) : null));
      } else {
        if (!active) return;
        batchRawEdit(doc => (doc.id === active.id ? transform.apply(doc.raw) : null));
      }

      get().showToast(`Applied ${transform.label.toLowerCase()}`, 'info');
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
