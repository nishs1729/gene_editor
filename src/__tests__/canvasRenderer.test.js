import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.stubGlobal('window', { devicePixelRatio: 1 });

const { CanvasRenderer } = await import('../canvasRenderer.js');
const { createDocument } = await import('../sequenceModel.js');

// A canvas context stub with a predictable metric: every glyph is 8px wide, so
// cellWidth is 10 (8 rounded up, +2 spacing) and cellHeight is 20 (14pt + 6 pad).
const GLYPH = 8;
const BASE_FONT = 14;
const CELL_W = 10;
const CELL_H = 20;
const ROW_GAP = 2;
const ROW_H = CELL_H + ROW_GAP;
const RULER_H = 24;
const SEPARATOR = 4;
const NAME_PADDING = 10;

function makeRenderer(width = 1000, height = 600) {
  const rects = [];
  const glyphs = [];
  const ctx = {
    font: '', textBaseline: '', textAlign: '',
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    measureText: t => ({ width: t.length * GLYPH }),
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, style: this.fillStyle }); },
    fillText(text, x, y) { glyphs.push({ text, x, y, style: this.fillStyle }); },
    setTransform() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, rect() {}, arc() {},
    stroke() {}, fill() {}, clip() {}, save() {}, restore() {},
  };
  const canvas = { width, height, style: {}, getContext: () => ctx };
  const r = new CanvasRenderer(canvas);
  r.resize(width, height);
  r.drawn = {
    rects,
    glyphs,
    reset() { rects.length = 0; glyphs.length = 0; },
    /** The background rect of one cell, if it was filled at all. */
    cellRect: (x, y) => rects.find(t => t.x === x && t.y === y && t.w === CELL_W - 1),
    /** The letter drawn in one cell. */
    cellGlyph: (x, y) => glyphs.find(t => t.x === x + CELL_W / 2 && t.y === y + CELL_H / 2),
  };
  return r;
}

function stackedState(count = 8, len = 40, overrides = {}) {
  const documents = Array.from({ length: count }, (_, i) =>
    createDocument(`seq${i + 1}`, 'ACGT'.repeat(Math.ceil(len / 4)).slice(0, len))
  );
  return {
    documents,
    activeDocId: documents[0].id,
    selectedDocIds: new Set(),
    columnCursor: null,
    dragInsertIndex: null,
    viewSettings: {
      lineWidth: 0,
      showComplement: false,
      showConsensus: true,
      consensusThreshold: 0.5,
      highlightMode: 'none',
      referenceDocId: documents[0].id,
      fullscreen: false,
    },
    ...overrides,
  };
}

let r;
beforeEach(() => { r = makeRenderer(); });

describe('measured layout', () => {
  it('derives cell size from font metrics', () => {
    expect(r.cellWidth).toBe(CELL_W);
    expect(r.cellHeight).toBe(CELL_H);
  });

  it('treats a single document as the wrapped view and several as stacked', () => {
    expect(r.isStacked(stackedState(1))).toBe(false);
    expect(r.isStacked(stackedState(2))).toBe(true);
  });
});

describe('consensus row and its separator', () => {
  it('reserves the consensus row plus a thick separator above the sequences', () => {
    const state = stackedState();
    expect(r.getSeqAreaTop(state)).toBe(RULER_H + CELL_H + ROW_GAP + SEPARATOR);
  });

  it('reclaims that space when the consensus row is hidden', () => {
    const state = stackedState();
    state.viewSettings.showConsensus = false;
    expect(r.getSeqAreaTop(state)).toBe(RULER_H);
  });

  it('never reserves it in the single-document view', () => {
    expect(r.getSeqAreaTop(stackedState(1))).toBe(RULER_H);
  });

  it('includes the separator in the scrollable content height', () => {
    const state = stackedState(8);
    const size = r.getContentSize(state);
    expect(size.height).toBe(r.getSeqAreaTop(state) + 8 * ROW_H + ROW_GAP);

    state.viewSettings.showConsensus = false;
    expect(r.getContentSize(state).height).toBe(RULER_H + 8 * ROW_H + ROW_GAP);
  });
});

describe('row numbers in the name gutter', () => {
  it('sizes the number column to the highest number', () => {
    // '8.' and '12.' are 2 and 3 glyphs, plus 6px of padding.
    expect(r.getNumberWidth(8)).toBe(2 * GLYPH + 6);
    expect(r.getNumberWidth(12)).toBe(3 * GLYPH + 6);
    expect(r.getNumberWidth(100)).toBe(4 * GLYPH + 6);
  });

  it('reserves room for the numbers and the widest name', () => {
    const state = stackedState(8, 40);
    state.documents[3] = createDocument('a-rather-long-name', 'ACGT');
    const expected = NAME_PADDING + r.getNumberWidth(8) + 'a-rather-long-name'.length * GLYPH + NAME_PADDING;
    expect(r.getGutterWidth(state)).toBe(expected);
  });

  it('grows the gutter when the numbers get wider', () => {
    const few = stackedState(9, 40);
    const many = stackedState(100, 40);
    // Same long name either way (long enough to clear the minimum width), so any
    // difference between the two is the number column.
    for (const d of many.documents) d.name = 'a-long-sequence-name';
    for (const d of few.documents) d.name = 'a-long-sequence-name';
    expect(r.getGutterWidth(many)).toBeGreaterThan(r.getGutterWidth(few));
  });

  it('clamps the gutter to its minimum and maximum', () => {
    const tiny = stackedState(2, 4);
    for (const d of tiny.documents) d.name = 'a';
    expect(r.getGutterWidth(tiny)).toBe(90);

    const huge = stackedState(2, 4);
    for (const d of huge.documents) d.name = 'x'.repeat(200);
    expect(r.getGutterWidth(huge)).toBe(220);
  });
});

