import { describe, it, expect } from 'vitest';
import {
  normalizeCursors, addCursorVertical, toggleCursor, moveCursors, cursorsInRowOrder, applyAtCursors,
} from '../multiCursor.js';
import { createDocument, undo } from '../sequenceModel.js';

const row = (id, raw) => ({ ...createDocument(id, raw), id });
const rows = [row('a', 'ACGTACGT'), row('b', 'ACG'), row('c', 'ACGTACGT'), row('d', 'ACGTACGT')];
const byId = new Map(rows.map(d => [d.id, d]));
const at = (docId, pos) => ({ docId, pos });
const plain = cursors => cursors.map(({ docId, pos }) => ({ docId, pos }));

describe('normalizeCursors', () => {
  it('drops coinciding cursors, keeping the later — the primary stays last', () => {
    expect(normalizeCursors([at('a', 1), at('b', 2), at('a', 1)])).toEqual([at('b', 2), at('a', 1)]);
  });
});

describe('addCursorVertical', () => {
  it('adds a cursor on the row above, in the same column', () => {
    const next = addCursorVertical([at('c', 5)], rows, 'up');
    expect(plain(next)).toEqual([at('c', 5), at('b', 3)]);
  });

  it('keeps aiming for the column after a short row clamped it', () => {
    let cursors = addCursorVertical([at('c', 5)], rows, 'up');
    cursors = addCursorVertical(cursors, rows, 'up');
    expect(plain(cursors)).toEqual([at('c', 5), at('b', 3), at('a', 5)]);
  });

  it('takes back the last cursor when the direction reverses', () => {
    let cursors = addCursorVertical([at('b', 2)], rows, 'down');
    cursors = addCursorVertical(cursors, rows, 'down');
    expect(cursors).toHaveLength(3);
    cursors = addCursorVertical(cursors, rows, 'up');
    expect(plain(cursors)).toEqual([at('b', 2), at('c', 2)]);
    cursors = addCursorVertical(cursors, rows, 'up');
    expect(plain(cursors)).toEqual([at('b', 2)]);
    // Past the starting row, it grows the other way.
    cursors = addCursorVertical(cursors, rows, 'up');
    expect(plain(cursors)).toEqual([at('b', 2), at('a', 2)]);
  });

  it('stops at the top and bottom rows', () => {
    const top = [at('a', 1)];
    expect(addCursorVertical(top, rows, 'up')).toBe(top);
    const bottom = [at('d', 1)];
    expect(addCursorVertical(bottom, rows, 'down')).toBe(bottom);
  });

  it('passes over a row that already has a cursor there', () => {
    const next = addCursorVertical([at('b', 2), at('c', 2)], rows, 'up');
    expect(plain(next)).toEqual([at('b', 2), at('c', 2), at('a', 2)]);
  });

  it('follows the rows it is given, so hidden ones are skipped', () => {
    const shown = rows.filter(d => d.id !== 'b');
    expect(plain(addCursorVertical([at('c', 1)], shown, 'up'))).toEqual([at('c', 1), at('a', 1)]);
  });
});

describe('toggleCursor', () => {
  it('adds a cursor, or removes the one already there', () => {
    const two = toggleCursor([at('a', 1)], 'c', 4);
    expect(two).toEqual([at('a', 1), at('c', 4)]);
    expect(toggleCursor(two, 'a', 1)).toEqual([at('c', 4)]);
  });

  it('does not remove the last cursor', () => {
    const one = [at('a', 1)];
    expect(toggleCursor(one, 'a', 1)).toBe(one);
  });
});

