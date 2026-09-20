// Motif search over sequence data: literal, IUPAC-degenerate, fuzzy and regex,
// optionally on the reverse-complement strand too.
//
// Matching runs over the raw row exactly as stored, gaps included, so a match's
// [start, end) is a span the editor can replace without re-deriving coordinates.
// A gap therefore breaks a motif — strip all-gap columns first when searching an
// alignment for something the gaps interrupt.

import { IUPAC_MAP, GAP_CHAR, complement } from './iupac.js';

export const SEARCH_MODES = [
  { id: 'iupac', label: 'IUPAC' },
  { id: 'literal', label: 'Exact' },
  { id: 'regex', label: 'Regex' },
];

export const MAX_MISMATCHES = 3;

/** RNA and DNA spellings of the same base are the same base for searching. */
function normalize(code) {
  return code === 'U' ? 'T' : code;
}

/**
 * Does target code `t` satisfy query code `q` under IUPAC degeneracy?
 * Both sides expand, so `R` finds `A` and `A` is found by `R`; gaps and unknown
 * characters only ever match themselves.
 */
export function iupacMatches(t, q) {
  const tc = normalize(t);
  const qc = normalize(q);
  if (tc === qc) return true;
  const tb = IUPAC_MAP[tc]?.bases;
  const qb = IUPAC_MAP[qc]?.bases;
  if (!tb?.length || !qb?.length) return false;
  return qb.some(b => tb.includes(b));
}

function charMatches(t, q, mode) {
  if (t === undefined) return false;
  return mode === 'literal' ? t === q : iupacMatches(t, q);
}

/** Reverse complement of a query string, leaving unknown characters alone. */
export function reverseComplementQuery(query) {
  return [...query.toUpperCase()].reverse().map(c => complement(c) ?? c).join('');
}

/**
 * Validate a query for a mode.
 * @returns {string|null} an error message, or null when the query is usable
 */
export function validateQuery(query, mode = 'iupac') {
  if (!query) return null;
  if (mode === 'regex') {
    try {
      new RegExp(query, 'gi');
      return null;
    } catch (err) {
      return `Invalid regular expression: ${err.message}`;
    }
  }
  const bad = [...query.toUpperCase()].filter(c => !(c in IUPAC_MAP) && c !== GAP_CHAR);
  return bad.length > 0 ? `Not a nucleotide code: ${[...new Set(bad)].join(', ')}` : null;
}

/**
 * All matches of `query` in one sequence.
 * @param {string} seq
 * @param {string} query
 * @param {{mode?: string, mismatches?: number}} [options]
 * @returns {Array<{start: number, end: number}>}
 */
export function findInSequence(seq, query, options = {}) {
  const { mode = 'iupac', mismatches = 0 } = options;
  if (!seq || !query) return [];

  if (mode === 'regex') {
    let re;
    try {
      re = new RegExp(query, 'gi');
    } catch {
      return [];
    }
    const out = [];
    let m;
    while ((m = re.exec(seq)) !== null) {
      // A pattern that can match nothing would otherwise spin on one index.
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  const q = query.toUpperCase();
  const allowed = Math.max(0, mismatches);
  const out = [];
  const last = seq.length - q.length;
  for (let i = 0; i <= last; i++) {
    let missed = 0;
    let ok = true;
    for (let k = 0; k < q.length; k++) {
      if (!charMatches(seq[i + k], q[k], mode)) {
        if (++missed > allowed) { ok = false; break; }
      }
    }
    if (ok) out.push({ start: i, end: i + q.length });
  }
  return out;
}

/**
 * All matches across a set of documents, in document then position order.
 * @param {Array<{id: string, raw: string}>} documents - the documents to search
 * @param {string} query
 * @param {object} [options] - mode, mismatches, reverseComplement
 * @returns {Array<{docId: string, start: number, end: number, strand: 1|-1}>}
 */
export function findMatches(documents, query, options = {}) {
  const { mode = 'iupac', mismatches = 0, reverseComplement = false } = options;
  if (!query) return [];

  const out = [];
  for (const doc of documents) {
    const found = findInSequence(doc.raw, query, { mode, mismatches })
      .map(m => ({ ...m, strand: 1 }));

    // A regex describes a pattern in one orientation; reversing its text would
    // not describe the same pattern on the other strand, so the option is skipped.
    if (reverseComplement && mode !== 'regex') {
      const rc = reverseComplementQuery(query);
      if (rc !== query.toUpperCase()) {
        for (const m of findInSequence(doc.raw, rc, { mode, mismatches })) {
          found.push({ ...m, strand: -1 });
        }
      }
    }

    found.sort((a, b) => a.start - b.start || a.end - b.end);
    for (const m of found) out.push({ docId: doc.id, ...m });
  }
  return out;
}

/**
 * Apply replacements to one sequence.
 * Matches are applied back to front so earlier spans keep their indices, and an
 * overlapping match is skipped rather than corrupting the one already applied.
 * A reverse-strand hit takes the reverse complement of the replacement, so what
 * lands on the row reads correctly in the row's own orientation.
 * @param {string} seq
 * @param {Array<{start: number, end: number, strand?: number}>} matches
 * @param {string} replacement
 * @returns {string}
 */
export function applyReplacements(seq, matches, replacement) {
  const ordered = [...matches].sort((a, b) => b.start - a.start);
  let out = seq;
  let lastStart = Infinity;
  for (const m of ordered) {
    if (m.end > lastStart) continue; // overlaps a replacement already made
    const text = m.strand === -1 ? reverseComplementQuery(replacement) : replacement.toUpperCase();
    out = out.slice(0, m.start) + text + out.slice(m.end);
    lastStart = m.start;
  }
  return out;
}