describe('content size', () => {
  it('spans the longest sequence in stacked mode', () => {
    const state = stackedState(3, 40);
    state.documents[1] = createDocument('long', 'A'.repeat(120));
    const gutter = r.getGutterWidth(state);
    expect(r.getContentSize(state).width).toBe(gutter + 120 * CELL_W + 20);
  });

  it('is empty with no documents', () => {
    expect(r.getContentSize({ documents: [], viewSettings: {} })).toEqual({ width: 0, height: 0 });
  });
});

describe('hitTest — stacked', () => {
  let state, gutter, top;

  beforeEach(() => {
    state = stackedState(8, 40);
    gutter = r.getGutterWidth(state); // also caches the width hitTest reads
    top = r.getSeqAreaTop(state);
  });

  const at = (x, y, scroll = { top: 0, left: 0 }) => r.hitTest(x, y, scroll, state);

  it('treats the ruler right of the gutter as a column target', () => {
    expect(at(gutter + 3 * CELL_W, 10)).toEqual({ kind: 'ruler', index: 3 });
  });

  it('ignores the ruler above the gutter', () => {
    expect(at(10, 10)).toBe(null);
  });

  it('clamps a ruler hit to the alignment width', () => {
    expect(at(gutter + 999 * CELL_W, 10)).toEqual({ kind: 'ruler', index: 39 });
  });

  it('makes the consensus row and its separator inert', () => {
    expect(at(gutter + 30, RULER_H + 2)).toBe(null);
    expect(at(gutter + 30, top - 1)).toBe(null); // inside the separator band
  });

  it('hits the first sequence row immediately below the separator', () => {
    expect(at(gutter + 5 * CELL_W, top + 2)).toEqual({
      kind: 'seq', docId: state.documents[0].id, index: 5,
    });
  });

  it('resolves the whole gutter as the name, then the sequence', () => {
    const y = top + 2;
    expect(at(5, y).kind).toBe('name');
    expect(at(gutter - 5, y).kind).toBe('name');
    expect(at(gutter + 5, y).kind).toBe('seq');
  });

  it('maps y to the right row', () => {
    expect(at(5, top + 3 * ROW_H + 2).docId).toBe(state.documents[3].id);
  });

  it('accounts for scroll on both axes', () => {
    expect(at(gutter + 2 * CELL_W, top + 2, { top: 2 * ROW_H, left: 10 * CELL_W })).toEqual({
      kind: 'seq', docId: state.documents[2].id, index: 12,
    });
  });

  it('returns nothing past the last row', () => {
    expect(at(gutter + 5, top + 20 * ROW_H)).toBe(null);
  });

  it('clamps an index to the sequence rather than rejecting it, so drags still extend', () => {
    expect(at(gutter + 999 * CELL_W, top + 2).index).toBe(40);
  });

  it('shifts the rows up when the consensus row is hidden', () => {
    state.viewSettings.showConsensus = false;
    expect(r.hitTest(gutter + 5, RULER_H + 2, { top: 0, left: 0 }, state).docId)
      .toBe(state.documents[0].id);
  });

  it('returns nothing when no documents are loaded', () => {
    expect(r.hitTest(10, 10, { top: 0, left: 0 }, { documents: [], viewSettings: {} })).toBe(null);
  });
});

describe('hitTest — single wrapped document', () => {
  it('maps a click to an index using the wrapped row width', () => {
    const state = stackedState(1, 200);
    const basesPerRow = r.getBasesPerRow(0);
    const rowHeight = r.getSingleRowHeight(false);
    const hit = r.hitTest(60 + 3 * CELL_W, rowHeight + RULER_H + 2, { top: 0, left: 0 }, state);
    expect(hit).toEqual({ kind: 'seq', docId: state.documents[0].id, index: basesPerRow + 3 });
  });
});

describe('indexToPixel', () => {
  it('round-trips with hitTest in stacked mode', () => {
    const state = stackedState(4, 40);
    const gutter = r.getGutterWidth(state);
    const top = r.getSeqAreaTop(state);
    const scroll = { top: 0, left: 0 };
    const px = r.indexToPixel(7, scroll, state, state.documents[2].id);
    expect(px.x).toBe(gutter + 7 * CELL_W);
    expect(px.y).toBe(top + 2 * ROW_H);
    expect(r.hitTest(px.x, px.y + 2, scroll, state)).toEqual({
      kind: 'seq', docId: state.documents[2].id, index: 7,
    });
  });
});