describe('moveCursors', () => {
  it('moves every cursor along its own row, clamped to it', () => {
    expect(moveCursors([at('a', 0), at('b', 3)], byId, 1)).toEqual([at('a', 1), at('b', 3)]);
    expect(moveCursors([at('a', 0), at('b', 3)], byId, -1)).toEqual([at('a', 0), at('b', 2)]);
  });

  it('goes to each row’s start or end', () => {
    expect(moveCursors([at('a', 4), at('b', 1)], byId, 'end')).toEqual([at('a', 8), at('b', 3)]);
    expect(moveCursors([at('a', 4), at('b', 1)], byId, 'home')).toEqual([at('a', 0), at('b', 0)]);
  });

  it('merges cursors in one row that meet', () => {
    expect(moveCursors([at('a', 1), at('a', 3)], byId, 'home')).toEqual([at('a', 0)]);
  });
});

describe('cursorsInRowOrder', () => {
  it('sorts top to bottom, then left to right', () => {
    const sorted = cursorsInRowOrder([at('c', 1), at('a', 5), at('a', 2)], rows);
    expect(sorted).toEqual([at('a', 2), at('a', 5), at('c', 1)]);
  });
});

describe('applyAtCursors', () => {
  const raw = (documents, id) => documents.find(d => d.id === id).raw;

  it('types at every cursor, and each moves past what it typed', () => {
    const result = applyAtCursors(rows, [at('a', 2), at('c', 4)], { type: 'insert', textFor: () => '-' });
    expect(raw(result.documents, 'a')).toBe('AC-GTACGT');
    expect(raw(result.documents, 'c')).toBe('ACGT-ACGT');
    expect(raw(result.documents, 'b')).toBe('ACG');
    expect(result.cursors).toEqual([at('a', 3), at('c', 5)]);
    expect(result.docIds).toEqual(['a', 'c']);
  });

  it('handles several cursors in one row, and names the row once per edit', () => {
    const result = applyAtCursors(rows, [at('a', 6), at('a', 2)], { type: 'insert', textFor: () => 'NN' });
    expect(raw(result.documents, 'a')).toBe('ACNNGTACNNGT');
    expect(result.cursors).toEqual([at('a', 10), at('a', 4)]);
    expect(result.docIds).toEqual(['a', 'a']);
  });

  it('can type different text at each cursor', () => {
    const texts = { a: 'G', c: 'TT' };
    const result = applyAtCursors(rows, [at('a', 0), at('c', 0)], { type: 'insert', textFor: c => texts[c.docId] });
    expect(raw(result.documents, 'a')).toBe('GACGTACGT');
    expect(raw(result.documents, 'c')).toBe('TTACGTACGT');
    expect(result.cursors).toEqual([at('a', 1), at('c', 2)]);
  });

  it('backspaces at every cursor, doing nothing at a row’s start', () => {
    const result = applyAtCursors(rows, [at('a', 0), at('a', 4), at('c', 8)], { type: 'backspace' });
    expect(raw(result.documents, 'a')).toBe('ACGACGT');
    expect(raw(result.documents, 'c')).toBe('ACGTACG');
    expect(result.cursors).toEqual([at('a', 0), at('a', 3), at('c', 7)]);
    expect(result.docIds).toEqual(['a', 'c']);
  });

  it('deletes forward at every cursor, doing nothing at a row’s end', () => {
    const result = applyAtCursors(rows, [at('a', 0), at('a', 2), at('b', 3)], { type: 'delete' });
    expect(raw(result.documents, 'a')).toBe('CTACGT');
    expect(raw(result.documents, 'b')).toBe('ACG');
    expect(result.cursors).toEqual([at('a', 0), at('a', 1), at('b', 3)]);
  });

  it('merges cursors that deleting brings together', () => {
    const result = applyAtCursors(rows, [at('a', 1), at('a', 2)], { type: 'backspace' });
    expect(raw(result.documents, 'a')).toBe('GTACGT');
    expect(result.cursors).toEqual([at('a', 0)]);
  });

  it('records edits a row’s own undo can take back one by one', () => {
    const result = applyAtCursors(rows, [at('a', 2), at('a', 6)], { type: 'insert', textFor: () => 'N' });
    const a = result.documents.find(d => d.id === 'a');
    expect(undo(undo(a)).raw).toBe('ACGTACGT');
  });
});
