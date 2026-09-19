import { describe, it, expect } from 'vitest';
import {
  createDocument,
  substitute,
  insertAt,
  deleteRange,
  replaceRange,
  moveRange,
  reverseComplementDoc,
  undo,
  redo,
  reverseComplement,
  getStats,
} from '../sequenceModel.js';

describe('createDocument', () => {
  it('creates a document with uppercased sequence', () => {
    const doc = createDocument('test', 'atgc');
    expect(doc.name).toBe('test');
    expect(doc.raw).toBe('ATGC');
    expect(doc.length).toBe(4);
    expect(doc.history).toEqual([]);
    expect(doc.future).toEqual([]);
    expect(doc.selection).toBe(null);
  });

  it('creates empty document with defaults', () => {
    const doc = createDocument();
    expect(doc.name).toBe('');
    expect(doc.raw).toBe('');
    expect(doc.length).toBe(0);
  });
});

describe('substitute', () => {
  it('substitutes a character at a position', () => {
    const doc = createDocument('test', 'ATGC');
    const result = substitute(doc, 1, 'C');
    expect(result.raw).toBe('ACGC');
    expect(result.history.length).toBe(1);
    expect(result.history[0].type).toBe('substitute');
    expect(result.history[0].before).toBe('T');
    expect(result.history[0].after).toBe('C');
  });

  it('returns same doc for invalid character', () => {
    const doc = createDocument('test', 'ATGC');
    const result = substitute(doc, 1, 'X');
    expect(result).toBe(doc);
  });

  it('returns same doc for out-of-bounds position', () => {
    const doc = createDocument('test', 'ATGC');
    expect(substitute(doc, -1, 'A')).toBe(doc);
    expect(substitute(doc, 4, 'A')).toBe(doc);
  });

  it('returns same doc for no-op substitution', () => {
    const doc = createDocument('test', 'ATGC');
    const result = substitute(doc, 0, 'A');
    expect(result).toBe(doc);
  });

  it('clears future (redo stack) on new edit', () => {
    let doc = createDocument('test', 'ATGC');
    doc = substitute(doc, 0, 'G');
    doc = undo(doc);
    expect(doc.future.length).toBe(1);
    doc = substitute(doc, 1, 'A');
    expect(doc.future.length).toBe(0);
  });
});

describe('insertAt', () => {
  it('inserts a string at a position', () => {
    const doc = createDocument('test', 'ATGC');
    const result = insertAt(doc, 2, 'NNN');
    expect(result.raw).toBe('ATNNNGC');
    expect(result.length).toBe(7);
    expect(result.history[0].type).toBe('insert');
  });

  it('inserts at the beginning', () => {
    const doc = createDocument('test', 'ATGC');
    const result = insertAt(doc, 0, 'GG');
    expect(result.raw).toBe('GGATGC');
  });

  it('inserts at the end', () => {
    const doc = createDocument('test', 'ATGC');
    const result = insertAt(doc, 4, 'TT');
    expect(result.raw).toBe('ATGCTT');
  });

  it('filters out invalid characters', () => {
    const doc = createDocument('test', 'ATGC');
    const result = insertAt(doc, 2, 'A1X2G');
    expect(result.raw).toBe('ATAGGC');
  });

  it('returns same doc for all-invalid input', () => {
    const doc = createDocument('test', 'ATGC');
    const result = insertAt(doc, 2, '123');
    expect(result).toBe(doc);
  });
});

describe('deleteRange', () => {
  it('deletes a range of characters', () => {
    const doc = createDocument('test', 'ATGCNN');
    const result = deleteRange(doc, 2, 4);
    expect(result.raw).toBe('ATNN');
    expect(result.length).toBe(4);
    expect(result.history[0].type).toBe('delete');
    expect(result.history[0].before).toBe('GC');
  });

  it('returns same doc for invalid range', () => {
    const doc = createDocument('test', 'ATGC');
    expect(deleteRange(doc, -1, 2)).toBe(doc);
    expect(deleteRange(doc, 0, 5)).toBe(doc);
    expect(deleteRange(doc, 3, 2)).toBe(doc);
  });
});

