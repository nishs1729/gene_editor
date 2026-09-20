// Nucleotide colour palettes.
// iupac.js owns what a code *means*; this owns what it *looks like*, so the whole
// colour scheme can be swapped at runtime without touching the code definitions.
// Palettes are independent of the light/dark UI theme in theme.js: the theme
// styles the chrome around the bases, a palette styles the bases themselves.

import { IUPAC_MAP, TEXT_COLOR_MAP } from './iupac.js';

/** Codes that get a coloured cell. Gaps are drawn from the theme, not a palette. */
export const COLORED_CODES = Object.keys(IUPAC_MAP).filter(c => !IUPAC_MAP[c].isGap);

const CLASSIC_FILL = Object.fromEntries(COLORED_CODES.map(c => [c, IUPAC_MAP[c].color]));

/** Perceived brightness, 0–1, used to pick readable letter colour over a fill. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Letter colour that stays legible on `fill`. */
function contrastText(fill) {
  return luminance(fill) > 0.6 ? '#14171C' : '#FFFFFF';
}

/**
 * @param {string} id
 * @param {string} label
 * @param {object} fills - per-code overrides; unlisted codes keep the classic colour
 * @param {{text?: object, canvasBg?: string}} [options]
 */
function build(id, label, fills, options = {}) {
  const fill = { ...CLASSIC_FILL, ...fills };
  const text = {};
  for (const code of Object.keys(fill)) {
    text[code] = options.text?.[code] ?? contrastText(fill[code]);
  }
  return { id, label, fill, text, canvasBg: options.canvasBg ?? null };
}

export const PALETTES = {
  // The colours the editor has always drawn with — kept exactly, so switching
  // away and back is lossless.
  classic: build('classic', 'Geneious Classic', {}, { text: TEXT_COLOR_MAP }),

  // Okabe-Ito, the standard qualitative set that stays distinguishable under all
  // three common forms of colour blindness.
  colorblind: build('colorblind', 'Colorblind-Safe', {
    A: '#E69F00', C: '#56B4E9', G: '#F0E442', T: '#009E73', U: '#00856B',
    R: '#0072B2', Y: '#CC79A7', S: '#D55E00', W: '#8C8C8C', K: '#6E7B8B',
    M: '#A87CA0', B: '#767676', D: '#6B705C', H: '#8A7F6B', V: '#5F7A7A',
    N: '#999999',
  }),

  // Maximum separation for projectors and poor displays: saturated indicators on
  // near-black, which replaces the theme's canvas background while it is active.
  neon: build('neon', 'High-Contrast Dark', {
    A: '#39FF14', C: '#00E5FF', G: '#FFD400', T: '#FF2D55', U: '#FF7AA2',
    R: '#00FFC8', Y: '#C77DFF', S: '#4CC9F0', W: '#FFA630', K: '#B5E48C',
    M: '#FF6B6B', B: '#9BA1A6', D: '#A3B18A', H: '#D8A48F', V: '#7FB3B3',
    N: '#7D8590',
  }, { canvasBg: '#0d1117' }),

  // For print figures, where colour is either unavailable or unreliable: the
  // fills carry a brightness ordering and the letters do the identifying.
  monochrome: build('monochrome', 'Publication Grayscale', {
    A: '#E3E3E3', C: '#B4B4B4', G: '#858585', T: '#4F4F4F', U: '#676767',
    R: '#CFCFCF', Y: '#A5A5A5', S: '#9A9A9A', W: '#C4C4C4', K: '#8F8F8F',
    M: '#BBBBBB', B: '#7A7A7A', D: '#909090', H: '#A9A9A9', V: '#999999',
    N: '#DADADA',
  }),
};

export const DEFAULT_PALETTE = 'classic';

/** The palette for `id`, or the default for an unknown or missing one. */
export function getPalette(id) {
  return PALETTES[id] ?? PALETTES[DEFAULT_PALETTE];
}

/** Palette list for menus, in display order. */
export const PALETTE_OPTIONS = Object.values(PALETTES).map(p => ({ id: p.id, label: p.label }));
