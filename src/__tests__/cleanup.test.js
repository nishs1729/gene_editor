import { describe, it, expect } from 'vitest';
import {
  alignmentLength, columnCoverage, stripAllGapColumns, trimRaggedEnds, padToLength,
} from '../alignmentTools.js';

describe('alignmentLength', () => {
  it('is the longest row', () => {
    expect(alignmentLength(['ACGT', 'AC', 'ACGTAC'])).toBe(6);
    expect(alignmentLength([])).toBe(0);
  });
});

describe('columnCoverage', () => {
  it('is the share of rows with a base at each column', () => {
    expect(columnCoverage(['AC', 'A-', '--'])).toEqual([2 / 3, 1 / 3]);
  });

  it('counts a row that ends early as uncovered, not as missing', () => {
    expect(columnCoverage(['ACGT', 'AC'])).toEqual([1, 1, 0.5, 0.5]);
  });
});

describe('stripAllGapColumns', () => {
  it('removes the columns that are a gap in every row', () => {
    expect(stripAllGapColumns(['A-C-T', 'A-C-T', 'A-G-T'])).toEqual(['ACT', 'ACT', 'AGT']);
  });

  it('keeps a column where even one row has a base', () => {
    expect(stripAllGapColumns(['A-T', 'ACT', 'A-T'])).toEqual(['A-T', 'ACT', 'A-T']);
  });

  it('treats the tail of a short row as a gap', () => {
    expect(stripAllGapColumns(['AC', 'AC--'])).toEqual(['AC', 'AC']);
  });

  it('returns the rows unchanged when there is nothing to strip', () => {
    const rows = ['ACGT', 'ACGT'];
    expect(stripAllGapColumns(rows)).toBe(rows);
  });

  it('collapses an alignment that is nothing but gaps', () => {
    expect(stripAllGapColumns(['---', '---'])).toEqual(['', '']);
  });
});

describe('trimRaggedEnds', () => {
  it('trims both ends back to the coverage threshold', () => {
    // Only the middle three columns are covered by every row.
    const rows = ['--ACG--', 'AAACGTT', '--ACG--'];
    expect(trimRaggedEnds(rows, 1)).toEqual(['ACG', 'ACG', 'ACG']);
  });

  it('leaves a poorly covered column alone when it is in the middle', () => {
    const rows = ['AC-GT', 'AC-GT', 'ACCGT'];
    expect(trimRaggedEnds(rows, 1)).toEqual(rows);
  });

  it('accepts an end that meets the threshold without being complete', () => {
    const rows = ['-CGT', 'ACGT', 'ACGT'];
    expect(trimRaggedEnds(rows, 0.6)).toEqual(rows);
    expect(trimRaggedEnds(rows, 0.7)).toEqual(['CGT', 'CGT', 'CGT']);
  });

  it('returns the rows unchanged when both ends already qualify', () => {
    const rows = ['ACGT', 'ACGT'];
    expect(trimRaggedEnds(rows, 0.7)).toBe(rows);
  });

  it('trims to nothing rather than inverting when no column qualifies', () => {
    expect(trimRaggedEnds(['--', '--'], 0.5)).toEqual(['', '']);
  });
});

describe('padToLength', () => {
  it('pads short rows with trailing gaps', () => {
    expect(padToLength(['ACGT', 'AC', ''])).toEqual(['ACGT', 'AC--', '----']);
  });

  it('pads to an explicit length', () => {
    expect(padToLength(['AC'], 4)).toEqual(['AC--']);
  });

  it('truncates a row longer than the requested length', () => {
    expect(padToLength(['ACGTAC'], 4)).toEqual(['ACGT']);
  });

  it('returns the rows unchanged when they already line up', () => {
    const rows = ['ACGT', 'ACGT'];
    expect(padToLength(rows)).toBe(rows);
  });
});
