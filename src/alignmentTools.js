// Whole-alignment cleanup: the column surgery that makes a raw alignment
// readable. Every function takes and returns plain rows (arrays of strings), so
// the store can apply a whole operation as one undo entry and the logic stays
// testable without a document model.

import { GAP_CHAR } from './iupac.js';

/** A row shorter than the alignment is missing data, which reads as a gap. */
function charAt(row, col) {
  return row[col] ?? GAP_CHAR;
}

/** The length of the longest row — the alignment's column count. */
export function alignmentLength(rows) {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

/**
 * Share of rows with a base (not a gap, not past their end) at each column.
 * @returns {number[]} one value in 0–1 per column
 */
export function columnCoverage(rows) {
  const length = alignmentLength(rows);
  const out = Array.from({ length }, () => 0);
  for (let col = 0; col < length; col++) {
    let covered = 0;
    for (const row of rows) {
      if (charAt(row, col) !== GAP_CHAR) covered++;
    }
    out[col] = rows.length === 0 ? 0 : covered / rows.length;
  }
  return out;
}

/**
 * Drop every column that is a gap in all rows.
 * These are the columns an aligner leaves behind after sequences are removed,
 * and they carry no information at all.
 * @param {string[]} rows
 * @returns {string[]}
 */
export function stripAllGapColumns(rows) {
  const coverage = columnCoverage(rows);
  const keep = [];
  for (let col = 0; col < coverage.length; col++) {
    if (coverage[col] > 0) keep.push(col);
  }
  if (keep.length === coverage.length) return rows;
  return rows.map(row => keep.map(col => charAt(row, col)).join(''));
}

/**
 * Trim the 5' and 3' ends back to where the alignment is properly covered.
 * Only the ends are trimmed: a poorly covered column in the middle is a real
 * feature of the alignment, while one at the end is usually just read overhang.
 * @param {string[]} rows
 * @param {number} minCoverage - 0–1, the share of rows that must have a base
 * @returns {string[]}
 */
export function trimRaggedEnds(rows, minCoverage = 0.7) {
  const coverage = columnCoverage(rows);
  let start = 0;
  let end = coverage.length;
  while (start < end && coverage[start] < minCoverage) start++;
  while (end > start && coverage[end - 1] < minCoverage) end--;
  if (start === 0 && end === coverage.length) return rows;
  return rows.map(row => row.slice(start, end));
}

/**
 * Pad every row with trailing gaps so they all reach the same length.
 * @param {string[]} rows
 * @param {number} [length] - defaults to the longest row
 * @returns {string[]}
 */
export function padToLength(rows, length = alignmentLength(rows)) {
  if (rows.every(row => row.length === length)) return rows;
  return rows.map(row => (
    row.length >= length ? row.slice(0, length) : row + GAP_CHAR.repeat(length - row.length)
  ));
}
