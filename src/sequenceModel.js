// Sequence document model with command-pattern undo/redo.
// All mutation functions are pure — they return new state, not mutate in place.

import { isValidChar, complement, GAP_CHAR } from './iupac.js';

/**
 * Creates a new SequenceDocument.
 * @param {string} name - sequence name/header
 * @param {string} raw - the DNA sequence (will be uppercased)
 * @returns {object} SequenceDocument
 */
export function createDocument(name = '', raw = '') {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name,
    raw: raw.toUpperCase(),
    length: raw.length,
    history: [],  // undo stack: Array<Command>
    future: [],   // redo stack: Array<Command>
    selection: null, // { start: number, end: number } | null
    cursorPos: 0,
    dirty: false,
  };
}

/**
 * Build the successor document for an edit, recording the command for undo.
 */
function applyEdit(doc, newRaw, command) {
  return {
    ...doc,
    raw: newRaw,
    length: newRaw.length,
    history: [...doc.history, command],
    future: [], // clear redo stack on new edit
    dirty: true,
  };
}

/**
 * Substitute a single character at a position.
 * @param {object} doc - SequenceDocument
 * @param {number} pos - position to substitute at
 * @param {string} char - new character (single IUPAC char)
 * @returns {object} new SequenceDocument
 */
export function substitute(doc, pos, char) {
  const upperChar = char.toUpperCase();
  if (!isValidChar(upperChar)) return doc;
  if (pos < 0 || pos >= doc.raw.length) return doc;

  const before = doc.raw[pos];
  if (before === upperChar) return doc; // no-op

  const newRaw = doc.raw.slice(0, pos) + upperChar + doc.raw.slice(pos + 1);
  return applyEdit(doc, newRaw, {
    type: 'substitute',
    position: pos,
    before,
    after: upperChar,
  });
}

/**
 * Insert a string at a position.
 * @param {object} doc - SequenceDocument
 * @param {number} pos - position to insert at
 * @param {string} str - string to insert (each char validated)
 * @returns {object} new SequenceDocument
 */
export function insertAt(doc, pos, str) {
  const upperStr = str.toUpperCase();
  // Filter to only valid IUPAC chars
  const validStr = [...upperStr].filter(c => isValidChar(c)).join('');
  if (validStr.length === 0) return doc;
  if (pos < 0 || pos > doc.raw.length) return doc;

  const newRaw = doc.raw.slice(0, pos) + validStr + doc.raw.slice(pos);
  return applyEdit(doc, newRaw, {
    type: 'insert',
    position: pos,
    before: '',
    after: validStr,
  });
}

/**
 * Delete a range of characters [start, end).
 * @param {object} doc - SequenceDocument
 * @param {number} start - start index (inclusive)
 * @param {number} end - end index (exclusive)
 * @returns {object} new SequenceDocument
 */
export function deleteRange(doc, start, end) {
  if (start < 0 || end > doc.raw.length || start >= end) return doc;

  const deleted = doc.raw.slice(start, end);
  const newRaw = doc.raw.slice(0, start) + doc.raw.slice(end);
  return applyEdit(doc, newRaw, {
    type: 'delete',
    position: start,
    before: deleted,
    after: '',
  });
}

/**
 * Replace the range [start, end) with `text` as a single undoable command.
 * This is what typing or pasting over a selection uses — issuing a delete and an
 * insert separately would take two undos to reverse one user action.
 * @param {object} doc - SequenceDocument
 * @param {number} start - start index (inclusive)
 * @param {number} end - end index (exclusive)
 * @param {string} text - replacement text (invalid characters are filtered out)
 * @returns {object} new SequenceDocument
 */
export function replaceRange(doc, start, end, text) {
  if (start < 0 || end > doc.raw.length || start > end) return doc;

  const validStr = [...text.toUpperCase()].filter(c => isValidChar(c)).join('');
  const before = doc.raw.slice(start, end);
  if (before === validStr) return doc;

  const newRaw = doc.raw.slice(0, start) + validStr + doc.raw.slice(end);
  return applyEdit(doc, newRaw, {
    type: 'replace',
    position: start,
    before,
    after: validStr,
  });
}

/**
 * Move the bases in [start, end) so they begin at `dest`, as one undoable command.
 * `dest` is an index in the pre-move coordinate space.
 * @param {object} doc - SequenceDocument
 * @param {number} start - start of the range to move (inclusive)
 * @param {number} end - end of the range to move (exclusive)
 * @param {number} dest - insertion point for the moved range
 * @returns {object} new SequenceDocument
 */
