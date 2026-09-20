import { describe, it, expect } from 'vitest';
import {
  conservationScore, conservationTrack, comparePair, percentIdentity, summarizeGroup,
  distanceMatrix, findVariants,
} from '../conservation.js';

describe('percentIdentity', () => {
  it('is the identity from comparePair, for callers that only want the number', () => {
    expect(percentIdentity('ACGT', 'ACGA')).toBe(75);
    expect(percentIdentity('ACGT', 'ACGT')).toBe(100);
  });
});

const doc = (name, raw) => ({ id: name, name, raw });

describe('conservationScore — percent identity', () => {
  const documents = [doc('a', 'AAAC'), doc('b', 'AACC'), doc('c', 'AGCC')];

  it('is 1 where every sequence agrees', () => {
    expect(conservationScore(documents, 0).score).toBe(1);
  });

  it('is the majority share where they disagree', () => {
    expect(conservationScore(documents, 1).score).toBeCloseTo(2 / 3);
  });

  it('reports coverage separately from agreement', () => {
    const gapped = [doc('a', 'A'), doc('b', '-'), doc('c', '-')];
    const result = conservationScore(gapped, 0);
    expect(result.score).toBe(1); // the one base present agrees with itself
    expect(result.coverage).toBeCloseTo(1 / 3);
  });

  it('scores an all-gap column as empty rather than conserved', () => {
    expect(conservationScore([doc('a', '-'), doc('b', '-')], 0))
      .toMatchObject({ score: 0, coverage: 0, total: 0 });
  });

  it('ignores sequences that end before the column', () => {
    const ragged = [doc('a', 'AC'), doc('b', 'A')];
    expect(conservationScore(ragged, 1)).toMatchObject({ score: 1, total: 1 });
  });
});

describe('conservationScore — Shannon entropy', () => {
  it('is 1 when a column has one base', () => {
    const documents = [doc('a', 'A'), doc('b', 'A'), doc('c', 'A')];
    expect(conservationScore(documents, 0, 'entropy').score).toBe(1);
  });

  it('falls to 0 when all four bases are equally likely', () => {
    const documents = [doc('a', 'A'), doc('b', 'C'), doc('c', 'G'), doc('d', 'T')];
    expect(conservationScore(documents, 0, 'entropy').score).toBeCloseTo(0);
  });

  it('sits in between for a two-way split', () => {
    const documents = [doc('a', 'A'), doc('b', 'C')];
    expect(conservationScore(documents, 0, 'entropy').score).toBeCloseTo(0.5);
  });
});

describe('conservationTrack', () => {
  it('returns one entry per column of the window', () => {
    const documents = [doc('a', 'ACGT'), doc('b', 'ACGA')];
    const track = conservationTrack(documents, 1, 4);
    expect(track).toHaveLength(3);
    expect(track[0].score).toBe(1);
    expect(track[2].score).toBe(0.5);
  });
});

describe('comparePair', () => {
  it('counts only the columns where both rows have a base', () => {
    expect(comparePair('ACGT', 'ACGA')).toEqual({
      identity: 75, differences: 1, compared: 4,
    });
  });

  it('skips columns gapped in either row', () => {
    expect(comparePair('A-GT', 'ACGT')).toMatchObject({ identity: 100, compared: 3 });
  });

  it('compares only as far as the shorter row', () => {
    expect(comparePair('AC', 'ACGT')).toMatchObject({ identity: 100, compared: 2 });
  });

  it('is 0 when there is nothing comparable', () => {
    expect(comparePair('---', 'ACG')).toMatchObject({ identity: 0, compared: 0 });
  });
});

describe('distanceMatrix', () => {
  const documents = [doc('a', 'ACGT'), doc('b', 'ACGA'), doc('c', 'ACGT')];

  it('is symmetric with a perfect diagonal', () => {
    const { identity } = distanceMatrix(documents);
    for (let i = 0; i < 3; i++) {
      expect(identity[i][i]).toBe(100);
      for (let j = 0; j < 3; j++) expect(identity[i][j]).toBeCloseTo(identity[j][i]);
    }
  });

  it('measures identity and substitutions between each pair', () => {
    const { identity, differences, names } = distanceMatrix(documents);
    expect(names).toEqual(['a', 'b', 'c']);
    expect(identity[0][1]).toBe(75);
    expect(differences[0][1]).toBe(1);
    expect(identity[0][2]).toBe(100);
  });
});