describe('disagreement highlighting', () => {
  // Three 4-base rows. The consensus is AAAA, so row 1 ('AGAA') agrees everywhere
  // except column 1, and row 2 agrees everywhere.
  function alignment(overrides = {}) {
    const documents = [
      createDocument('one', 'AAAA'),
      createDocument('two', 'AGAA'),
      createDocument('three', 'AAAA'),
    ];
    const state = stackedState(3, 4, overrides);
    state.documents = documents;
    state.activeDocId = documents[0].id;
    state.viewSettings.referenceDocId = documents[0].id;
    return state;
  }

  let state, gutter, top, theme;
  const cellX = col => gutter + col * CELL_W;
  const rowYAt = row => top + row * ROW_H;

  beforeEach(() => {
    state = alignment();
    gutter = r.getGutterWidth(state);
    top = r.getSeqAreaTop(state);
    theme = r.theme;
  });

  function draw() {
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });
  }

  it('fills every cell when highlighting is off', () => {
    draw();
    for (const col of [0, 1, 2, 3]) {
      expect(r.drawn.cellRect(cellX(col), rowYAt(1)), `col ${col}`).toBeDefined();
    }
  });

  it('leaves agreeing cells unfilled so the row background shows through', () => {
    state.viewSettings.highlightMode = 'consensus';
    draw();
    expect(r.drawn.cellRect(cellX(0), rowYAt(1))).toBeUndefined();
    expect(r.drawn.cellRect(cellX(2), rowYAt(1))).toBeUndefined();
  });

  it('keeps the colour fill on disagreeing cells', () => {
    state.viewSettings.highlightMode = 'consensus';
    draw();
    expect(r.drawn.cellRect(cellX(1), rowYAt(1))).toBeDefined();
  });

  it('greys the letter of an agreeing base and not of a disagreeing one', () => {
    state.viewSettings.highlightMode = 'consensus';
    draw();
    expect(r.drawn.cellGlyph(cellX(0), rowYAt(1))).toMatchObject({ text: 'A', style: theme.agreementText });
    expect(r.drawn.cellGlyph(cellX(1), rowYAt(1)).style).not.toBe(theme.agreementText);
  });

  it('never greys the consensus row itself', () => {
    state.viewSettings.highlightMode = 'consensus';
    draw();
    const consensusY = RULER_H;
    for (const col of [0, 1, 2, 3]) {
      expect(r.drawn.cellRect(cellX(col), consensusY), `col ${col}`).toBeDefined();
    }
  });

  it('follows the consensus threshold', () => {
    state.viewSettings.highlightMode = 'consensus';
    // At 50% the column-1 consensus is A, so rows 0 and 2 agree there.
    draw();
    expect(r.drawn.cellRect(cellX(1), rowYAt(2))).toBeUndefined();
    // At 100% it becomes N, which nothing matches, so every row disagrees.
    state.viewSettings.consensusThreshold = 1;
    draw();
    expect(r.drawn.cellRect(cellX(1), rowYAt(2))).toBeDefined();
  });

  it('compares against the chosen reference and leaves that row fully coloured', () => {
    state.viewSettings.highlightMode = 'reference';
    state.viewSettings.referenceDocId = state.documents[1].id; // 'AGAA'
    draw();
    // The reference row keeps every fill.
    for (const col of [0, 1, 2, 3]) {
      expect(r.drawn.cellRect(cellX(col), rowYAt(1)), `ref col ${col}`).toBeDefined();
    }
    // Row 0 ('AAAA') now differs from the reference only at column 1.
    expect(r.drawn.cellRect(cellX(0), rowYAt(0))).toBeUndefined();
    expect(r.drawn.cellRect(cellX(1), rowYAt(0))).toBeDefined();
  });

  it('falls back to the first sequence when the reference has been deleted', () => {
    state.viewSettings.highlightMode = 'reference';
    state.viewSettings.referenceDocId = 'gone';
    draw();
    for (const col of [0, 1, 2, 3]) {
      expect(r.drawn.cellRect(cellX(col), rowYAt(0)), `col ${col}`).toBeDefined();
    }
    expect(r.drawn.cellRect(cellX(1), rowYAt(1))).toBeDefined();
  });

  it('greys a row\'s complement strand together with its forward strand', () => {
    state.viewSettings.highlightMode = 'consensus';
    state.viewSettings.showComplement = true;
    gutter = r.getGutterWidth(state);
    top = r.getSeqAreaTop(state);
    const rowHeight = r.getRowHeight(true);
    draw();
    const compY = top + 1 * rowHeight + CELL_H;
    const comp = r.drawn.rects.find(t => t.x === cellX(0) && t.y === compY);
    expect(comp).toBeUndefined();           // agrees, so unfilled
    expect(r.drawn.rects.find(t => t.x === cellX(1) && t.y === compY)).toBeDefined();
  });
});

