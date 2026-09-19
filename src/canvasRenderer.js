// Canvas-based sequence renderer — the performance-critical core.
// Draws only visible rows. All layout is derived from measured font metrics.

import { IUPAC_MAP, TEXT_COLOR_MAP, complement } from './iupac.js';

// --- Style constants (from geneiousStyleRef.md) ---
const FONT_FAMILY = '"Courier New", "Consolas", "Liberation Mono", monospace';
const FONT_SIZE = 14;
const COMPLEMENT_FONT_SIZE = 12;
const CELL_PADDING = 6; // vertical padding added to font size
const ROW_GAP = 2;
const RULER_HEIGHT = 24;
const LEFT_MARGIN = 60; // gutter for position numbers
const RULER_TICK_INTERVAL = 10;
const RULER_TEXT_COLOR = '#8892B0';
const RULER_TICK_COLOR = '#4A5568';
const CANVAS_BG = '#0A0E17';
const SELECTION_COLOR = 'rgba(66, 135, 245, 0.35)';
const CURSOR_COLOR = '#FFFFFF';
const CURSOR_WIDTH = 2;

/**
 * CanvasRenderer: owns rendering logic for a <canvas> element.
 * Instantiated once per canvas; call render() on state change or scroll.
 */
export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    // Measure font metrics
    this.ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    const metrics = this.ctx.measureText('A');
    this.cellWidth = Math.ceil(metrics.width) + 2; // +2 for inter-char spacing
    this.cellHeight = FONT_SIZE + CELL_PADDING;

    // Complement row metrics
    this.complementCellHeight = COMPLEMENT_FONT_SIZE + CELL_PADDING - 2;

    // Cursor blink state
    this.cursorVisible = true;
    this.cursorBlinkTimer = null;
  }

  /**
   * Resize the canvas to fill its container, accounting for HiDPI.
   * @param {number} width - CSS width in pixels
   * @param {number} height - CSS height in pixels
   */
  resize(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Re-measure font after resize (context resets)
    this.ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  }

  /**
   * Compute how many bases fit per row given the current canvas width.
   * @param {number} lineWidth - explicit lineWidth from viewSettings (0 = auto)
   * @returns {number} bases per row
   */
  getBasesPerRow(lineWidth) {
    if (lineWidth > 0) return lineWidth;
    const availableWidth = (this.canvas.width / this.dpr) - LEFT_MARGIN - 10; // 10px right padding
    return Math.max(1, Math.floor(availableWidth / this.cellWidth));
  }

  /**
   * Compute the height of a single sequence row (with optional complement).
   * @param {boolean} showComplement
   * @returns {number} row height in pixels
   */
  getRowHeight(showComplement) {
    let h = RULER_HEIGHT + this.cellHeight;
    if (showComplement) {
      h += this.complementCellHeight;
    }
    return h + ROW_GAP;
  }

  /**
   * Get the total scrollable height for the entire sequence.
   * @param {string} raw - the sequence
   * @param {number} basesPerRow
   * @param {boolean} showComplement
   * @returns {number} total height in CSS pixels
   */
  getTotalHeight(raw, basesPerRow, showComplement) {
    const totalRows = Math.ceil(raw.length / basesPerRow);
    return totalRows * this.getRowHeight(showComplement) + ROW_GAP;
  }

  /**
   * Main render function. Draws the visible portion of the sequence.
   * @param {object} state - { raw, selection, cursorPos, viewSettings }
   * @param {number} scrollTop - current vertical scroll offset in CSS pixels
   */
  render(state, scrollTop) {
    const { raw, selection, cursorPos, viewSettings } = state;
    const { showComplement } = viewSettings;
    const ctx = this.ctx;
    const canvasWidth = this.canvas.width / this.dpr;
    const canvasHeight = this.canvas.height / this.dpr;
    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const rowHeight = this.getRowHeight(showComplement);

    // Clear
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (raw.length === 0) {
      // Empty state — draw placeholder
      ctx.fillStyle = RULER_TEXT_COLOR;
      ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText('Load a FASTA file to begin', canvasWidth / 2, canvasHeight / 2);
      ctx.textAlign = 'left';
      return;
    }

    // Compute visible row range
    const firstVisibleRow = Math.max(0, Math.floor(scrollTop / rowHeight));
    const lastVisibleRow = Math.min(
      Math.ceil(raw.length / basesPerRow) - 1,
      Math.ceil((scrollTop + canvasHeight) / rowHeight)
    );

    for (let row = firstVisibleRow; row <= lastVisibleRow; row++) {
      const rowY = row * rowHeight - scrollTop;
      const seqStart = row * basesPerRow;
      const seqEnd = Math.min(seqStart + basesPerRow, raw.length);

      // --- Ruler ---
      this._drawRuler(ctx, rowY, seqStart, seqEnd, basesPerRow);

      // --- Sequence bases ---
      const baseY = rowY + RULER_HEIGHT;
      this._drawBases(ctx, raw, seqStart, seqEnd, LEFT_MARGIN, baseY, false);

      // --- Complement row ---
      if (showComplement) {
        const compY = baseY + this.cellHeight;
        this._drawBases(ctx, raw, seqStart, seqEnd, LEFT_MARGIN, compY, true);
      }

      // --- Selection overlay ---
      if (selection) {
        this._drawSelection(ctx, selection, seqStart, seqEnd, LEFT_MARGIN, baseY, showComplement);
      }
    }

    // --- Cursor ---
    if (cursorPos !== undefined && cursorPos !== null) {
      this._drawCursor(ctx, cursorPos, basesPerRow, rowHeight, scrollTop, showComplement);
    }
  }

  /**
   * Draw the ruler row: position labels and tick marks.
   */
  _drawRuler(ctx, rowY, seqStart, seqEnd, basesPerRow) {
    const y = rowY;

    ctx.font = `11px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';

    // Draw row start position in the left gutter
    const startPos1 = seqStart + 1;
    ctx.fillStyle = RULER_TEXT_COLOR;
    ctx.textAlign = 'right';
    ctx.fillText(`${startPos1}`, LEFT_MARGIN - 6, y + 4);

    // Draw tick marks and labels along the row
    for (let i = seqStart; i < seqEnd; i++) {
      const col = i - seqStart;
      const x = LEFT_MARGIN + col * this.cellWidth;
      const pos1 = i + 1;

      if (pos1 % RULER_TICK_INTERVAL === 0) {
        // Tick mark
        ctx.strokeStyle = RULER_TICK_COLOR;
        ctx.beginPath();
        ctx.moveTo(x + this.cellWidth / 2, y + RULER_HEIGHT - 6);
        ctx.lineTo(x + this.cellWidth / 2, y + RULER_HEIGHT);
        ctx.stroke();

        // Position label (skip if too close to left gutter)
        if (col >= 4) {
          ctx.fillStyle = RULER_TEXT_COLOR;
          ctx.textAlign = 'center';
          ctx.fillText(`${pos1}`, x + this.cellWidth / 2, y + 4);
        }
      } else if (pos1 % 5 === 0) {
        // Small tick at every 5
        ctx.strokeStyle = RULER_TICK_COLOR;
        ctx.beginPath();
        ctx.moveTo(x + this.cellWidth / 2, y + RULER_HEIGHT - 3);
        ctx.lineTo(x + this.cellWidth / 2, y + RULER_HEIGHT);
        ctx.stroke();
      }
    }

    // Ruler baseline
    ctx.strokeStyle = RULER_TICK_COLOR;
    ctx.beginPath();
    ctx.moveTo(LEFT_MARGIN, y + RULER_HEIGHT);
    ctx.lineTo(LEFT_MARGIN + (seqEnd - seqStart) * this.cellWidth, y + RULER_HEIGHT);
    ctx.stroke();

    ctx.textAlign = 'left';
  }

  /**
   * Draw base cells: colored background rect + letter glyph.
   * @param {boolean} isComplement - if true, draw complement chars with dimmed style
   */
  _drawBases(ctx, raw, seqStart, seqEnd, xOffset, yOffset, isComplement) {
    const fontSize = isComplement ? COMPLEMENT_FONT_SIZE : FONT_SIZE;
    const cellH = isComplement ? this.complementCellHeight : this.cellHeight;
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';

    const prevAlpha = ctx.globalAlpha;
    if (isComplement) {
      ctx.globalAlpha = 0.5;
    }

    for (let i = seqStart; i < seqEnd; i++) {
      const col = i - seqStart;
      const x = xOffset + col * this.cellWidth;
      const char = isComplement ? (complement(raw[i]) || raw[i]) : raw[i];
      const info = IUPAC_MAP[char] || IUPAC_MAP['N'];
      const textColor = TEXT_COLOR_MAP[char] || '#FFFFFF';

      // Background
      ctx.fillStyle = info.color;
      ctx.fillRect(x, yOffset, this.cellWidth - 1, cellH - 1); // -1 for grid gap

      // Letter
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.fillText(char, x + this.cellWidth / 2, yOffset + cellH / 2);
    }

    ctx.globalAlpha = prevAlpha;
    ctx.textAlign = 'left';
  }

  /**
   * Draw selection overlay rectangles.
   */
  _drawSelection(ctx, selection, seqStart, seqEnd, xOffset, yOffset, showComplement) {
    const selStart = Math.max(selection.start, seqStart);
    const selEnd = Math.min(selection.end, seqEnd);

    if (selStart >= selEnd) return;

    const x = xOffset + (selStart - seqStart) * this.cellWidth;
    const width = (selEnd - selStart) * this.cellWidth;
    let height = this.cellHeight;
    if (showComplement) {
      height += this.complementCellHeight;
    }

    ctx.fillStyle = SELECTION_COLOR;
    ctx.fillRect(x, yOffset, width, height);
  }

  /**
   * Draw the insertion cursor.
   */
  _drawCursor(ctx, cursorPos, basesPerRow, rowHeight, scrollTop, showComplement) {
    if (!this.cursorVisible) return;

    const row = Math.floor(cursorPos / basesPerRow);
    const col = cursorPos % basesPerRow;
    const rowY = row * rowHeight - scrollTop;
    const x = LEFT_MARGIN + col * this.cellWidth;
    const y = rowY + RULER_HEIGHT;
    let height = this.cellHeight;
    if (showComplement) {
      height += this.complementCellHeight;
    }

    ctx.fillStyle = CURSOR_COLOR;
    ctx.fillRect(x - 1, y, CURSOR_WIDTH, height);
  }

  /**
   * Start cursor blink animation.
   */
  startCursorBlink() {
    this.stopCursorBlink();
    this.cursorVisible = true;
    this.cursorBlinkTimer = setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
    }, 530);
  }

  /**
   * Stop cursor blink animation.
   */
  stopCursorBlink() {
    if (this.cursorBlinkTimer) {
      clearInterval(this.cursorBlinkTimer);
      this.cursorBlinkTimer = null;
    }
    this.cursorVisible = true;
  }

  // --- Coordinate mapping ---

  /**
   * Convert a pixel (x, y) on the canvas to a sequence index.
   * @param {number} x - x coordinate (CSS pixels, relative to canvas)
   * @param {number} y - y coordinate (CSS pixels, relative to canvas)
   * @param {number} scrollTop - current scroll offset
   * @param {object} state - { raw, viewSettings }
   * @returns {number|null} sequence index, or null if out of bounds
   */
  pixelToIndex(x, y, scrollTop, state) {
    const { raw, viewSettings } = state;
    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const rowHeight = this.getRowHeight(viewSettings.showComplement);

    // Account for scroll
    const absY = y + scrollTop;
    const row = Math.floor(absY / rowHeight);
    const col = Math.floor((x - LEFT_MARGIN) / this.cellWidth);

    if (col < 0 || col >= basesPerRow) return null;

    const index = row * basesPerRow + col;
    if (index < 0 || index >= raw.length) return null;

    return index;
  }

  /**
   * Convert a sequence index to a pixel position (top-left of cell).
   * @param {number} index - sequence index
   * @param {number} scrollTop - current scroll offset
   * @param {object} state - { viewSettings }
   * @returns {{ x: number, y: number }}
   */
  indexToPixel(index, scrollTop, state) {
    const { viewSettings } = state;
    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const rowHeight = this.getRowHeight(viewSettings.showComplement);

    const row = Math.floor(index / basesPerRow);
    const col = index % basesPerRow;

    return {
      x: LEFT_MARGIN + col * this.cellWidth,
      y: row * rowHeight - scrollTop + RULER_HEIGHT,
    };
  }
}