describe('findVariants', () => {
  const reference = doc('ref', 'ACGT');

  it('reports a substitution against the reference', () => {
    const variants = findVariants([reference, doc('s1', 'ACGA')], reference);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      position: 4, referenceBase: 'T', observed: 'A', type: 'SNP', name: 's1',
    });
  });

  it('calls a gap in the sequence a deletion and a gap in the reference an insertion', () => {
    const deletion = findVariants([reference, doc('s1', 'AC-T')], reference);
    expect(deletion[0]).toMatchObject({ position: 3, type: 'Deletion' });

    const gappedRef = doc('ref', 'AC-T');
    const insertion = findVariants([gappedRef, doc('s1', 'ACGT')], gappedRef);
    expect(insertion[0]).toMatchObject({ position: 3, type: 'Insertion' });
  });

  it('treats the tail of a longer sequence as an insertion', () => {
    const variants = findVariants([reference, doc('s1', 'ACGTAA')], reference);
    expect(variants.map(v => v.position)).toEqual([5, 6]);
    expect(variants.every(v => v.type === 'Insertion')).toBe(true);
  });

  it('says nothing about the reference itself, or about an identical sequence', () => {
    expect(findVariants([reference, doc('s1', 'ACGT')], reference)).toEqual([]);
  });

  it('returns nothing without a reference', () => {
    expect(findVariants([reference], null)).toEqual([]);
  });

  it('sorts by position so the report reads along the alignment', () => {
    const variants = findVariants(
      [reference, doc('s1', 'AAGT'), doc('s2', 'ACGA')],
      reference
    );
    expect(variants.map(v => v.position)).toEqual([2, 4]);
  });
});

describe('summarizeGroup', () => {
  it('reports the size of the group and its length range', () => {
    const summary = summarizeGroup([doc('a', 'ACGT'), doc('b', 'ACGTAC'), doc('c', 'AC')]);
    expect(summary).toMatchObject({
      count: 3, minLength: 2, maxLength: 6, equalLengths: false,
    });
  });

  it('notices when every sequence is the same length', () => {
    expect(summarizeGroup([doc('a', 'ACGT'), doc('b', 'TGCA')]).equalLengths).toBe(true);
  });

  it('measures GC over the pooled bases, not as a mean of percentages', () => {
    // A short all-GC sequence next to a long all-AT one: an unweighted mean of
    // 100% and 0% would say 50%, where the pooled figure is 2 of 10 bases.
    const summary = summarizeGroup([doc('a', 'GC'), doc('b', 'ATATATAT')]);
    expect(summary.gcPercent).toBe(20);
  });

  it('counts gaps across the whole group and leaves them out of GC', () => {
    const summary = summarizeGroup([doc('a', 'GC--'), doc('b', 'AT--')]);
    expect(summary.gaps).toBe(4);
    expect(summary.ungappedLength).toBe(4);
    expect(summary.gcPercent).toBe(50);
  });

  it('averages identity over every pair', () => {
    // a/b identical, a/c and b/c differ at one of four columns.
    const summary = summarizeGroup([doc('a', 'ACGT'), doc('b', 'ACGT'), doc('c', 'ACGA')]);
    expect(summary.meanIdentity).toBeCloseTo((100 + 75 + 75) / 3);
  });

  it('counts the columns the group agrees on, ignoring all-gap columns', () => {
    const summary = summarizeGroup([doc('a', 'ACGT-'), doc('b', 'ACGA-')]);
    expect(summary.comparedColumns).toBe(4);
    expect(summary.conservedColumns).toBe(3);
    expect(summary.conservedPercent).toBeCloseTo(75);
  });

  it('gives up on the pairwise figures rather than stalling on a huge group', () => {
    const documents = Array.from({ length: 12 }, (_, i) => doc(`s${i}`, 'ACGTACGTAC'));
    const summary = summarizeGroup(documents, { maxWork: 10 });
    expect(summary.meanIdentity).toBeNull();
    expect(summary.conservedColumns).toBeNull();
    expect(summary.conservedPercent).toBeNull();
    // The cheap figures are still there.
    expect(summary.count).toBe(12);
    expect(summary.gcPercent).toBeGreaterThan(0);
  });

  it('has no pairwise figures for a group of one', () => {
    const summary = summarizeGroup([doc('a', 'ACGT')]);
    expect(summary.count).toBe(1);
    expect(summary.meanIdentity).toBeNull();
  });

  it('returns null for an empty group', () => {
    expect(summarizeGroup([])).toBeNull();
  });
});