describe('row numbers are drawn', () => {
  it('prefixes each name with its 1-based position', () => {
    const state = stackedState(3, 8);
    r.render(state, { top: 0, left: 0 });
    const texts = r.drawn.glyphs.map(g => g.text);
    expect(texts).toContain('1.');
    expect(texts).toContain('2.');
    expect(texts).toContain('3.');
    expect(texts).not.toContain('0.');
  });

  it('draws numbers dimmer than the names, in their own column', () => {
    const state = stackedState(3, 8);
    r.render(state, { top: 0, left: 0 });
    const number = r.drawn.glyphs.find(g => g.text === '2.');
    const name = r.drawn.glyphs.find(g => g.text === 'seq2');
    expect(number.style).toBe(r.theme.rowNumber);
    expect(name.style).not.toBe(r.theme.rowNumber);
    expect(name.x).toBeGreaterThan(number.x);
  });

  it('indents the numbers from the gutter edge', () => {
    const state = stackedState(3, 8);
    r.render(state, { top: 0, left: 0 });
    expect(r.drawn.glyphs.find(g => g.text === '1.').x).toBe(NAME_PADDING);
  });
});

describe('the consensus separator is drawn', () => {
  it('paints a thick rule across the full width, gutter included', () => {
    const state = stackedState(4, 20);
    r.render(state, { top: 0, left: 0 });
    const top = r.getSeqAreaTop(state);
    const rule = r.drawn.rects.find(t => t.style === r.theme.consensusBorder);
    expect(rule).toBeDefined();
    expect(rule.h).toBe(SEPARATOR);
    expect(rule.x).toBe(0);
    expect(rule.w).toBe(r.width);
    expect(rule.y + rule.h).toBe(top); // sits directly above the first row
  });

  it('draws no rule when the consensus row is hidden', () => {
    const state = stackedState(4, 20);
    state.viewSettings.showConsensus = false;
    r.render(state, { top: 0, left: 0 });
    expect(r.drawn.rects.find(t => t.style === r.theme.consensusBorder)).toBeUndefined();
  });
});

describe('selected sequences are highlighted', () => {
  let state, gutter, top;

  beforeEach(() => {
    state = stackedState(4, 20);
    gutter = r.getGutterWidth(state);
    top = r.getSeqAreaTop(state);
  });

  const rowYAt = row => top + row * ROW_H;
  const rowFills = (row, style) =>
    r.drawn.rects.filter(t => t.y === rowYAt(row) && t.style === style);

  it('draws nothing extra while no sequence is selected', () => {
    r.render(state, { top: 0, left: 0 });
    expect(r.drawn.rects.some(t => t.style === r.theme.selectedRowBg)).toBe(false);
    expect(r.drawn.rects.some(t => t.style === r.theme.selectedRowOverlay)).toBe(false);
  });

  it('highlights the gutter and the sequence of a selected row', () => {
    state.selectedDocIds = new Set([state.documents[2].id]);
    r.render(state, { top: 0, left: 0 });

    const gutterFill = rowFills(2, r.theme.selectedRowBg)[0];
    expect(gutterFill).toMatchObject({ x: 0, w: gutter });

    const seqFill = rowFills(2, r.theme.selectedRowOverlay)[0];
    expect(seqFill).toMatchObject({ x: gutter, w: r.width - gutter });
  });

  it('marks the selected row with an accent bar at the gutter edge', () => {
    state.selectedDocIds = new Set([state.documents[1].id]);
    r.render(state, { top: 0, left: 0 });
    const bar = rowFills(1, r.theme.selectedRowBar)[0];
    expect(bar).toMatchObject({ x: 0, w: 3 });
  });

  it('leaves unselected rows alone', () => {
    state.selectedDocIds = new Set([state.documents[1].id]);
    r.render(state, { top: 0, left: 0 });
    expect(rowFills(0, r.theme.selectedRowBg)).toHaveLength(0);
    expect(rowFills(3, r.theme.selectedRowOverlay)).toHaveLength(0);
  });

  it('takes precedence over the lighter active-row tint in the gutter', () => {
    state.selectedDocIds = new Set([state.documents[0].id]); // row 0 is also active
    r.render(state, { top: 0, left: 0 });
    expect(rowFills(0, r.theme.selectedRowBg)).toHaveLength(1);
    // The gutter tint is the one that would clash; the sequence area keeps both.
    const gutterActive = rowFills(0, r.theme.activeRowBg).filter(t => t.x === 0);
    expect(gutterActive).toHaveLength(0);
  });

  it('highlights every selected row', () => {
    state.selectedDocIds = new Set([state.documents[0].id, state.documents[3].id]);
    r.render(state, { top: 0, left: 0 });
    expect(rowFills(0, r.theme.selectedRowOverlay)).toHaveLength(1);
    expect(rowFills(3, r.theme.selectedRowOverlay)).toHaveLength(1);
    expect(rowFills(1, r.theme.selectedRowOverlay)).toHaveLength(0);
  });

  it('draws no checkbox', () => {
    state.selectedDocIds = new Set([state.documents[0].id]);
    r.render(state, { top: 0, left: 0 });
    // A checkbox was the only thing that stroked a rect in the gutter.
    const names = r.drawn.glyphs.filter(g => g.text === 'seq1');
    expect(names[0].x).toBeLessThan(NAME_PADDING + r.getNumberWidth(4) + 1);
  });
});

