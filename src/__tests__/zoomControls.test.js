import { describe, it, expect, vi } from 'vitest';

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
  };
}
vi.stubGlobal('localStorage', makeLocalStorage());

const { zoomToSlider, sliderToZoom, formatZoom } = await import('../ZoomControls.jsx');
const { MIN_ZOOM, MAX_ZOOM } = await import('../store.js');

describe('logarithmic zoom slider', () => {
  it('puts the ends of the range at the ends of the track', () => {
    expect(zoomToSlider(MIN_ZOOM)).toBeCloseTo(0);
    expect(zoomToSlider(MAX_ZOOM)).toBeCloseTo(1);
  });

  it('round-trips a position through a zoom factor', () => {
    for (const position of [0, 0.25, 0.5, 0.75, 1]) {
      expect(zoomToSlider(sliderToZoom(position))).toBeCloseTo(position);
    }
  });

  it('gives equal ratios equal distances, which is the point of the scale', () => {
    // Every doubling covers the same length of track.
    const oneToTwo = zoomToSlider(2) - zoomToSlider(1);
    const quarterToHalf = zoomToSlider(0.5) - zoomToSlider(0.25);
    expect(oneToTwo).toBeCloseTo(quarterToHalf);
  });

  it('leaves room below 100% instead of crushing it against the end', () => {
    // On a linear track 100% would sit at a quarter of the way along, with the
    // whole overview range squeezed into the sliver below it.
    expect(zoomToSlider(1)).toBeGreaterThan(0.6);
    expect(zoomToSlider(0.01)).toBeGreaterThan(0.05);
  });
});

describe('formatZoom', () => {
  it('reads as whole percentages where they mean something', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(2)).toBe('200%');
    expect(formatZoom(0.25)).toBe('25%');
  });

  it('keeps a decimal at the bottom, where 1% and 0.6% look nothing alike', () => {
    expect(formatZoom(0.01)).toBe('1.0%');
    expect(formatZoom(0.006)).toBe('0.6%');
  });
});