describe('replaceRange', () => {
  it('replaces a range in one command', () => {
    const doc = createDocument('test', 'ATGCATGC');
    const result = replaceRange(doc, 2, 5, 'NN');
    expect(result.raw).toBe('ATNNTGC');
    expect(result.history.length).toBe(1);
    expect(result.history[0].type).toBe('replace');
    expect(result.history[0].before).toBe('GCA');
    expect(result.history[0].after).toBe('NN');
  });

  it('undoes a replacement in a single step', () => {
    let doc = createDocument('test', 'ATGCATGC');
    doc = replaceRange(doc, 2, 5, 'NN');
    doc = undo(doc);
    expect(doc.raw).toBe('ATGCATGC');
    expect(doc.history.length).toBe(0);
  });

  it('redoes a replacement', () => {
    let doc = createDocument('test', 'ATGCATGC');
    doc = replaceRange(doc, 2, 5, 'NN');
    doc = undo(doc);
    doc = redo(doc);
    expect(doc.raw).toBe('ATNNTGC');
  });

  it('supports insertion (empty range) and deletion (empty text)', () => {
    const doc = createDocument('test', 'ATGC');
    expect(replaceRange(doc, 2, 2, 'NN').raw).toBe('ATNNGC');
    expect(replaceRange(doc, 1, 3, '').raw).toBe('AC');
  });

  it('accepts gap characters', () => {
    const doc = createDocument('test', 'ATGC');
    expect(replaceRange(doc, 1, 3, '--').raw).toBe('A--C');
  });

  it('filters invalid characters and no-ops when nothing changes', () => {
    const doc = createDocument('test', 'ATGC');
    expect(replaceRange(doc, 1, 3, 'X1Z').raw).toBe('AC');
    expect(replaceRange(doc, 1, 2, 'T')).toBe(doc);
  });
});

describe('moveRange', () => {
  it('moves a range to the right', () => {
    const doc = createDocument('test', 'ATGCATGC');
    const result = moveRange(doc, 0, 2, 6); // move 'AT' to sit before index 6
    expect(result.raw).toBe('GCATATGC');
  });

  it('moves a range to the left', () => {
    const doc = createDocument('test', 'ATGCNN');
    const result = moveRange(doc, 4, 6, 0);
    expect(result.raw).toBe('NNATGC');
  });

  it('preserves length and records one undoable command', () => {
    const doc = createDocument('test', 'ATGCNN');
    const result = moveRange(doc, 4, 6, 0);
    expect(result.length).toBe(doc.length);
    expect(result.history.length).toBe(1);
    expect(undo(result).raw).toBe('ATGCNN');
  });

  it('no-ops when dropped inside itself or out of bounds', () => {
    const doc = createDocument('test', 'ATGCNN');
    expect(moveRange(doc, 1, 4, 2)).toBe(doc);
    expect(moveRange(doc, 1, 4, 99)).toBe(doc);
    expect(moveRange(doc, 3, 3, 0)).toBe(doc);
  });
});

describe('reverseComplementDoc', () => {
  it('reverse complements in place as one undoable command', () => {
    let doc = createDocument('test', 'ATGC');
    doc = reverseComplementDoc(doc);
    expect(doc.raw).toBe('GCAT');
    expect(doc.name).toBe('test'); // name preserved
    expect(doc.history.length).toBe(1);
    doc = undo(doc);
    expect(doc.raw).toBe('ATGC');
  });

  it('preserves prior history', () => {
    let doc = createDocument('test', 'ATGC');
    doc = substitute(doc, 0, 'G');
    doc = reverseComplementDoc(doc);
    expect(doc.history.length).toBe(2);
  });

  it('no-ops on an empty document', () => {
    const doc = createDocument('test', '');
    expect(reverseComplementDoc(doc)).toBe(doc);
  });
});

describe('dirty flag', () => {
  it('starts clean and is set by edits', () => {
    const doc = createDocument('test', 'ATGC');
    expect(doc.dirty).toBe(false);
    expect(substitute(doc, 0, 'G').dirty).toBe(true);
    expect(insertAt(doc, 0, 'G').dirty).toBe(true);
    expect(deleteRange(doc, 0, 1).dirty).toBe(true);
  });
});

