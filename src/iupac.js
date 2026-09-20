// IUPAC nucleotide code definitions, colors, validation, and complement mapping.
// This is the foundation — everything else depends on it.

/**
 * IUPAC_MAP: code → { bases: string[], color: string }
 * Colors sourced from geneiousStyleRef.md
 */
export const IUPAC_MAP = {
  A: { bases: ['A'], color: '#27AE60' },
  T: { bases: ['T'], color: '#E74C3C' },
  G: { bases: ['G'], color: '#F1C40F' },
  C: { bases: ['C'], color: '#3498DB' },
  R: { bases: ['A', 'G'], color: '#1ABC9C' },
  Y: { bases: ['C', 'T'], color: '#9B59B6' },
  S: { bases: ['G', 'C'], color: '#2980B9' },
  W: { bases: ['A', 'T'], color: '#E67E22' },
  K: { bases: ['G', 'T'], color: '#8D9440' },
  M: { bases: ['A', 'C'], color: '#C0392B' },
  B: { bases: ['C', 'G', 'T'], color: '#7F8C8D' },
  D: { bases: ['A', 'G', 'T'], color: '#6C7A44' },
  H: { bases: ['A', 'C', 'T'], color: '#A06070' },
  V: { bases: ['A', 'C', 'G'], color: '#508080' },
  N: { bases: ['A', 'T', 'G', 'C'], color: '#575757' },
  // Uracil, so RNA transcripts survive a round-trip through the editor. It is not
  // one of the 15 DNA codes and has no complement entry: complementing RNA is not
  // a meaningful operation on a single strand read as sequence data.
  U: { bases: ['U'], color: '#E8735A' },
  // Alignment gap. No color: gap cells are drawn from the active theme, not the base palette.
  '-': { bases: [], isGap: true },
};

/** Canonical gap character. `.` is normalized to this on FASTA parse. */
export const GAP_CHAR = '-';

/**
 * Returns true if the character is an alignment gap.
 * @param {string} c - single character
 * @returns {boolean}
 */
export function isGap(c) {
  return c === '-' || c === '.';
}

/**
 * COMPLEMENT_MAP: each IUPAC code → its complement.
 * Ambiguity complements: swap the constituent bases and find the matching code.
 * A↔T, G↔C, R(A/G)↔Y(C/T), S(G/C)↔S, W(A/T)↔W, K(G/T)↔M(A/C),
 * B(C/G/T)↔V(A/C/G), D(A/G/T)↔H(A/C/T), N↔N
 */
export const COMPLEMENT_MAP = {
  A: 'T',
  T: 'A',
  G: 'C',
  C: 'G',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  N: 'N',
  '-': '-',
};

/**
 * Text color for each base. Most use white; G uses dark text
 * because its yellow background has poor contrast with white.
 */
export const TEXT_COLOR_MAP = {
  A: '#FFFFFF',
  T: '#FFFFFF',
  G: '#2C3E50',
  C: '#FFFFFF',
  R: '#FFFFFF',
  Y: '#FFFFFF',
  S: '#FFFFFF',
  W: '#FFFFFF',
  K: '#FFFFFF',
  M: '#FFFFFF',
  B: '#FFFFFF',
  D: '#FFFFFF',
  H: '#FFFFFF',
  V: '#FFFFFF',
  N: '#FFFFFF',
  U: '#FFFFFF',
};

/**
 * Returns the IUPAC/gap entry for a character, falling back to N for anything
 * unrecognized so the renderer never has to guard the lookup.
 * @param {string} c - single character
 * @returns {object}
 */
export function getCharInfo(c) {
  return IUPAC_MAP[c] ?? IUPAC_MAP.N;
}

/**
 * Returns true if the character (case-insensitive) is a valid IUPAC nucleotide code.
 * @param {string} c - single character
 * @returns {boolean}
 */
export function isValidChar(c) {
  if (!c || c.length !== 1) return false;
  return c.toUpperCase() in IUPAC_MAP;
}

/**
 * Returns the complement of a single IUPAC character (case-insensitive).
 * Returns the character uppercased-complemented, or null if invalid.
 * @param {string} c - single character
 * @returns {string|null}
 */
export function complement(c) {
  if (!c || c.length !== 1) return null;
  return COMPLEMENT_MAP[c.toUpperCase()] ?? null;
}
