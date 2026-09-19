import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME, getTheme } from '../theme.js';

// The canvas can't read CSS custom properties, so every colour it draws with has
// to exist in both themes. A token present in one but not the other renders as
// `undefined` — which canvas silently ignores, leaving an invisible element.
describe('theme tokens', () => {
  it('defines the same tokens in both themes', () => {
    expect(Object.keys(THEMES.light).sort()).toEqual(Object.keys(THEMES.dark).sort());
  });

  it('gives every token a non-empty colour value', () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      for (const [token, value] of Object.entries(theme)) {
        expect(typeof value, `${name}.${token}`).toBe('string');
        expect(value.length, `${name}.${token}`).toBeGreaterThan(0);
      }
    }
  });

  it('includes the tokens the newer features draw with', () => {
    for (const theme of Object.values(THEMES)) {
      expect(theme.consensusBg).toBeDefined();
      expect(theme.consensusBorder).toBeDefined(); // thick consensus separator
      expect(theme.agreementText).toBeDefined();   // greyed-out matching base
      expect(theme.rowNumber).toBeDefined();       // row numbers in the gutter
      expect(theme.columnCursor).toBeDefined();
      expect(theme.selectedRowBg).toBeDefined();     // highlighted selected row
      expect(theme.selectedRowBar).toBeDefined();
      expect(theme.selectedRowOverlay).toBeDefined();
    }
  });

  it('keeps agreement text distinct from normal base text so greying is visible', () => {
    expect(THEMES.dark.agreementText).not.toBe(THEMES.dark.canvasBg);
    expect(THEMES.light.agreementText).not.toBe(THEMES.light.canvasBg);
  });
});

describe('getTheme', () => {
  it('returns the requested theme', () => {
    expect(getTheme('light')).toBe(THEMES.light);
    expect(getTheme('dark')).toBe(THEMES.dark);
  });

  it('falls back to the default for an unknown or missing name', () => {
    expect(getTheme('solarized')).toBe(THEMES[DEFAULT_THEME]);
    expect(getTheme(undefined)).toBe(THEMES[DEFAULT_THEME]);
  });
});
