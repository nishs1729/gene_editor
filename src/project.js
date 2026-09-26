// The .gene project file: every open file, its sequences, annotations, view
// settings and recent undo history, so a session can be picked up on another
// machine exactly where it was left. Like Geneious's own .geneious format, it
// is a self-describing document the Open button recognises on its own.
//
// On disk it is gzip-compressed JSON. The same JSON, uncompressed, is what the
// Save button keeps in browser storage.

import { createDocument } from './sequenceModel.js';

export const PROJECT_FORMAT = 'gene-editor-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.gene';

// How much undo history a project keeps, per file and per direction (undo and
// redo each). A hundred steps is a long editing session; the character budget
// is what bounds the file on large alignments, where one whole-sequence
// transform records the full sequence before and after, for every row it
// touched. The most recent steps are the ones kept.
export const MAX_UNDO_STEPS = 100;
export const MAX_UNDO_CHARS = 1_000_000;

/** @param {string} fileName */
export function isProjectFile(fileName) {
  return (fileName ?? '').toLowerCase().endsWith(PROJECT_EXTENSION);
}

// --- Saving ---

/** The documents whose own undo stacks each workspace command pops from. */
function editedDocIds(command) {
  if (command.type === 'docEdit') return [command.docId];
  if (command.type === 'multilineEdit') return command.docIds;
  return [];
}

/**
 * The most recent workspace commands that fit the limits, and how many of each
 * document's own undo entries they account for. A workspace edit and the
 * document entry it pops are always recorded together, so keeping the last N
 * of one means keeping the matching last entries of the other.
 * @param {object[]} commands - a workspace undo or redo stack, oldest first
 * @param {Map<string, object>} docsById - the file's live documents
 * @param {'history'|'future'} stack - which of each document's stacks pairs with it
 */
function trimStack(commands, docsById, stack) {
  const used = new Map();
  const kept = [];
  let chars = 0;

  for (let i = commands.length - 1; i >= 0 && kept.length < MAX_UNDO_STEPS; i--) {
    const command = commands[i];
    const ids = editedDocIds(command);
    let size = 0;
    for (const id of ids) {
      const entries = docsById.get(id)?.[stack] ?? [];
      const entry = entries[entries.length - 1 - (used.get(id) ?? 0)];
      size += (entry?.before?.length ?? 0) + (entry?.after?.length ?? 0);
    }
    if (command.type === 'deleteDocuments') {
      size += command.deletedDocs.reduce((sum, d) => sum + d.raw.length, 0);
    }
    if (chars + size > MAX_UNDO_CHARS) break;

    chars += size;
    for (const id of ids) used.set(id, (used.get(id) ?? 0) + 1);
    kept.unshift(command);
  }
  return { kept, used };
}

/**
 * A document as saved. `keep` says how many of its most recent undo and redo
 * entries survive; a sequence held inside a deletion command keeps none, since
 * its stacks cannot be paired reliably once it has left the workspace (undoing
 * past it then simply has nothing further to undo, rather than misapplying).
 */
function saveDocument(doc, keep = { history: 0, future: 0 }) {
  return {
    id: doc.id,
    name: doc.name,
    raw: doc.raw,
    features: doc.features ?? [],
    selection: doc.selection ?? null,
    cursorPos: doc.cursorPos ?? 0,
    history: keep.history > 0 ? doc.history.slice(-keep.history) : [],
    future: keep.future > 0 ? doc.future.slice(-keep.future) : [],
  };
}

function saveCommand(command) {
  if (command.type !== 'deleteDocuments') return command;
  return {
    ...command,
    deletedDocs: command.deletedDocs.map(d => saveDocument(d)),
    previousSelectedDocIds: [...(command.previousSelectedDocIds ?? [])],
  };
}

function saveFile(file, includeHistory) {
  const docsById = new Map(file.documents.map(d => [d.id, d]));
  const history = includeHistory
    ? trimStack(file.workspaceHistory, docsById, 'history')
    : { kept: [], used: new Map() };
  const future = includeHistory
    ? trimStack(file.workspaceFuture, docsById, 'future')
    : { kept: [], used: new Map() };

  return {
    name: file.name,
    documents: file.documents.map(d => saveDocument(d, {
      history: history.used.get(d.id) ?? 0,
      future: future.used.get(d.id) ?? 0,
    })),
    activeDocId: file.activeDocId,
    editingEnabled: file.editingEnabled,
    hiddenDocIds: [...file.hiddenDocIds],
    pinnedDocIds: [...file.pinnedDocIds],
    selectedDocIds: [...file.selectedDocIds],
    lastSelectionClickId: file.lastSelectionClickId,
    groups: file.groups,
    columnCursor: file.columnCursor,
    columnSelection: file.columnSelection,
    // Fullscreen is how this screen is being used, not part of the work.
    viewSettings: { ...file.viewSettings, fullscreen: false },
    workspaceHistory: history.kept.map(saveCommand),
    workspaceFuture: future.kept.map(saveCommand),
  };
}