describe('the column cursor is steady', () => {
  // A blinking caret marks where one keystroke lands; the column cursor marks a
  // locus across every row, so it has to stay put.
  function drawWith(cursorVisible) {
    const state = stackedState(4, 20);
    state.columnCursor = 6;
    r.cursorVisible = cursorVisible;
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });
    return r.drawn.rects.filter(t => t.style === r.theme.columnCursor);
  }

  it('draws in both phases of the blink timer', () => {
    expect(drawWith(true).length).toBeGreaterThan(0);
    expect(drawWith(false).length).toBe(drawWith(true).length);
  });

  it('still hides the per-row caret on the blink-off phase', () => {
    const state = stackedState(4, 20);
    state.documents[0].cursorPos = 3;
    r.cursorVisible = false;
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });
    expect(r.drawn.rects.some(t => t.style === r.theme.cursor)).toBe(false);
  });
});

describe('rendering', () => {
  // The renderer draws to a stubbed context, so these assert that each mode
  // completes rather than what it paints — pixel behaviour is covered separately.
  const modes = [
    ['stacked, consensus on', stackedState(8, 40)],
    ['stacked, highlighting to consensus', stackedState(8, 40, {})],
    ['single wrapped document', stackedState(1, 200)],
  ];
  modes[1][1].viewSettings.highlightMode = 'consensus';

  for (const [label, state] of modes) {
    it(`renders ${label} without error`, () => {
      expect(() => r.render(state, { top: 0, left: 0 })).not.toThrow();
    });
  }

  it('renders reference highlighting, including a stale reference id', () => {
    const state = stackedState(8, 40);
    state.viewSettings.highlightMode = 'reference';
    expect(() => r.render(state, { top: 0, left: 0 })).not.toThrow();

    state.viewSettings.referenceDocId = 'deleted-doc-id';
    expect(() => r.render(state, { top: 0, left: 0 })).not.toThrow();
  });

  it('renders with a column cursor, a row selection and complement strands', () => {
    const state = stackedState(8, 40);
    state.columnCursor = 12;
    state.selectedDocIds = new Set([state.documents[1].id]);
    state.documents[0].dirty = true;
    state.viewSettings.showComplement = true;
    expect(() => r.render(state, { top: 0, left: 0 })).not.toThrow();
  });

  it('renders an empty workspace', () => {
    expect(() => r.render({ documents: [], viewSettings: {} }, { top: 0, left: 0 })).not.toThrow();
  });
});

describe('reference sequence marker', () => {
  let state, gutter, top;
  const rowYAt = row => top + row * ROW_H;

  beforeEach(() => {
    state = stackedState(4, 20);
    state.viewSettings.referenceDocId = state.documents[2].id;
    gutter = r.getGutterWidth(state);
    top = r.getSeqAreaTop(state);
  });

  it('washes the name cell of the reference row', () => {
    r.render(state, { top: 0, left: 0 });
    const fill = r.drawn.rects.find(t => t.y === rowYAt(2) && t.style === r.theme.referenceNameBg);
    expect(fill).toMatchObject({ x: 0, w: gutter });
  });

  it('leaves the sequence area of the reference row uncoloured', () => {
    r.render(state, { top: 0, left: 0 });
    const outsideGutter = r.drawn.rects.filter(
      t => t.style === r.theme.referenceNameBg && t.x !== 0
    );
    expect(outsideGutter).toHaveLength(0);
  });

  it('marks nothing when no sequence is the reference', () => {
    state.viewSettings.referenceDocId = null;
    r.render(state, { top: 0, left: 0 });
    expect(r.drawn.rects.some(t => t.style === r.theme.referenceNameBg)).toBe(false);
  });

  it('yields to the selection highlight while the reference row is selected', () => {
    state.selectedDocIds = new Set([state.documents[2].id]);
    r.render(state, { top: 0, left: 0 });
    const at2 = style => r.drawn.rects.some(t => t.y === rowYAt(2) && t.style === style);
    expect(at2(r.theme.referenceNameBg)).toBe(false);
    expect(at2(r.theme.selectedRowBg)).toBe(true);
  });
});

