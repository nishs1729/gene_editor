// Alignment analytics: per-column conservation and pairwise sequence distance.
// Pure functions over document lists, so they can be tested and memoized freely.

import { GAP_CHAR } from './iupac.js';
import { getStats } from './sequenceModel.js';

export const CONSERVATION_METRICS = [
  { id: 'identity', label: 'Percent identity' },
  { id: 'entropy', label: 'Shannon entropy' },
];

const LOG2_4 = 2; // log2 of the four-letter alphabet — full entropy for DNA

/**
 * How conserved one alignment column is.
 * `identity` is the share of the column's non-gap calls that agree with its
 * most common base. `entropy` is Shannon entropy over the same calls, inverted
 * and normalised so that 1 is "every sequence agrees" in both metrics.
 * Coverage is reported separately: a column where one sequence out of fifty has
 * a base is perfectly "conserved" and almost entirely empty.
 *
 * @param {Array<{raw: string}>} documents
 * @param {number} col
 * @param {'identity'|'entropy'} [metric]
 * @returns {{score: number, coverage: number, counts: object, total: number}}
 */
export function conservationScore(documents, col, metric = 'identity') {
  const counts = {};
  let nonGap = 0;

  for (const doc of documents) {
    const c = doc.raw[col];
    if (c === undefined || c === GAP_CHAR) continue;
    counts[c] = (counts[c] || 0) + 1;
    nonGap++;
  }

  const coverage = documents.length > 0 ? nonGap / documents.length : 0;
  if (nonGap === 0) return { score: 0, coverage: 0, counts, total: 0 };

  if (metric === 'entropy') {
    let h = 0;
    for (const n of Object.values(counts)) {
      const p = n / nonGap;
      h -= p * Math.log2(p);
    }
    return { score: Math.max(0, 1 - h / LOG2_4), coverage, counts, total: nonGap };
  }

  let best = 0;
  for (const n of Object.values(counts)) {
    if (n > best) best = n;
  }
  return { score: best / nonGap, coverage, counts, total: nonGap };
}

/**
 * Conservation for every column in [from, to).
 * @returns {Array<{score: number, coverage: number}>}
 */
export function conservationTrack(documents, from, to, metric = 'identity') {
  const out = [];
  for (let col = from; col < to; col++) {
    const { score, coverage } = conservationScore(documents, col, metric);
    out.push({ score, coverage });
  }
  return out;
}

/**
 * Identity between two aligned rows, over the positions where both have a base.
 * Positions that are a gap in either row carry no evidence either way, so they
 * are left out of both the numerator and the denominator.
 * @returns {{identity: number, differences: number, compared: number}}
 */
export function comparePair(a, b) {
  const len = Math.min(a.length, b.length);
  let compared = 0;
  let matches = 0;
  for (let i = 0; i < len; i++) {
    const ca = a[i];
    const cb = b[i];
    if (ca === GAP_CHAR || cb === GAP_CHAR) continue;
    compared++;
    if (ca === cb) matches++;
  }
  return {
    identity: compared === 0 ? 0 : (matches / compared) * 100,
    differences: compared - matches,
    compared,
  };
}

/** Percent identity between two aligned rows, 0–100. */
export function percentIdentity(a, b) {
  return comparePair(a, b).identity;
}

/**
 * Symmetric N×N identity and substitution-count matrices.
 * @param {Array<{name: string, raw: string}>} documents
 * @returns {{names: string[], identity: number[][], differences: number[][]}}
 */
export function distanceMatrix(documents) {
  const n = documents.length;
  const identity = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  const differences = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));

  for (let i = 0; i < n; i++) {
    identity[i][i] = 100;
    for (let j = i + 1; j < n; j++) {
      const pair = comparePair(documents[i].raw, documents[j].raw);
      identity[i][j] = identity[j][i] = pair.identity;
      differences[i][j] = differences[j][i] = pair.differences;
    }
  }

  return { names: documents.map(d => d.name || 'Unnamed'), identity, differences };
}

// Comparing every pair of sequences is quadratic in their number and linear in
// their length, and the summary it feeds is recomputed whenever the selection or
// the sequences change. Past this much work the pairwise figures are reported as
// unavailable rather than stalling the panel.
const MAX_PAIRWISE_WORK = 20e6;