describe('undo / redo', () => {
  it('undoes a substitution', () => {
    let doc = createDocument('test', 'ATGC');
    doc = substitute(doc, 0, 'G');
    expect(doc.raw).toBe('GTGC');
    doc = undo(doc);
    expect(doc.raw).toBe('ATGC');
    expect(doc.history.length).toBe(0);
    expect(doc.future.length).toBe(1);
  });

  it('redoes an undone substitution', () => {
    let doc = createDocument('test', 'ATGC');
    doc = substitute(doc, 0, 'G');
    doc = undo(doc);
    doc = redo(doc);
    expect(doc.raw).toBe('GTGC');
    expect(doc.history.length).toBe(1);
    expect(doc.future.length).toBe(0);
  });

  it('undoes an insertion', () => {
    let doc = createDocument('test', 'ATGC');
    doc = insertAt(doc, 2, 'NNN');
    expect(doc.raw).toBe('ATNNNGC');
    doc = undo(doc);
    expect(doc.raw).toBe('ATGC');
  });

  it('undoes a deletion', () => {
    let doc = createDocument('test', 'ATGC');
    doc = deleteRange(doc, 1, 3);
    expect(doc.raw).toBe('AC');
    doc = undo(doc);
    expect(doc.raw).toBe('ATGC');
  });

  it('handles multi-step undo chain', () => {
    let doc = createDocument('test', 'ATGC');
    doc = substitute(doc, 0, 'G');
    doc = substitute(doc, 1, 'G');
    doc = substitute(doc, 2, 'A');
    expect(doc.raw).toBe('GGAC');

    doc = undo(doc);
    expect(doc.raw).toBe('GGGC');
    doc = undo(doc);
    expect(doc.raw).toBe('GTGC');
    doc = undo(doc);
    expect(doc.raw).toBe('ATGC');
    expect(doc.history.length).toBe(0);
    expect(doc.future.length).toBe(3);
  });

  it('undo on empty history returns same doc', () => {
    const doc = createDocument('test', 'ATGC');
    const result = undo(doc);
    expect(result).toBe(doc);
  });

  it('redo on empty future returns same doc', () => {
    const doc = createDocument('test', 'ATGC');
    const result = redo(doc);
    expect(result).toBe(doc);
  });
});

describe('reverseComplement', () => {
  it('reverse complements canonical bases', () => {
    expect(reverseComplement('ATGC')).toBe('GCAT');
  });

  it('reverse complements ambiguity codes', () => {
    expect(reverseComplement('RYSWKM')).toBe('KMWSRY');
  });

  it('handles N', () => {
    expect(reverseComplement('NNN')).toBe('NNN');
  });

  it('handles empty string', () => {
    expect(reverseComplement('')).toBe('');
  });

  it('handles single base', () => {
    expect(reverseComplement('A')).toBe('T');
  });
});

describe('getStats', () => {
  it('counts bases correctly', () => {
    const stats = getStats('AATTGGCC');
    expect(stats.length).toBe(8);
    expect(stats.counts.A).toBe(2);
    expect(stats.counts.T).toBe(2);
    expect(stats.counts.G).toBe(2);
    expect(stats.counts.C).toBe(2);
  });

  it('calculates GC% correctly', () => {
    const stats = getStats('AATTGGCC');
    expect(stats.gcPercent).toBe(50);
  });

  it('handles sequence with ambiguity codes', () => {
    const stats = getStats('ATGCN');
    expect(stats.length).toBe(5);
    expect(stats.counts.N).toBe(1);
    expect(stats.gcPercent).toBe(40); // G+C = 2 out of 5
  });

  it('handles empty sequence', () => {
    const stats = getStats('');
    expect(stats.length).toBe(0);
    expect(stats.gcPercent).toBe(0);
  });

  it('counts gaps and excludes them from GC%', () => {
    const stats = getStats('GC--AT');
    expect(stats.length).toBe(6);
    expect(stats.gaps).toBe(2);
    expect(stats.ungappedLength).toBe(4);
    expect(stats.gcPercent).toBe(50); // 2 of 4 ungapped bases, not 2 of 6
  });

  it('reports 0% GC for an all-gap row rather than dividing by zero', () => {
    const stats = getStats('----');
    expect(stats.gcPercent).toBe(0);
    expect(stats.ungappedLength).toBe(0);
  });
});

describe('reverseComplement with gaps', () => {
  it('reverses gaps along with bases', () => {
    expect(reverseComplement('AT--GC')).toBe('GC--AT');
  });
});