describe('zoom', () => {
  let z;
  beforeEach(() => { z = makeRenderer(); });

  it('stretches the columns and nothing else', () => {
    const rowHeight = z.getRowHeight(false);
    z.setZoom(2);
    expect(z.cellWidth).toBe(2 * CELL_W);
    expect(z.cellHeight).toBe(CELL_H);
    expect(z.getRowHeight(false)).toBe(rowHeight);
  });

  it('leaves the vertical layout alone at every zoom', () => {
    const state = stackedState(8, 40);
    const before = z.getContentSize(state).height;
    for (const zoom of [0.2, 0.5, 2, 4]) {
      z.setZoom(zoom);
      expect(z.getContentSize(state).height, `zoom ${zoom}`).toBe(before);
      expect(z.getSeqAreaTop(state), `zoom ${zoom}`).toBe(RULER_H + CELL_H + ROW_GAP + SEPARATOR);
    }
  });

  it('leaves the name gutter alone at every zoom', () => {
    const state = stackedState(8, 40);
    const before = z.getGutterWidth(state);
    z.setZoom(4);
    expect(z.getGutterWidth(state)).toBe(before);
    z.setZoom(0.2);
    expect(z.getGutterWidth(state)).toBe(before);
  });

  it('never grows the letters past their base size, which would be vertical zoom', () => {
    z.setZoom(4);
    expect(z.fontSize).toBe(BASE_FONT);
  });

  it('shrinks the letters to fit a narrowed column, then drops them', () => {
    z.setZoom(0.6);
    expect(z.fontSize).toBeGreaterThan(0);
    expect(z.fontSize).toBeLessThan(BASE_FONT);

    z.setZoom(0.2);
    expect(z.fontSize).toBe(0); // colour blocks only
  });

  it('draws colour without letters once the columns are too narrow', () => {
    const state = stackedState(4, 40);
    z.setZoom(0.2);
    z.render(state, { top: 0, left: 0 });
    const gutter = z.getGutterWidth(state);
    expect(z.drawn.rects.some(t => t.x > gutter && t.w === z.cellDrawWidth)).toBe(true);
    expect(z.drawn.glyphs.some(g => 'ACGT'.includes(g.text))).toBe(false);
  });

  it('steps the ruler interval up as the columns narrow', () => {
    expect(z.getRulerInterval()).toBe(10);
    z.setZoom(0.4);
    expect(z.getRulerInterval()).toBeGreaterThan(10);
    z.setZoom(0.2);
    expect(z.getRulerInterval() * z.cellWidth).toBeGreaterThanOrEqual(55);
  });

  it('keeps the base under the pointer in place in the stacked view', () => {
    const state = stackedState(8, 400);
    const gutter = z.getGutterWidth(state); // hitTest reads the cached width
    const scroll = { top: 3 * ROW_H, left: 10 * CELL_W };
    // On exact cell and row boundaries, so hitTest rounding cannot mask a drift.
    const x = gutter + 20 * CELL_W;
    const y = z.getSeqAreaTop(state) + 2 * ROW_H;
    const before = z.hitTest(x, y, scroll, state);

    const anchor = z.getZoomAnchor(x, y, scroll, state);
    z.setZoom(2);
    const after = z.getScrollForAnchor(anchor, state);
    z.getGutterWidth(state);

    expect(z.hitTest(x, y, after, state)).toEqual(before);
  });

  it('keeps the anchored base within a row of the pointer as the wrapped view reflows', () => {
    const state = stackedState(1, 4000);
    const scroll = { top: 5 * z.getSingleRowHeight(false), left: 0 };
    const x = 400;
    const y = 200;
    const index = z.hitTest(x, y, scroll, state).index;

    const anchor = z.getZoomAnchor(x, y, scroll, state);
    z.setZoom(2);
    const after = z.getScrollForAnchor(anchor, state);

    const px = z.indexToPixel(index, after, state, state.documents[0].id);
    expect(Math.abs(px.y - y)).toBeLessThanOrEqual(z.getSingleRowHeight(false));
  });

  it('never scrolls past the start of the content when zooming out at the top', () => {
    const state = stackedState(8, 400);
    const anchor = z.getZoomAnchor(0, 0, { top: 0, left: 0 }, state);
    z.setZoom(0.4);
    expect(z.getScrollForAnchor(anchor, state)).toEqual({ top: 0, left: 0 });
  });
});


describe('resizable name column', () => {
  const scroll = { top: 0, left: 0 };

  it('uses the dragged width in place of the measured one', () => {
    const state = stackedState(4, 20);
    const measured = r.getGutterWidth(state);
    state.viewSettings.nameGutterWidth = 300;
    expect(r.getGutterWidth(state)).toBe(300);
    expect(measured).not.toBe(300);
  });

  it('goes back to sizing itself when the width is cleared', () => {
    const state = stackedState(4, 20);
    const measured = r.getGutterWidth(state);
    state.viewSettings.nameGutterWidth = 300;
    r.getGutterWidth(state);
    state.viewSettings.nameGutterWidth = null;
    expect(r.getGutterWidth(state)).toBe(measured);
  });

  it('starts the sequences at the dragged edge', () => {
    const state = stackedState(4, 20);
    state.viewSettings.nameGutterWidth = 300;
    expect(r.getContentSize(state).width).toBe(300 + 20 * CELL_W + 20);
    r.render(state, scroll);
    expect(r.drawn.cellRect(300, r.getSeqAreaTop(state))).toBeDefined();
  });

  it('resolves the divider, and the name and sequence either side of it', () => {
    const state = stackedState(4, 20);
    const gutter = r.getGutterWidth(state);
    const y = r.getSeqAreaTop(state) + 2;
    expect(r.hitTest(gutter, y, scroll, state)).toEqual({ kind: 'gutterEdge' });
    expect(r.hitTest(gutter - 3, y, scroll, state)).toEqual({ kind: 'gutterEdge' });
    expect(r.hitTest(gutter - 8, y, scroll, state).kind).toBe('name');
    expect(r.hitTest(gutter + 8, y, scroll, state).kind).toBe('seq');
  });

  it('offers the divider along the ruler as well', () => {
    const state = stackedState(4, 20);
    const gutter = r.getGutterWidth(state);
    expect(r.hitTest(gutter, 8, scroll, state)).toEqual({ kind: 'gutterEdge' });
  });
});

