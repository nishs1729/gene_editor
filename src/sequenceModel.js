// Sequence document model with command-pattern undo/redo.
// All mutation functions are pure — they return new state, not mutate in place.

import { isValidChar, complement } from './iupac.js';

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
    viewSettings: {
      lineWidth: 0,     // 0 = auto-calculate from canvas width
      showComplement: false,
      zoom: 1,
      fullscreen: false,
    },
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
  const command = {
    type: 'substitute',
    position: pos,
    before,
    after: upperChar,
  };

  return {
    ...doc,
    raw: newRaw,
    length: newRaw.length,
    history: [...doc.history, command],
    future: [], // clear redo stack on new edit
  };
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
  const command = {
    type: 'insert',
    position: pos,
    before: '',
    after: validStr,
  };

  return {
    ...doc,
    raw: newRaw,
    length: newRaw.length,
    history: [...doc.history, command],
    future: [],
  };
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
  const command = {
    type: 'delete',
    position: start,
    before: deleted,
    after: '',
  };

  return {
    ...doc,
    raw: newRaw,
    length: newRaw.length,
    history: [...doc.history, command],
    future: [],
  };
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
    default:
      return doc;
  }

  return {
    ...doc,
    raw: newRaw,
    length: newRaw.length,
    history: newHistory,
    future: [...doc.future, command],
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
    default:
      return doc;
  }

  return {
    ...doc,
    raw: newRaw,
    length: newRaw.length,
    history: [...doc.history, command],
    future: newFuture,
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
 * @param {string} raw - DNA sequence
 * @returns {object} { length, gcPercent, counts: { A, T, G, C, ... } }
 */
export function getStats(raw) {
  const counts = {};
  for (const c of raw) {
    counts[c] = (counts[c] || 0) + 1;
  }

  const gc = (counts['G'] || 0) + (counts['C'] || 0);
  const gcPercent = raw.length > 0 ? (gc / raw.length) * 100 : 0;

  return {
    length: raw.length,
    gcPercent: Math.round(gcPercent * 10) / 10, // 1 decimal place
    counts,
  };
}