/**
 * Summarise a group of sequences — what the stats panel shows when more than one
 * row is selected, where per-base counts for a single sequence stop being the
 * interesting thing and the shape of the group starts.
 *
 * `meanIdentity` and `conservedColumns` are null when the group is too large to
 * compare within the work budget; everything else is always computed.
 *
 * @param {Array<{raw: string}>} documents
 * @param {{conservedThreshold?: number, maxWork?: number}} [options]
 * @returns {object|null} null for an empty group
 */
export function summarizeGroup(documents, options = {}) {
  const { conservedThreshold = 0.9, maxWork = MAX_PAIRWISE_WORK } = options;
  const count = documents.length;
  if (count === 0) return null;

  let minLength = Infinity;
  let maxLength = 0;
  let gaps = 0;
  let ungappedLength = 0;
  let gc = 0;

  for (const doc of documents) {
    const stats = getStats(doc.raw);
    minLength = Math.min(minLength, stats.length);
    maxLength = Math.max(maxLength, stats.length);
    gaps += stats.gaps;
    ungappedLength += stats.ungappedLength;
    gc += (stats.counts.G || 0) + (stats.counts.C || 0);
  }

  // GC over the pooled bases rather than a mean of each sequence's percentage:
  // an unweighted mean would let a 20 bp fragment pull as hard as a 20 kb one.
  const gcPercent = ungappedLength > 0
    ? Math.round((gc / ungappedLength) * 1000) / 10
    : 0;

  const pairs = (count * (count - 1)) / 2;
  let meanIdentity = null;
  if (count >= 2 && pairs * maxLength <= maxWork) {
    let sum = 0;
    let compared = 0;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const pair = comparePair(documents[i].raw, documents[j].raw);
        if (pair.compared === 0) continue; // no overlap: no evidence either way
        sum += pair.identity;
        compared++;
      }
    }
    meanIdentity = compared > 0 ? sum / compared : null;
  }

  let conservedColumns = null;
  let comparedColumns = 0;
  if (count >= 2 && maxLength * count <= maxWork) {
    conservedColumns = 0;
    for (let col = 0; col < maxLength; col++) {
      const { score, coverage } = conservationScore(documents, col);
      if (coverage === 0) continue; // an all-gap column is not evidence of agreement
      comparedColumns++;
      if (score >= conservedThreshold) conservedColumns++;
    }
  }

  return {
    count,
    minLength,
    maxLength,
    equalLengths: minLength === maxLength,
    gcPercent,
    gaps,
    ungappedLength,
    meanIdentity,
    conservedColumns,
    comparedColumns,
    conservedPercent: conservedColumns !== null && comparedColumns > 0
      ? (conservedColumns / comparedColumns) * 100
      : null,
  };
}

/**
 * Variants of every sequence against a reference, by alignment column.
 * A gap in the reference where a sequence has a base is an insertion; a base in
 * the reference where a sequence has a gap is a deletion; anything else that
 * differs is a substitution.
 * @param {Array<{id: string, name: string, raw: string}>} documents
 * @param {object} reference - the document to compare against
 * @returns {Array<{position: number, referenceBase: string, name: string, observed: string, type: string, conservation: number}>}
 */
export function findVariants(documents, reference) {
  if (!reference) return [];
  const others = documents.filter(d => d.id !== reference.id);
  const out = [];

  for (const doc of others) {
    const len = Math.max(doc.raw.length, reference.raw.length);
    for (let col = 0; col < len; col++) {
      const ref = reference.raw[col] ?? GAP_CHAR;
      const obs = doc.raw[col] ?? GAP_CHAR;
      if (ref === obs) continue;

      const type = ref === GAP_CHAR ? 'Insertion' : obs === GAP_CHAR ? 'Deletion' : 'SNP';
      out.push({
        position: col + 1,
        referenceBase: ref,
        name: doc.name || 'Unnamed',
        observed: obs,
        type,
        conservation: Math.round(conservationScore(documents, col).score * 1000) / 10,
      });
    }
  }

  return out.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}