// ---------------------------------------------------------------------------
// Extreme zoom-out: a whole alignment compressed into the window.
// Below a pixel per column the renderer aggregates bases per pixel instead of
// drawing a cell each, which is what makes a multi-kilobase alignment fit.
// ---------------------------------------------------------------------------

/** Documents built from an explicit pattern, so a region's colour is known. */
function patternState(rows, overrides = {}) {
  const documents = rows.map((raw, i) => createDocument(`seq${i + 1}`, raw));
  return {
    documents,
    activeDocId: documents[0].id,
    selectedDocIds: new Set(),
    columnCursor: null,
    columnSelection: null,
    dragInsertIndex: null,
    viewSettings: {
      lineWidth: 0,
      showComplement: false,
      showConsensus: false,
      consensusThreshold: 0.5,
      highlightMode: 'none',
      referenceDocId: null,
      fullscreen: false,
    },
    ...overrides,
  };
}

describe('overview mode', () => {
  it('switches in below a pixel per column, with hysteresis on the way back', () => {
    // cellWidth is 10 * zoom with this stub's metrics.
    expect(r.overviewMode).toBe(false);

    r.setZoom(0.1); // 1px per column — at the threshold
    expect(r.overviewMode).toBe(true);

    // Still in overview between the two thresholds: this is the band that would
    // otherwise flicker while the zoom slider is dragged.
    r.setZoom(0.11);
    expect(r.overviewMode).toBe(true);

    r.setZoom(0.12); // 1.2px — out
    expect(r.overviewMode).toBe(false);
  });

  it('lets a column be a fraction of a pixel', () => {
    r.setZoom(0.02);
    expect(r.cellWidth).toBeCloseTo(0.2);
    // The old integer floor would have rounded this up to 2px per column and
    // made a whole alignment twenty times too wide to fit.
    expect(r.cellWidth).toBeLessThan(1);
  });

  it('draws by the pixel, not by the base', () => {
    // 2,000 columns at 0.2px each: the per-base path would issue 2,000 fills per
    // row for the ~400px the row occupies.
    const state = patternState(['ACGT'.repeat(500), 'ACGT'.repeat(500)]);
    r.setZoom(0.02);
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });

    const rowY = r.getSeqAreaTop(state);
    const rowFills = r.drawn.rects.filter(t => t.y === rowY && t.h === CELL_H - 1);
    expect(rowFills.length).toBeGreaterThan(0);
    expect(rowFills.length).toBeLessThan(500);
  });

  it('keeps gap columns legible as breaks in the row', () => {
    // Bases on the left, a gap block on the right. Two rows, so this is the
    // stacked alignment view rather than the wrapped single-sequence one.
    const pattern = 'A'.repeat(1000) + '-'.repeat(1000);
    const state = patternState([pattern, pattern]);
    r.setZoom(0.05); // 0.5px per column
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });

    const rowY = r.getSeqAreaTop(state);
    const rowFills = r.drawn.rects.filter(t => t.y === rowY && t.h === CELL_H - 1);
    const styles = new Set(rowFills.map(t => t.style));
    expect(styles.has('#27AE60')).toBe(true);  // the palette's A
    expect(styles.has(r.theme.gapBg)).toBe(true);
  });

  it('puts the gap run where the gaps actually are', () => {
    const pattern = 'A'.repeat(1000) + '-'.repeat(1000);
    const state = patternState([pattern, pattern]);
    r.setZoom(0.05);
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });

    const rowY = r.getSeqAreaTop(state);
    const gutter = r.getGutterWidth(state);
    const boundary = gutter + 1000 * r.cellWidth; // where the gaps begin
    const gapFills = r.drawn.rects.filter(
      t => t.y === rowY && t.h === CELL_H - 1 && t.style === r.theme.gapBg
    );
    expect(gapFills.length).toBeGreaterThan(0);
    for (const fill of gapFills) expect(fill.x).toBeGreaterThanOrEqual(boundary - 2);
  });

  it('still draws cells and letters above the threshold', () => {
    const state = stackedState(2, 40);
    r.setZoom(1);
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });
    expect(r.overviewMode).toBe(false);
    expect(r.drawn.glyphs.some(g => g.text === 'A')).toBe(true);
  });
});

describe('markers at extreme zoom-out', () => {
  it('keeps a column selection wide enough to see', () => {
    const state = patternState(['ACGT'.repeat(500), 'ACGT'.repeat(500)], {
      columnSelection: { start: 100, end: 101 }, // one column, 0.2px wide
    });
    r.setZoom(0.02);
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });

    const selection = r.drawn.rects.filter(t => t.style === r.theme.columnSelection);
    expect(selection.length).toBeGreaterThan(0);
    for (const rect of selection) expect(rect.w).toBeGreaterThanOrEqual(2);
  });

  it('keeps a search hit wide enough to see', () => {
    const state = patternState(['ACGT'.repeat(500), 'ACGT'.repeat(500)]);
    state.find = {
      matches: [{ docId: state.documents[0].id, start: 300, end: 301, strand: 1 }],
      activeIndex: 0,
    };
    r.setZoom(0.02);
    r.drawn.reset();
    r.render(state, { top: 0, left: 0 });

    const hits = r.drawn.rects.filter(t => t.style === r.theme.matchHighlightActive);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.w).toBeGreaterThanOrEqual(2);
  });
});

