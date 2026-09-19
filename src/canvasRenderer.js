// Canvas-based sequence renderer — the performance-critical core.
// Draws only visible rows/columns. All layout is derived from measured font metrics.
//
// Two layout modes share this class:
//   single  — one document, wrapped across rows (the v1 view)
//   stacked — several documents, one unwrapped row each under a shared ruler,
//             with a name gutter on the left (Geneious alignment-view style)

import { getCharInfo, TEXT_COLOR_MAP, complement } from './iupac.js';
import { getTheme } from './theme.js';

// --- Style constants (from geneiousStyleRef.md) ---
const FONT_FAMILY = '"Courier New", "Consolas", "Liberation Mono", monospace';
const FONT_SIZE = 14;
const COMPLEMENT_FONT_SIZE = 12;
const NAME_FONT_SIZE = 12;
const RULER_FONT_SIZE = 11;
const CELL_PADDING = 6; // vertical padding added to font size
const ROW_GAP = 2;
const RULER_HEIGHT = 24;
const LEFT_MARGIN = 60; // single-mode gutter for position numbers
const RULER_TICK_INTERVAL = 10;
const CURSOR_WIDTH = 2;

// Stacked-mode name gutter
const NAME_GUTTER_MIN = 90;
const NAME_GUTTER_MAX = 220;
const NAME_PADDING = 10;
const RIGHT_PADDING = 20;

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.theme = getTheme('dark');

    this.ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    const metrics = this.ctx.measureText('A');
    this.cellWidth = Math.ceil(metrics.width) + 2; // +2 for inter-char spacing
    this.cellHeight = FONT_SIZE + CELL_PADDING;
    this.complementCellHeight = COMPLEMENT_FONT_SIZE + CELL_PADDING - 2;

    this.cursorVisible = true;
    this.cursorBlinkTimer = null;

    // Reused across frames so per-base drawing doesn't allocate (see _drawBases).
    this._bgBuckets = new Map();
    this._fgBuckets = new Map();
    this._gutterWidth = NAME_GUTTER_MIN;
  }

  setTheme(name) {
    this.theme = getTheme(name);
  }

  /**
   * Resize the canvas to fill its container, accounting for HiDPI.
   */
  resize(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  }

  get width() {
    return this.canvas.width / this.dpr;
  }

  get height() {
    return this.canvas.height / this.dpr;
  }

  isStacked(state) {
    return state.documents.length > 1;
  }

  /** Bases per row in single mode (lineWidth 0 = fit to canvas width). */
  getBasesPerRow(lineWidth) {
    if (lineWidth > 0) return lineWidth;
    const available = this.width - LEFT_MARGIN - 10;
    return Math.max(1, Math.floor(available / this.cellWidth));
  }

  /** Height of one sequence row (bases, plus complement strand if shown). */
  getRowHeight(showComplement) {
    let h = this.cellHeight;
    if (showComplement) h += this.complementCellHeight;
    return h + ROW_GAP;
  }

  /** Single-mode row height includes that row's own ruler. */
  getSingleRowHeight(showComplement) {
    return RULER_HEIGHT + this.getRowHeight(showComplement);
  }

  /** Width of the stacked-mode name gutter, sized to the longest name. */
  getGutterWidth(state) {
    const ctx = this.ctx;
    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    let widest = 0;
    for (const doc of state.documents) {
      const w = ctx.measureText(doc.name || 'Unnamed').width;
      if (w > widest) widest = w;
    }
    this._gutterWidth = Math.round(
      Math.min(NAME_GUTTER_MAX, Math.max(NAME_GUTTER_MIN, widest + NAME_PADDING * 2 + 10))
    );
    return this._gutterWidth;
  }

  /** Full scrollable content size, used to size the scroll container's spacer. */
  getContentSize(state) {
    const { documents, viewSettings } = state;
    if (documents.length === 0) return { width: 0, height: 0 };

    if (this.isStacked(state)) {
      const gutter = this.getGutterWidth(state);
      const maxLen = documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
      return {
        width: gutter + maxLen * this.cellWidth + RIGHT_PADDING,
        height: RULER_HEIGHT + documents.length * this.getRowHeight(viewSettings.showComplement) + ROW_GAP,
      };
    }

    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const rows = Math.ceil(documents[0].raw.length / basesPerRow);
    return {
      width: 0, // single mode wraps, so it never scrolls horizontally
      height: rows * this.getSingleRowHeight(viewSettings.showComplement) + ROW_GAP,
    };
  }

  // --- Rendering ---

  /**
   * @param {object} state - { documents, activeDocId, viewSettings, dragInsertIndex }
   * @param {{top: number, left: number}} scroll
   */
  render(state, scroll) {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.canvasBg;
    ctx.fillRect(0, 0, this.width, this.height);

    if (state.documents.length === 0) {
      ctx.fillStyle = this.theme.rulerText;
      ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Load a FASTA file to begin', this.width / 2, this.height / 2);
      ctx.textAlign = 'left';
      return;
    }

    if (this.isStacked(state)) {
      this._renderStacked(state, scroll);
    } else {
      this._renderSingle(state, scroll);
    }
  }

  /** v1 layout: one document wrapped across rows, each with its own ruler. */
  _renderSingle(state, scroll) {
    const ctx = this.ctx;
    const doc = state.documents[0];
    const { showComplement, lineWidth } = state.viewSettings;
    const basesPerRow = this.getBasesPerRow(lineWidth);
    const rowHeight = this.getSingleRowHeight(showComplement);
    const totalRows = Math.ceil(doc.raw.length / basesPerRow);

    const firstRow = Math.max(0, Math.floor(scroll.top / rowHeight));
    const lastRow = Math.min(totalRows - 1, Math.ceil((scroll.top + this.height) / rowHeight));

    for (let row = firstRow; row <= lastRow; row++) {
      const rowY = row * rowHeight - scroll.top;
      const seqStart = row * basesPerRow;
      const seqEnd = Math.min(seqStart + basesPerRow, doc.raw.length);
      const baseY = rowY + RULER_HEIGHT;
      const xAt = i => LEFT_MARGIN + (i - seqStart) * this.cellWidth;

      this._drawRowRuler(rowY, seqStart, seqEnd, xAt, LEFT_MARGIN);
      this._drawBases(doc.raw, seqStart, seqEnd, xAt, baseY, this.cellHeight, FONT_SIZE, false);
      if (showComplement) {
        this._drawBases(
          doc.raw, seqStart, seqEnd, xAt, baseY + this.cellHeight,
          this.complementCellHeight, COMPLEMENT_FONT_SIZE, true
        );
      }

      if (doc.selection) {
        const from = Math.max(doc.selection.start, seqStart);
        const to = Math.min(doc.selection.end, seqEnd);
        if (from < to) {
          ctx.fillStyle = this.theme.selection;
          ctx.fillRect(xAt(from), baseY, (to - from) * this.cellWidth, this.getRowHeight(showComplement) - ROW_GAP);
        }
      }

      if (this.cursorVisible && doc.cursorPos >= seqStart && doc.cursorPos <= seqEnd) {
        ctx.fillStyle = this.theme.cursor;
        ctx.fillRect(xAt(doc.cursorPos) - 1, baseY, CURSOR_WIDTH, this.getRowHeight(showComplement) - ROW_GAP);
      }

      if (state.dragInsertIndex !== null && state.dragInsertIndex >= seqStart && state.dragInsertIndex <= seqEnd) {
        ctx.fillStyle = this.theme.dropMarker;
        ctx.fillRect(xAt(state.dragInsertIndex) - 1, baseY, CURSOR_WIDTH, this.getRowHeight(showComplement) - ROW_GAP);
      }
    }
  }

  /** Alignment-view layout: one unwrapped row per document under a shared ruler. */
  _renderStacked(state, scroll) {
    const ctx = this.ctx;
    const { documents, activeDocId, viewSettings } = state;
    const { showComplement } = viewSettings;
    const gutter = this.getGutterWidth(state);
    this._gutterWidth = gutter;

    const rowHeight = this.getRowHeight(showComplement);
    const seqAreaHeight = this.height - RULER_HEIGHT;
    const firstRow = Math.max(0, Math.floor(scroll.top / rowHeight));
    const lastRow = Math.min(documents.length - 1, Math.floor((scroll.top + seqAreaHeight) / rowHeight));

    const firstCol = Math.max(0, Math.floor(scroll.left / this.cellWidth));
    const visibleCols = Math.ceil((this.width - gutter) / this.cellWidth) + 2;
    const xAt = i => gutter + i * this.cellWidth - scroll.left;

    // Sequence area, clipped so scrolled bases never paint over the gutter or ruler.
    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, RULER_HEIGHT, this.width - gutter, seqAreaHeight);
    ctx.clip();

    for (let row = firstRow; row <= lastRow; row++) {
      const doc = documents[row];
      const rowY = RULER_HEIGHT + row * rowHeight - scroll.top;
      const isActive = doc.id === activeDocId;
      const contentHeight = rowHeight - ROW_GAP;

      if (isActive) {
        ctx.fillStyle = this.theme.activeRowBg;
        ctx.fillRect(gutter, rowY, this.width - gutter, contentHeight);
      }

      const from = Math.min(firstCol, doc.raw.length);
      const to = Math.min(firstCol + visibleCols, doc.raw.length);
      this._drawBases(doc.raw, from, to, xAt, rowY, this.cellHeight, FONT_SIZE, false);
      if (showComplement) {
        this._drawBases(
          doc.raw, from, to, xAt, rowY + this.cellHeight,
          this.complementCellHeight, COMPLEMENT_FONT_SIZE, true
        );
      }

      if (isActive) {
        if (doc.selection) {
          ctx.fillStyle = this.theme.selection;
          ctx.fillRect(
            xAt(doc.selection.start), rowY,
            (doc.selection.end - doc.selection.start) * this.cellWidth, contentHeight
          );
        }
        if (this.cursorVisible && doc.cursorPos !== null) {
          ctx.fillStyle = this.theme.cursor;
          ctx.fillRect(xAt(doc.cursorPos) - 1, rowY, CURSOR_WIDTH, contentHeight);
        }
        if (state.dragInsertIndex !== null) {
          ctx.fillStyle = this.theme.dropMarker;
          ctx.fillRect(xAt(state.dragInsertIndex) - 1, rowY, CURSOR_WIDTH, contentHeight);
        }
      }
    }
    ctx.restore();

    this._drawNameGutter(state, scroll, gutter, firstRow, lastRow, rowHeight);
    this._drawSharedRuler(gutter, firstCol, firstCol + visibleCols, xAt);
  }

  _drawNameGutter(state, scroll, gutter, firstRow, lastRow, rowHeight) {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.gutterBg;
    ctx.fillRect(0, RULER_HEIGHT, gutter, this.height - RULER_HEIGHT);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_HEIGHT, gutter, this.height - RULER_HEIGHT);
    ctx.clip();

    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    for (let row = firstRow; row <= lastRow; row++) {
      const doc = state.documents[row];
      const rowY = RULER_HEIGHT + row * rowHeight - scroll.top;
      const isActive = doc.id === state.activeDocId;
      const centerY = rowY + (rowHeight - ROW_GAP) / 2;

      if (isActive) {
        ctx.fillStyle = this.theme.activeRowBg;
        ctx.fillRect(0, rowY, gutter, rowHeight - ROW_GAP);
      }

      let textX = NAME_PADDING;
      if (doc.dirty) {
        ctx.fillStyle = this.theme.dirtyMarker;
        ctx.beginPath();
        ctx.arc(NAME_PADDING + 2, centerY, 3, 0, Math.PI * 2);
        ctx.fill();
        textX = NAME_PADDING + 11;
      }

      ctx.fillStyle = isActive ? this.theme.nameTextActive : this.theme.nameText;
      ctx.fillText(
        this._truncate(doc.name || 'Unnamed', gutter - textX - NAME_PADDING),
        textX, centerY
      );
    }
    ctx.restore();

    ctx.strokeStyle = this.theme.gutterBorder;
    ctx.beginPath();
    ctx.moveTo(gutter + 0.5, RULER_HEIGHT);
    ctx.lineTo(gutter + 0.5, this.height);
    ctx.stroke();
  }

  _drawSharedRuler(gutter, firstCol, lastCol, xAt) {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.canvasBg;
    ctx.fillRect(0, 0, this.width, RULER_HEIGHT);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, 0, this.width - gutter, RULER_HEIGHT);
    ctx.clip();

    ctx.font = `${RULER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';

    for (let i = firstCol; i <= lastCol; i++) {
      const pos1 = i + 1;
      const x = xAt(i);
      if (pos1 % RULER_TICK_INTERVAL === 0) {
        ctx.strokeStyle = this.theme.rulerTick;
        ctx.beginPath();
        ctx.moveTo(x + this.cellWidth / 2, RULER_HEIGHT - 6);
        ctx.lineTo(x + this.cellWidth / 2, RULER_HEIGHT);
        ctx.stroke();

        ctx.fillStyle = this.theme.rulerText;
        ctx.textAlign = 'center';
        ctx.fillText(`${pos1}`, x + this.cellWidth / 2, 4);
      } else if (pos1 % 5 === 0) {
        ctx.strokeStyle = this.theme.rulerTick;
        ctx.beginPath();
        ctx.moveTo(x + this.cellWidth / 2, RULER_HEIGHT - 3);
        ctx.lineTo(x + this.cellWidth / 2, RULER_HEIGHT);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.strokeStyle = this.theme.rulerTick;
    ctx.beginPath();
    ctx.moveTo(gutter, RULER_HEIGHT - 0.5);
    ctx.lineTo(this.width, RULER_HEIGHT - 0.5);
    ctx.stroke();
    ctx.textAlign = 'left';
  }

  /** Per-row ruler used by single mode: position label in the gutter, ticks along the row. */
  _drawRowRuler(rowY, seqStart, seqEnd, xAt, leftMargin) {
    const ctx = this.ctx;
    ctx.font = `${RULER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';

    ctx.fillStyle = this.theme.rulerText;
    ctx.textAlign = 'right';
    ctx.fillText(`${seqStart + 1}`, leftMargin - 6, rowY + 4);

    for (let i = seqStart; i < seqEnd; i++) {
      const pos1 = i + 1;
      const x = xAt(i);
      if (pos1 % RULER_TICK_INTERVAL === 0) {
        ctx.strokeStyle = this.theme.rulerTick;
        ctx.beginPath();
        ctx.moveTo(x + this.cellWidth / 2, rowY + RULER_HEIGHT - 6);
        ctx.lineTo(x + this.cellWidth / 2, rowY + RULER_HEIGHT);
        ctx.stroke();

        if (i - seqStart >= 4) {
          ctx.fillStyle = this.theme.rulerText;
          ctx.textAlign = 'center';
          ctx.fillText(`${pos1}`, x + this.cellWidth / 2, rowY + 4);
        }
      } else if (pos1 % 5 === 0) {
        ctx.strokeStyle = this.theme.rulerTick;
        ctx.beginPath();
        ctx.moveTo(x + this.cellWidth / 2, rowY + RULER_HEIGHT - 3);
        ctx.lineTo(x + this.cellWidth / 2, rowY + RULER_HEIGHT);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = this.theme.rulerTick;
    ctx.beginPath();
    ctx.moveTo(leftMargin, rowY + RULER_HEIGHT - 0.5);
    ctx.lineTo(xAt(seqEnd), rowY + RULER_HEIGHT - 0.5);
    ctx.stroke();
    ctx.textAlign = 'left';
  }

  /**
   * Draw a run of base cells: colored background rect + letter glyph.
   * Cells are bucketed by color and drawn in two passes, because switching
   * ctx.fillStyle per base — not the fills themselves — dominates the frame cost
   * once many rows are on screen.
   */
  _drawBases(seq, from, to, xAt, y, cellH, fontSize, isComplement) {
    if (from >= to) return;
    const ctx = this.ctx;
    const bg = this._bgBuckets;
    const fg = this._fgBuckets;
    for (const arr of bg.values()) arr.length = 0;
    for (const arr of fg.values()) arr.length = 0;

    for (let i = from; i < to; i++) {
      const ch = isComplement ? (complement(seq[i]) ?? seq[i]) : seq[i];
      const info = getCharInfo(ch);
      const bgColor = info.isGap ? this.theme.gapBg : info.color;
      const fgColor = info.isGap ? this.theme.gapText : (TEXT_COLOR_MAP[ch] ?? '#FFFFFF');
      const x = xAt(i);

      let bucket = bg.get(bgColor);
      if (!bucket) { bucket = []; bg.set(bgColor, bucket); }
      bucket.push(x);

      let glyphs = fg.get(fgColor);
      if (!glyphs) { glyphs = []; fg.set(fgColor, glyphs); }
      glyphs.push(x, ch);
    }

    const prevAlpha = ctx.globalAlpha;
    if (isComplement) ctx.globalAlpha = 0.5;

    const cellW = this.cellWidth - 1;
    const rectH = cellH - 1;
    for (const [color, xs] of bg) {
      ctx.fillStyle = color;
      for (let k = 0; k < xs.length; k++) ctx.fillRect(xs[k], y, cellW, rectH);
    }

    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const glyphY = y + cellH / 2;
    for (const [color, glyphs] of fg) {
      ctx.fillStyle = color;
      for (let k = 0; k < glyphs.length; k += 2) {
        ctx.fillText(glyphs[k + 1], glyphs[k] + this.cellWidth / 2, glyphY);
      }
    }

    ctx.globalAlpha = prevAlpha;
    ctx.textAlign = 'left';
  }

  _truncate(text, maxWidth) {
    const ctx = this.ctx;
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return `${truncated}…`;
  }

  // --- Cursor blink ---

  startCursorBlink() {
    this.stopCursorBlink();
    this.cursorVisible = true;
    this.cursorBlinkTimer = setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
    }, 530);
  }

  stopCursorBlink() {
    if (this.cursorBlinkTimer) {
      clearInterval(this.cursorBlinkTimer);
      this.cursorBlinkTimer = null;
    }
    this.cursorVisible = true;
  }

  // --- Coordinate mapping ---

  /**
   * Resolve a canvas pixel to a document and sequence index.
   * Indices are clamped rather than rejected so dragging past an edge still extends
   * the selection. Returns index === null for a name-gutter hit (row focus only).
   * @returns {{docId: string, index: number|null}|null}
   */
  hitTest(x, y, scroll, state) {
    const { documents, viewSettings } = state;
    if (documents.length === 0) return null;

    if (this.isStacked(state)) {
      if (y < RULER_HEIGHT) return null;
      const rowHeight = this.getRowHeight(viewSettings.showComplement);
      const row = Math.floor((y - RULER_HEIGHT + scroll.top) / rowHeight);
      if (row < 0 || row >= documents.length) return null;

      const doc = documents[row];
      const gutter = this._gutterWidth;
      if (x < gutter) return { docId: doc.id, index: null };

      const col = Math.round((x - gutter + scroll.left) / this.cellWidth);
      return { docId: doc.id, index: Math.max(0, Math.min(doc.raw.length, col)) };
    }

    const doc = documents[0];
    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const rowHeight = this.getSingleRowHeight(viewSettings.showComplement);
    const row = Math.max(0, Math.floor((y + scroll.top) / rowHeight));
    const col = Math.max(0, Math.min(basesPerRow, Math.round((x - LEFT_MARGIN) / this.cellWidth)));
    const index = Math.max(0, Math.min(doc.raw.length, row * basesPerRow + col));
    return { docId: doc.id, index };
  }

  /**
   * Top-left pixel of a sequence index, for hover hit-testing of selection edges.
   * @returns {{x: number, y: number, height: number}|null}
   */
  indexToPixel(index, scroll, state, docId) {
    const { documents, viewSettings } = state;
    if (documents.length === 0) return null;
    const contentHeight = this.getRowHeight(viewSettings.showComplement) - ROW_GAP;

    if (this.isStacked(state)) {
      const row = documents.findIndex(d => d.id === docId);
      if (row === -1) return null;
      const rowHeight = this.getRowHeight(viewSettings.showComplement);
      return {
        x: this._gutterWidth + index * this.cellWidth - scroll.left,
        y: RULER_HEIGHT + row * rowHeight - scroll.top,
        height: contentHeight,
      };
    }

    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const rowHeight = this.getSingleRowHeight(viewSettings.showComplement);
    return {
      x: LEFT_MARGIN + (index % basesPerRow) * this.cellWidth,
      y: Math.floor(index / basesPerRow) * rowHeight - scroll.top + RULER_HEIGHT,
      height: contentHeight,
    };
  }
}
