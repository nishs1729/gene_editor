import { describe, it, expect } from 'vitest';
import { PALETTES, PALETTE_OPTIONS, DEFAULT_PALETTE, getPalette, COLORED_CODES } from '../palettes.js';
import { IUPAC_MAP, TEXT_COLOR_MAP } from '../iupac.js';

describe('palettes', () => {
  it('colours every code the canvas can draw, in every palette', () => {
    for (const [id, palette] of Object.entries(PALETTES)) {
      for (const code of COLORED_CODES) {
        expect(palette.fill[code], `${id}.${code}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(palette.text[code], `${id}.${code}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it('leaves the gap out — gaps are drawn from the theme, not the palette', () => {
    expect(COLORED_CODES).not.toContain('-');
    expect(IUPAC_MAP['-'].isGap).toBe(true);
  });

  it('keeps the classic palette exactly as the editor has always drawn it', () => {
    for (const code of COLORED_CODES) {
      expect(PALETTES.classic.fill[code]).toBe(IUPAC_MAP[code].color);
      expect(PALETTES.classic.text[code]).toBe(TEXT_COLOR_MAP[code]);
    }
  });

  it('gives the four canonical bases a distinct colour in each palette', () => {
    for (const [id, palette] of Object.entries(PALETTES)) {
      const canonical = ['A', 'C', 'G', 'T'].map(c => palette.fill[c]);
      expect(new Set(canonical).size, id).toBe(4);
    }
  });

  it('only overrides the canvas background where a palette is about the background', () => {
    expect(PALETTES.neon.canvasBg).toBe('#0d1117');
    expect(PALETTES.classic.canvasBg).toBeNull();
    expect(PALETTES.colorblind.canvasBg).toBeNull();
  });

  it('picks dark letters on a light fill and light letters on a dark one', () => {
    // G is the yellow that forced the rule in the first place.
    expect(PALETTES.colorblind.text.G).toBe('#14171C');
    expect(PALETTES.neon.text.T).toBe('#FFFFFF');
  });

  it('covers U, so RNA is drawn rather than falling back to N', () => {
    for (const palette of Object.values(PALETTES)) {
      expect(palette.fill.U).toBeDefined();
      expect(palette.fill.U).not.toBe(palette.fill.T);
    }
  });
});

describe('getPalette', () => {
  it('returns the requested palette', () => {
    expect(getPalette('neon')).toBe(PALETTES.neon);
  });

  it('falls back to the default for an unknown or missing id', () => {
    expect(getPalette('chartreuse')).toBe(PALETTES[DEFAULT_PALETTE]);
    expect(getPalette(undefined)).toBe(PALETTES[DEFAULT_PALETTE]);
  });
});

describe('PALETTE_OPTIONS', () => {
  it('lists every palette with a label for the menu', () => {
    expect(PALETTE_OPTIONS.map(o => o.id)).toEqual(Object.keys(PALETTES));
    for (const option of PALETTE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
