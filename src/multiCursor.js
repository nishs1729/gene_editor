// Multiple cursors, as in VS Code: carets placed on chosen rows with Alt+↑/↓ or
// Alt+click, and edited together. The column cursor from the ruler is the other
// way to edit several rows at once — every row, at one column; these are the
// rows, and the positions, the user picks.
//
// A cursor is { docId, pos, goal?, dir? }. `pos` is an insertion point, as a
// document's own cursorPos is. The list is kept in the order the cursors were
// added, so the last one is the primary: the active row, and the one Alt+↑/↓
// grows from. `goal` is the column a vertical run is aiming for, kept when a
// short row clamps `pos` to its end, and `dir` records that the cursor was added
// by Alt+↑ ('up') or Alt+↓ ('down'), so the opposite key can take it back.

import { insertAt, deleteRange } from './sequenceModel.js';

const keyOf = c => `${c.docId}:${c.pos}`;

/** Drop cursors that coincide, keeping the later one — the later one may be the primary. */
export function normalizeCursors(cursors) {
  const seen = new Set();
  const kept = [];
  for (let i = cursors.length - 1; i >= 0; i--) {
    const key = keyOf(cursors[i]);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(cursors[i]);
  }
  return kept.reverse();
}

/**
 * Alt+↑ / Alt+↓: add a cursor on the row above or below the primary, in the
 * same column — or, if the primary was itself added from the other direction,
 * take it back, so overshooting is one key to undo.
 * @param {object[]} cursors - at least one
 * @param {object[]} rows - the visible sequences, top to bottom
 * @param {'up'|'down'} dir
 * @returns {object[]} the new list; `cursors` itself when nothing changed
 */
export function addCursorVertical(cursors, rows, dir) {
  const last = cursors[cursors.length - 1];
  if (cursors.length > 1 && last.dir && last.dir !== dir) return cursors.slice(0, -1);

  const step = dir === 'up' ? -1 : 1;
  const goal = last.goal ?? last.pos;
  const taken = new Set(cursors.map(keyOf));
  let i = rows.findIndex(d => d.id === last.docId);
  if (i === -1) return cursors;

  // A row that already has a cursor at that column is passed over, so the run
  // keeps going rather than stalling on it.
  for (i += step; i >= 0 && i < rows.length; i += step) {
    const cursor = { docId: rows[i].id, pos: Math.min(goal, rows[i].raw.length), goal, dir };
    if (!taken.has(keyOf(cursor))) return [...cursors, cursor];
  }
  return cursors;
}

/** Alt+click: add a cursor there, or remove the one already there. */
export function toggleCursor(cursors, docId, pos) {
  const i = cursors.findIndex(c => c.docId === docId && c.pos === pos);
  if (i === -1) return [...cursors, { docId, pos }];
  return cursors.length > 1 ? cursors.filter((_, j) => j !== i) : cursors;
}

/**
 * Move every cursor along its own row.
 * @param {number|'home'|'end'} by - a step, or to the row's start or end
 */
export function moveCursors(cursors, docsById, by) {
  return normalizeCursors(cursors.map(c => {
    const length = docsById.get(c.docId)?.raw.length ?? 0;
    const pos = by === 'home' ? 0
      : by === 'end' ? length
        : Math.max(0, Math.min(length, c.pos + by));
    return { docId: c.docId, pos, dir: c.dir };
  }));
}

/** Cursors top to bottom, and left to right within a row — the order paste lines go in. */
export function cursorsInRowOrder(cursors, rows) {
  const rank = new Map(rows.map((d, i) => [d.id, i]));
  return [...cursors].sort((a, b) =>
    (rank.get(a.docId) ?? Infinity) - (rank.get(b.docId) ?? Infinity) || a.pos - b.pos
  );
}

/**
 * Apply one edit at every cursor. Each row's cursors are worked right to left,
 * so an edit never moves the positions of the ones still to come.
 * @param {object[]} documents
 * @param {object[]} cursors
 * @param {{type: 'insert', textFor: function(object): string} | {type: 'backspace'} | {type: 'delete'}} op
 *   — `textFor(cursor)` is the (already valid) text to insert at that cursor
 * @returns {{documents: object[], cursors: object[], docIds: string[]}} `docIds`
 *   names a row once for every entry the edit pushed onto its undo stack
 */
export function applyAtCursors(documents, cursors, op) {
  const byDoc = new Map();
  for (const c of cursors) {
    if (!byDoc.has(c.docId)) byDoc.set(c.docId, new Map());
    byDoc.get(c.docId).set(c.pos, c);
  }

  const docIds = [];
  const newPos = new Map(); // cursor key → position after the edit
  const next = documents.map(doc => {
    const here = byDoc.get(doc.id);
    if (!here) return doc;
    const positions = [...here.keys()].sort((a, b) => a - b);
    const length = doc.raw.length;

    // Where each cursor lands: shifted by what was inserted or removed before it.
    let shift = 0;
    const changes = positions.map(p => {
      let change = null;
      if (op.type === 'insert') {
        const text = op.textFor(here.get(p)) ?? '';
        if (text) change = { at: p, text };
        shift += text.length;
        newPos.set(`${doc.id}:${p}`, p + shift);
      } else if (op.type === 'backspace') {
        if (p > 0) { change = { from: p - 1, to: p }; shift++; }
        newPos.set(`${doc.id}:${p}`, p - shift);
      } else {
        newPos.set(`${doc.id}:${p}`, p - shift);
        if (p < length) { change = { from: p, to: p + 1 }; shift++; }
      }
      return change;
    });

    let result = doc;
    for (let i = changes.length - 1; i >= 0; i--) {
      const change = changes[i];
      if (!change) continue;
      const edited = change.text !== undefined
        ? insertAt(result, change.at, change.text)
        : deleteRange(result, change.from, change.to);
      if (edited !== result) docIds.push(doc.id);
      result = edited;
    }
    return result;
  });

  const moved = cursors.map(c => ({ docId: c.docId, pos: newPos.get(keyOf(c)) ?? c.pos, dir: c.dir }));
  return { documents: next, cursors: normalizeCursors(moved), docIds };
}