export function moveRange(doc, start, end, dest) {
  if (start < 0 || end > doc.raw.length || start >= end) return doc;
  if (dest < 0 || dest > doc.raw.length) return doc;
  if (dest >= start && dest <= end) return doc; // dropped onto itself

  const moved = doc.raw.slice(start, end);
  const without = doc.raw.slice(0, start) + doc.raw.slice(end);
  const adjustedDest = dest > end ? dest - moved.length : dest;
  const newRaw = without.slice(0, adjustedDest) + moved + without.slice(adjustedDest);

  // A move is a permutation of one contiguous span, so it records as a single
  // same-length replace of just the span that actually changed.
  const spanStart = Math.min(start, dest);
  const spanEnd = Math.max(end, dest);
  return applyEdit(doc, newRaw, {
    type: 'replace',
    position: spanStart,
    before: doc.raw.slice(spanStart, spanEnd),
    after: newRaw.slice(spanStart, spanEnd),
  });
}

/**
 * Reverse-complement the whole document in place, as one undoable command.
 * @param {object} doc - SequenceDocument
 * @returns {object} new SequenceDocument
 */
export function reverseComplementDoc(doc) {
  if (doc.raw.length === 0) return doc;
  const rc = reverseComplement(doc.raw);
  if (rc === doc.raw) return doc;

  return applyEdit(doc, rc, {
    type: 'replace',
    position: 0,
    before: doc.raw,
    after: rc,
  });
}

/**
 * Undo the last edit.
 * @param {object} doc - SequenceDocument
 * @returns {object} new SequenceDocument
 */
export function undo(doc) {
  if (doc.history.length === 0) return doc;

  const command = doc.history[doc.history.length - 1];
  const newHistory = doc.history.slice(0, -1);
  let newRaw;

  switch (command.type) {
    case 'substitute':
      newRaw = doc.raw.slice(0, command.position) + command.before + doc.raw.slice(command.position + 1);
      break;
    case 'insert':
      // Undo insert = delete what was inserted
      newRaw = doc.raw.slice(0, command.position) + doc.raw.slice(command.position + command.after.length);
      break;
    case 'delete':
      // Undo delete = re-insert what was deleted
      newRaw = doc.raw.slice(0, command.position) + command.before + doc.raw.slice(command.position);
      break;
    case 'replace':
      newRaw = doc.raw.slice(0, command.position) + command.before
        + doc.raw.slice(command.position + command.after.length);
      break;
    default:
      return doc;
  }

  return {
    ...doc,
    raw: newRaw,
    length: newRaw.length,
    history: newHistory,
    future: [...doc.future, command],
    dirty: true,
  };
}

/**
 * Redo the last undone edit.
 * @param {object} doc - SequenceDocument
 * @returns {object} new SequenceDocument
 */
export function redo(doc) {
  if (doc.future.length === 0) return doc;

  const command = doc.future[doc.future.length - 1];
  const newFuture = doc.future.slice(0, -1);
  let newRaw;

  switch (command.type) {
    case 'substitute':
      newRaw = doc.raw.slice(0, command.position) + command.after + doc.raw.slice(command.position + 1);
      break;
    case 'insert':
      newRaw = doc.raw.slice(0, command.position) + command.after + doc.raw.slice(command.position);
      break;
    case 'delete':
      newRaw = doc.raw.slice(0, command.position) + doc.raw.slice(command.position + command.before.length);
      break;
    case 'replace':
      newRaw = doc.raw.slice(0, command.position) + command.after
        + doc.raw.slice(command.position + command.before.length);
      break;
    default:
      return doc;
  }

  return {
    ...doc,
    raw: newRaw,
    length: newRaw.length,
    history: [...doc.history, command],
    future: newFuture,
    dirty: true,
  };
}

/**
 * Returns the reverse complement of a sequence string.
 * Pure function — does not mutate the document.
 * @param {string} raw - DNA sequence
 * @returns {string} reverse complement
 */
export function reverseComplement(raw) {
  return [...raw].reverse().map(c => complement(c) || c).join('');
}

/**
 * Compute sequence statistics.
 * %GC is measured over ungapped length — an alignment row that is half gaps
 * would otherwise report a meaninglessly deflated value.
 * @param {string} raw - DNA sequence
 * @returns {object} { length, ungappedLength, gaps, gcPercent, counts }
 */
export function getStats(raw) {
  const counts = {};
  for (const c of raw) {
    counts[c] = (counts[c] || 0) + 1;
  }

  const gaps = counts[GAP_CHAR] || 0;
  const ungappedLength = raw.length - gaps;
  const gc = (counts['G'] || 0) + (counts['C'] || 0);
  const gcPercent = ungappedLength > 0 ? (gc / ungappedLength) * 100 : 0;

  return {
    length: raw.length,
    ungappedLength,
    gaps,
    gcPercent: Math.round(gcPercent * 10) / 10, // 1 decimal place
    counts,
  };
}