describe('fit to width', () => {
  it('reaches the zoom that puts a whole alignment in the window', () => {
    // The reference screenshot: 5,811 columns in a window this size.
    const state = patternState([
      'ACGT'.repeat(1453).slice(0, 5811),
      'ACGT'.repeat(1453).slice(0, 5811),
    ]);
    const fit = r.getFitZoom(state);

    // Around 1% — the figure Geneious shows for the same alignment.
    expect(fit).toBeGreaterThan(0.005);
    expect(fit).toBeLessThan(0.03);

    r.setZoom(fit);
    expect(r.overviewMode).toBe(true);
  });

  it('leaves nothing to scroll horizontally once fitted', () => {
    const state = patternState([
      'ACGT'.repeat(1453).slice(0, 5811),
      'ACGT'.repeat(1453).slice(0, 5811),
    ]);
    r.setZoom(r.getFitZoom(state));
    const { width } = r.getContentSize(state);
    // Within the right-hand padding the fit calculation reserves.
    expect(width).toBeLessThanOrEqual(r.width + 1);
  });
});

describe('overview coverage bars', () => {
  const WIDTH = 100;
  const TRACK_H = 20;

  function docsFrom(...raws) {
    return raws.map((raw, i) => createDocument(`seq${i}`, raw));
  }

  it('plots coverage per pixel column, tall where every row has a base', () => {
    const documents = docsFrom('ACGT'.repeat(50), 'ACGT'.repeat(50));
    const bars = r._minimapBars(documents, WIDTH, TRACK_H, 200);
    expect(bars.length).toBe(WIDTH);
    expect([...bars].every(h => h === TRACK_H)).toBe(true);
  });

  it('plots a short bar where the alignment is mostly gaps', () => {
    // First half all gaps, second half all bases.
    const documents = docsFrom('-'.repeat(100) + 'A'.repeat(100));
    const bars = r._minimapBars(documents, WIDTH, TRACK_H, 200);
    expect(bars[0]).toBeLessThan(TRACK_H);
    expect(bars[WIDTH - 1]).toBe(TRACK_H);
  });

  it('reuses the measurement while the sequences are unchanged', () => {
    const documents = docsFrom('ACGT'.repeat(50), 'ACGT'.repeat(50));
    const first = r._minimapBars(documents, WIDTH, TRACK_H, 200);
    // A new array with the same documents: what a selection or cursor move leaves.
    const second = r._minimapBars([...documents], WIDTH, TRACK_H, 200);
    expect(second).toBe(first);
  });

  it('re-measures when a sequence changes', () => {
    const documents = docsFrom('ACGT'.repeat(50), 'ACGT'.repeat(50));
    const first = r._minimapBars(documents, WIDTH, TRACK_H, 200);
    const edited = [documents[0], { ...documents[1], raw: '-'.repeat(200) }];
    const second = r._minimapBars(edited, WIDTH, TRACK_H, 200);
    expect(second).not.toBe(first);
    expect(second[0]).toBeLessThan(first[0]);
  });

  it('re-measures when a sequence is removed', () => {
    const documents = docsFrom('ACGT'.repeat(50), 'ACGT'.repeat(50));
    const first = r._minimapBars(documents, WIDTH, TRACK_H, 200);
    const second = r._minimapBars(documents.slice(0, 1), WIDTH, TRACK_H, 200);
    expect(second).not.toBe(first);
  });

  it('handles a fractional strip width, which is what a container reports', () => {
    const documents = docsFrom('ACGT'.repeat(50));
    const bars = r._minimapBars(documents, 100.4, TRACK_H, 200);
    // One bar per pixel, with the last covering the part-pixel.
    expect(bars.length).toBe(101);
  });

  it('re-measures when the strip is resized', () => {
    const documents = docsFrom('ACGT'.repeat(50));
    const first = r._minimapBars(documents, WIDTH, TRACK_H, 200);
    const second = r._minimapBars(documents, WIDTH + 40, TRACK_H, 200);
    expect(second).not.toBe(first);
    expect(second.length).toBe(WIDTH + 40);
  });
});

describe('name gutter measurement', () => {
  it('reuses the measured width while the names are unchanged', () => {
    const state = stackedState(6);
    const first = r.getGutterWidth(state);
    // Same names, new document objects: what an edit to a sequence produces.
    const moved = { ...state, documents: state.documents.map(d => ({ ...d })) };
    expect(r.getGutterWidth(moved)).toBe(first);
  });

  it('re-measures when a name changes', () => {
    const state = stackedState(6);
    r.getGutterWidth(state);
    const renamed = {
      ...state,
      documents: state.documents.map((d, i) =>
        i === 0 ? { ...d, name: 'a considerably longer sequence name than before' } : d
      ),
    };
    expect(r.getGutterWidth(renamed)).toBeGreaterThan(r.getGutterWidth(state));
  });
});
