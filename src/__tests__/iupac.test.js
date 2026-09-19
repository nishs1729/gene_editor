import { describe, it, expect } from 'vitest';
import { IUPAC_MAP, COMPLEMENT_MAP, TEXT_COLOR_MAP, isValidChar, complement } from '../iupac.js';

describe('IUPAC_MAP', () => {
  it('has all 15 IUPAC codes', () => {
    const codes = 'ATGCRYSWKMBDHVN';
    for (const c of codes) {
      expect(IUPAC_MAP).toHaveProperty(c);
      expect(IUPAC_MAP[c]).toHaveProperty('bases');
      expect(IUPAC_MAP[c]).toHaveProperty('color');
      expect(IUPAC_MAP[c].bases.length).toBeGreaterThan(0);
    }
  });

  it('canonical bases have exactly 1 element in bases array', () => {
    expect(IUPAC_MAP.A.bases).toEqual(['A']);
    expect(IUPAC_MAP.T.bases).toEqual(['T']);
    expect(IUPAC_MAP.G.bases).toEqual(['G']);
    expect(IUPAC_MAP.C.bases).toEqual(['C']);
  });

  it('N represents all 4 bases', () => {
    expect(IUPAC_MAP.N.bases.sort()).toEqual(['A', 'C', 'G', 'T']);
  });
});

describe('COMPLEMENT_MAP', () => {
  it('has all 15 IUPAC codes', () => {
    const codes = 'ATGCRYSWKMBDHVN';
    for (const c of codes) {
      expect(COMPLEMENT_MAP).toHaveProperty(c);
    }
  });

  it('complement is symmetric: complement(complement(x)) === x', () => {
    for (const code of Object.keys(COMPLEMENT_MAP)) {
      const comp = COMPLEMENT_MAP[code];
      const doubleComp = COMPLEMENT_MAP[comp];
      expect(doubleComp).toBe(code);
    }
  });

  it('canonical complements are correct', () => {
    expect(COMPLEMENT_MAP.A).toBe('T');
    expect(COMPLEMENT_MAP.T).toBe('A');
    expect(COMPLEMENT_MAP.G).toBe('C');
    expect(COMPLEMENT_MAP.C).toBe('G');
  });

  it('ambiguity complements are correct', () => {
    expect(COMPLEMENT_MAP.R).toBe('Y'); // A/G → C/T
    expect(COMPLEMENT_MAP.Y).toBe('R');
    expect(COMPLEMENT_MAP.S).toBe('S'); // G/C → G/C (self-complement)
    expect(COMPLEMENT_MAP.W).toBe('W'); // A/T → A/T (self-complement)
    expect(COMPLEMENT_MAP.K).toBe('M'); // G/T → A/C
    expect(COMPLEMENT_MAP.M).toBe('K');
    expect(COMPLEMENT_MAP.B).toBe('V'); // C/G/T → A/C/G
    expect(COMPLEMENT_MAP.V).toBe('B');
    expect(COMPLEMENT_MAP.D).toBe('H'); // A/G/T → A/C/T
    expect(COMPLEMENT_MAP.H).toBe('D');
    expect(COMPLEMENT_MAP.N).toBe('N'); // any → any
  });
});

describe('TEXT_COLOR_MAP', () => {
  it('G has dark text color (yellow bg needs contrast)', () => {
    expect(TEXT_COLOR_MAP.G).toBe('#2C3E50');
  });

  it('other bases have white text', () => {
    for (const code of ['A', 'T', 'C', 'R', 'Y', 'N']) {
      expect(TEXT_COLOR_MAP[code]).toBe('#FFFFFF');
    }
  });
});

describe('isValidChar', () => {
  it('accepts all 15 IUPAC codes (uppercase)', () => {
    for (const c of 'ATGCRYSWKMBDHVN') {
      expect(isValidChar(c)).toBe(true);
    }
  });

  it('accepts lowercase versions', () => {
    for (const c of 'atgcryswkmbdhvn') {
      expect(isValidChar(c)).toBe(true);
    }
  });

  it('rejects invalid characters', () => {
    expect(isValidChar('X')).toBe(false);
    expect(isValidChar('1')).toBe(false);
    expect(isValidChar(' ')).toBe(false);
    expect(isValidChar('Z')).toBe(false);
    expect(isValidChar('-')).toBe(false);
  });

  it('rejects empty and multi-char strings', () => {
    expect(isValidChar('')).toBe(false);
    expect(isValidChar('AT')).toBe(false);
    expect(isValidChar(null)).toBe(false);
    expect(isValidChar(undefined)).toBe(false);
  });
});

describe('complement', () => {
  it('complements canonical bases', () => {
    expect(complement('A')).toBe('T');
    expect(complement('T')).toBe('A');
    expect(complement('G')).toBe('C');
    expect(complement('C')).toBe('G');
  });

  it('complements ambiguity codes', () => {
    expect(complement('R')).toBe('Y');
    expect(complement('Y')).toBe('R');
    expect(complement('N')).toBe('N');
  });

  it('handles lowercase input', () => {
    expect(complement('a')).toBe('T');
    expect(complement('g')).toBe('C');
  });

  it('returns null for invalid input', () => {
    expect(complement('X')).toBe(null);
    expect(complement('')).toBe(null);
    expect(complement(null)).toBe(null);
  });
});
