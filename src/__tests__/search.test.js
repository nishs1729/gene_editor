import { describe, it, expect } from 'vitest';
import {
  findInSequence, findMatches, iupacMatches, validateQuery,
  reverseComplementQuery, applyReplacements,
} from '../search.js';

const doc = (id, raw) => ({ id, name: id, raw });

describe('iupacMatches', () => {
  it('matches a degenerate query against the bases it stands for', () => {
    expect(iupacMatches('A', 'R')).toBe(true); // R = A/G
    expect(iupacMatches('G', 'R')).toBe(true);
    expect(iupacMatches('C', 'R')).toBe(false);
    expect(iupacMatches('T', 'Y')).toBe(true); // Y = C/T
  });

  it('matches in the other direction too, so a plain query finds degenerate data', () => {
    expect(iupacMatches('R', 'A')).toBe(true);
    expect(iupacMatches('N', 'A')).toBe(true);
  });

  it('treats N as any base', () => {
    for (const base of 'ACGT') {
      expect(iupacMatches(base, 'N')).toBe(true);
    }
  });

  it('reads U and T as the same base', () => {
    expect(iupacMatches('U', 'T')).toBe(true);
    expect(iupacMatches('T', 'U')).toBe(true);
  });

  it('only ever matches a gap with a gap', () => {
    expect(iupacMatches('-', '-')).toBe(true);
    expect(iupacMatches('-', 'N')).toBe(false);
    expect(iupacMatches('A', '-')).toBe(false);
  });
});

describe('findInSequence', () => {
  it('finds every literal occurrence, overlapping ones included', () => {
    expect(findInSequence('AAAA', 'AA', { mode: 'literal' })).toEqual([
      { start: 0, end: 2 }, { start: 1, end: 3 }, { start: 2, end: 4 },
    ]);
  });

  it('expands degenerate codes in IUPAC mode', () => {
    // R is A or G, so only the AG at the end qualifies.
    expect(findInSequence('ACGTAG', 'RG', { mode: 'iupac' })).toEqual([{ start: 4, end: 6 }]);
  });

  it('matches R as A or G but not C', () => {
    expect(findInSequence('CGAG', 'RG', { mode: 'iupac' })).toEqual([{ start: 2, end: 4 }]);
  });

  it('is exact in literal mode, where R is just the letter R', () => {
    expect(findInSequence('AGAG', 'RG', { mode: 'literal' })).toEqual([]);
    expect(findInSequence('RGAG', 'RG', { mode: 'literal' })).toEqual([{ start: 0, end: 2 }]);
  });

  it('allows the requested number of mismatches', () => {
    expect(findInSequence('ACGT', 'ACCT', { mode: 'literal', mismatches: 0 })).toEqual([]);
    expect(findInSequence('ACGT', 'ACCT', { mode: 'literal', mismatches: 1 }))
      .toEqual([{ start: 0, end: 4 }]);
  });

  it('will not match past the end of the sequence', () => {
    expect(findInSequence('ACG', 'ACGT', { mode: 'literal', mismatches: 3 })).toEqual([]);
  });

  it('treats gaps as ordinary characters, so a gap breaks a motif', () => {
    expect(findInSequence('AC-GT', 'ACGT', { mode: 'iupac' })).toEqual([]);
  });

  it('runs a regular expression when asked to', () => {
    expect(findInSequence('ATGAAATAG', 'ATG.*?TAG', { mode: 'regex' }))
      .toEqual([{ start: 0, end: 9 }]);
  });

  it('does not spin on a pattern that can match nothing', () => {
    expect(findInSequence('ACGT', 'X*', { mode: 'regex' })).toEqual([]);
  });

  it('returns nothing for an empty query or sequence', () => {
    expect(findInSequence('', 'AC')).toEqual([]);
    expect(findInSequence('ACGT', '')).toEqual([]);
  });
});

describe('reverseComplementQuery', () => {
  it('reverses and complements, degenerate codes included', () => {
    expect(reverseComplementQuery('ACGT')).toBe('ACGT');
    expect(reverseComplementQuery('AAGG')).toBe('CCTT');
    expect(reverseComplementQuery('RY')).toBe('RY'); // R->Y reversed with Y->R
  });
});

describe('findMatches', () => {
  const documents = [doc('one', 'ACGTACGT'), doc('two', 'TTTTACGT')];

  it('searches every document given to it, in order', () => {
    const matches = findMatches(documents, 'ACGT', { mode: 'literal' });
    expect(matches).toEqual([
      { docId: 'one', start: 0, end: 4, strand: 1 },
      { docId: 'one', start: 4, end: 8, strand: 1 },
      { docId: 'two', start: 4, end: 8, strand: 1 },
    ]);
  });

  it('marks reverse-strand hits so a replacement can be written back correctly', () => {
    const matches = findMatches([doc('one', 'GGGCCC')], 'GGG', {
      mode: 'literal', reverseComplement: true,
    });
    expect(matches).toEqual([
      { docId: 'one', start: 0, end: 3, strand: 1 },
      { docId: 'one', start: 3, end: 6, strand: -1 },
    ]);
  });

  it('leaves the reverse strand alone for a regex, which does not reverse', () => {
    const matches = findMatches([doc('one', 'GGGCCC')], 'GGG', {
      mode: 'regex', reverseComplement: true,
    });
    expect(matches).toHaveLength(1);
  });

  it('returns nothing without a query', () => {
    expect(findMatches(documents, '')).toEqual([]);
  });
});

describe('validateQuery', () => {
  it('accepts nucleotide codes and gaps', () => {
    expect(validateQuery('ACGTRYN-', 'iupac')).toBeNull();
  });

  it('rejects letters that are not codes', () => {
    expect(validateQuery('ACZ', 'iupac')).toMatch(/Z/);
  });

  it('reports a broken regular expression', () => {
    expect(validateQuery('ATG(', 'regex')).toMatch(/Invalid regular expression/);
    expect(validateQuery('ATG.*', 'regex')).toBeNull();
  });

  it('has nothing to say about an empty query', () => {
    expect(validateQuery('', 'iupac')).toBeNull();
  });
});

describe('applyReplacements', () => {
  it('replaces back to front, so the earlier spans keep their indices', () => {
    const matches = [{ start: 0, end: 4 }, { start: 4, end: 8 }];
    expect(applyReplacements('ACGTACGT', matches, 'TT')).toBe('TTTT');
  });

  it('skips a match that overlaps one already replaced', () => {
    // Replacement runs back to front, so the later span wins and the one that
    // would have overwritten part of it is left alone.
    const matches = [{ start: 0, end: 3 }, { start: 2, end: 5 }];
    expect(applyReplacements('AAAAA', matches, 'G')).toBe('AAG');
  });

  it('writes a reverse-strand hit in the row\'s own orientation', () => {
    expect(applyReplacements('GGGCCC', [{ start: 3, end: 6, strand: -1 }], 'AAG'))
      .toBe('GGGCTT');
  });

  it('leaves the sequence alone when there is nothing to replace', () => {
    expect(applyReplacements('ACGT', [], 'X')).toBe('ACGT');
  });
});