/**
 * @param {object[]} files - every open file, in panel order, each shaped like
 *   a store file entry (name, documents, viewSettings, undo stacks, ...)
 * @param {number} activeIndex - which of them is on screen
 * @param {{includeHistory?: boolean}} [options]
 * @returns {object} a JSON-safe project
 */
export function serializeProject(files, activeIndex, { includeHistory = true } = {}) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    activeFileIndex: Math.max(0, activeIndex),
    files: files.map(f => saveFile(f, includeHistory)),
  };
}

// --- Opening ---

/**
 * Every sequence gets a fresh id on the way in, and every reference to it is
 * rewritten to match — as Geneious rewrites document URNs on import — so the
 * same project can be opened twice alongside itself without two sequences
 * answering to one id.
 */
function idRemapper() {
  const map = new Map();
  return id => {
    if (id == null) return id;
    if (!map.has(id)) map.set(id, createDocument().id);
    return map.get(id);
  };
}

function openDocument(saved, remap) {
  if (typeof saved?.raw !== 'string') throw new Error('A sequence in the project has no bases');
  const doc = createDocument(saved.name ?? '', saved.raw);
  return {
    ...doc,
    id: remap(saved.id),
    features: Array.isArray(saved.features) ? saved.features : [],
    selection: saved.selection ?? null,
    cursorPos: Math.min(Math.max(0, saved.cursorPos ?? 0), doc.raw.length),
    history: Array.isArray(saved.history) ? saved.history : [],
    future: Array.isArray(saved.future) ? saved.future : [],
  };
}

function openCommand(command, remap) {
  switch (command.type) {
    case 'docEdit':
      return { ...command, docId: remap(command.docId) };
    case 'multilineEdit':
      return { ...command, docIds: command.docIds.map(remap) };
    case 'features':
      return { ...command, docId: remap(command.docId) };
    case 'reorderDocuments':
      return { ...command, previousOrder: command.previousOrder.map(remap) };
    case 'deleteDocuments':
      return {
        ...command,
        deletedDocs: command.deletedDocs.map(d => openDocument(d, remap)),
        previousActiveDocId: remap(command.previousActiveDocId),
        previousSelectedDocIds: new Set((command.previousSelectedDocIds ?? []).map(remap)),
        previousReferenceDocId: remap(command.previousReferenceDocId),
      };
    default:
      return command;
  }
}

function openFile(saved) {
  if (!Array.isArray(saved?.documents)) throw new Error('A file in the project has no sequences');
  const remap = idRemapper();
  const documents = saved.documents.map(d => openDocument(d, remap));
  const ids = list => new Set((list ?? []).map(remap));
  const viewSettings = { ...(saved.viewSettings ?? {}) };
  if ('referenceDocId' in viewSettings) viewSettings.referenceDocId = remap(viewSettings.referenceDocId);

  const activeDocId = remap(saved.activeDocId);

  return {
    name: saved.name ?? '',
    documents,
    activeDocId: documents.some(d => d.id === activeDocId) ? activeDocId : (documents[0]?.id ?? null),
    editingEnabled: Boolean(saved.editingEnabled),
    hiddenDocIds: ids(saved.hiddenDocIds),
    pinnedDocIds: ids(saved.pinnedDocIds),
    selectedDocIds: ids(saved.selectedDocIds),
    lastSelectionClickId: remap(saved.lastSelectionClickId) ?? null,
    groups: (saved.groups ?? []).map(g => ({ ...g, docIds: g.docIds.map(remap) })),
    columnCursor: saved.columnCursor ?? null,
    columnSelection: saved.columnSelection ?? null,
    viewSettings,
    workspaceHistory: (saved.workspaceHistory ?? []).map(c => openCommand(c, remap)),
    workspaceFuture: (saved.workspaceFuture ?? []).map(c => openCommand(c, remap)),
  };
}

/**
 * @param {object} project - parsed project JSON
 * @returns {{files: object[], activeIndex: number}} file states, ready to be
 *   given ids and defaults by the store
 */
export function deserializeProject(project) {
  if (project?.format !== PROJECT_FORMAT) throw new Error('Not a project file');
  if (typeof project.version !== 'number' || project.version > PROJECT_VERSION) {
    throw new Error('This project was saved by a newer version of the app');
  }
  if (!Array.isArray(project.files) || project.files.length === 0) {
    throw new Error('The project has no files in it');
  }
  const files = project.files.map(openFile);
  const activeIndex = Math.min(Math.max(0, project.activeFileIndex ?? 0), files.length - 1);
  return { files, activeIndex };
}

// --- The file itself ---

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** @returns {Promise<Blob>} the project as a gzip-compressed .gene file */
export async function encodeProject(project) {
  const json = new TextEncoder().encode(JSON.stringify(project));
  const gz = await pipe(json, new CompressionStream('gzip'));
  return new Blob([gz], { type: 'application/gzip' });
}

/**
 * Read a .gene file. Plain JSON is accepted too, so a project that has been
 * unpacked by hand still opens.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {Promise<object>} parsed project JSON
 */
export async function decodeProject(buffer) {
  let bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0x1F && bytes[1] === 0x8B) {
    bytes = await pipe(bytes, new DecompressionStream('gzip'));
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Not a project file');
  }
}
