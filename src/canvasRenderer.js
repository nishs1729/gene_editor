// Canvas-based sequence renderer — the performance-critical core.
// Draws only visible rows/columns. All layout is derived from measured font metrics.
//
// Two layout modes share this class:
//   single  — one document, wrapped across rows (the v1 view)
//   stacked — several documents, one unwrapped row each under a shared ruler,
//             with a name gutter on the left (Geneious alignment-view style)

import { getCharInfo, TEXT_COLOR_MAP, complement, IUPAC_MAP } from './iupac.js';
import { getConsensusColumn } from './sequenceModel.js';
import { getTheme } from './theme.js';

// --- Style constants (from geneiousStyleRef.md) ---
// System sans-serif stack: San Francisco on Mac, Segoe UI on Windows, Roboto on
// Linux/Android — no web font request, so it loads with zero network latency and
// keeps the "system" font-family philosophy the old monospace choice was made
// under. Sans-serif is proportional, so cell width can no longer come from one
// glyph's measurement — see the widest-glyph sizing in _applyMetrics.
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Every character the grid ever has to draw in a base cell. The widest of these
// sets the fixed column width, so no glyph — in any base's IUPAC letter — can
// overflow the cell next to it.
const GLYPH_CHARS = Object.keys(IUPAC_MAP).join('');
const FONT_SIZE = 14;
const COMPLEMENT_FONT_SIZE = 12;
const NAME_FONT_SIZE = 12;
const RULER_FONT_SIZE = 11;
const CELL_PADDING = 6; // vertical padding added to font size
const CELL_SPACING = 2; // horizontal breathing room between base cells
// Zooming out past this leaves a glyph too small to read, so narrow columns drop
// their letters and show colour alone — the overview of an alignment's shape.
const MIN_GLYPH_FONT = 7;
const MIN_CELL_WIDTH = 2;
const ROW_GAP = 2;
const RULER_HEIGHT = 24;
const LEFT_MARGIN = 60; // single-mode gutter for position numbers
const CURSOR_WIDTH = 2;
// Ruler labels step up through these as columns narrow, so the numbers never
// collide however far the view is zoomed out.
const RULER_INTERVALS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const MIN_LABEL_GAP = 55; // px between ruler labels before the interval steps up
const MIN_MINOR_TICK_GAP = 20;

// Stacked-mode name gutter
const NAME_GUTTER_MIN = 90;
const NAME_GUTTER_MAX = 220;
const GUTTER_EDGE_PX = 4; // grab zone on the divider, either side
const NAME_PADDING = 10;
const RIGHT_PADDING = 20;
const SELECTION_BAR_WIDTH = 3; // accent bar marking a selected row in the gutter
const COLUMN_CURSOR_WIDTH = 2;
// The consensus is a different kind of row from the sequences below it, so it gets
// a rule heavy enough to read as a boundary rather than as another row gap.
const CONSENSUS_SEPARATOR = 4;

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.theme = getTheme('dark');
    this.zoom = 1;
    this._applyMetrics();

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

  /** @param {number} zoom - scale on the column width; 1 is one glyph wide. */
  setZoom(zoom) {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this._applyMetrics();
  }

  /**
   * Re-derive the metrics from the current zoom. Zoom is horizontal only: it
   * stretches the base columns and nothing else, so row heights, the name gutter
   * and the ruler stay put and the view never moves vertically as it scales.
   */
  _applyMetrics() {
    this.ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    const glyphWidth = this._widestGlyphWidth();

    this.cellWidth = Math.max(MIN_CELL_WIDTH, Math.ceil((glyphWidth + CELL_SPACING) * this.zoom));
    // The 1px seam is what separates cells at a readable size; on a 3px column it
    // would eat a third of the colour, so narrow columns are drawn solid.
    this.cellDrawWidth = this.cellWidth > 4 ? this.cellWidth - 1 : this.cellWidth;
    this.cellHeight = FONT_SIZE + CELL_PADDING;
    this.complementCellHeight = COMPLEMENT_FONT_SIZE + CELL_PADDING - 2;

    this.fontSize = this._fitFont(FONT_SIZE, glyphWidth);
    this.complementFontSize = this._fitFont(COMPLEMENT_FONT_SIZE, glyphWidth);
  }

  /** Width of the widest character a base cell ever draws, at `ctx.font`'s current size. */
  _widestGlyphWidth() {
    let max = 0;
    for (const ch of GLYPH_CHARS) {
      const w = this.ctx.measureText(ch).width;
      if (w > max) max = w;
    }
    return max;
  }

  /**
   * The largest size up to `preferred` whose glyph still fits the column, or 0
   * when even the smallest readable glyph does not — letters are dropped rather
   * than drawn as smudges. Letters never grow past `preferred`: that would be
   * vertical zoom.
   */
  _fitFont(preferred, glyphWidth) {
    const fits = Math.floor((this.cellWidth - 1) * FONT_SIZE / glyphWidth);
    if (fits >= preferred) return preferred;
    return fits >= MIN_GLYPH_FONT ? fits : 0;
  }

  /** Ruler label interval that keeps the numbers apart at this column width. */
  getRulerInterval() {
    return RULER_INTERVALS.find(i => i * this.cellWidth >= MIN_LABEL_GAP)
      ?? RULER_INTERVALS[RULER_INTERVALS.length - 1];
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

  /**
   * Width of the row-number column, sized to the highest number so the names
   * below it all start at the same x.
   */
  getNumberWidth(count) {
    const ctx = this.ctx;
    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    return Math.ceil(ctx.measureText(`${count}.`).width) + 6;
  }

  /**
   * Width of the stacked-mode name gutter: the width the divider was dragged to,
   * or one sized to the longest name while it has never been dragged.
   */
  getGutterWidth(state) {
    const dragged = state.viewSettings.nameGutterWidth;
    if (dragged != null) {
      this._gutterWidth = Math.round(dragged);
      return this._gutterWidth;
    }

    const ctx = this.ctx;
    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    let widest = 0;
    for (const doc of state.documents) {
      const w = ctx.measureText(doc.name || 'Unnamed').width;
      if (w > widest) widest = w;
    }
    const needed = NAME_PADDING + this.getNumberWidth(state.documents.length) + widest + NAME_PADDING;
    this._gutterWidth = Math.round(
      Math.min(NAME_GUTTER_MAX, Math.max(NAME_GUTTER_MIN, needed))
    );
    return this._gutterWidth;
  }

  /** Y at which the (vertically scrolling) sequence rows begin, below the ruler and the pinned consensus row. */
  getSeqAreaTop(state) {
    const showConsensus = this.isStacked(state) && state.viewSettings.showConsensus;
    return RULER_HEIGHT + (showConsensus ? this.cellHeight + ROW_GAP + CONSENSUS_SEPARATOR : 0);
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
        height: this.getSeqAreaTop(state) + documents.length * this.getRowHeight(viewSettings.showComplement) + ROW_GAP,
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
      this._drawBases(doc.raw, seqStart, seqEnd, xAt, baseY, this.cellHeight, this.fontSize, false);
      if (showComplement) {
        this._drawBases(
          doc.raw, seqStart, seqEnd, xAt, baseY + this.cellHeight,
          this.complementCellHeight, this.complementFontSize, true
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
    const { documents, activeDocId, viewSettings, columnCursor } = state;
    const selectedDocIds = state.selectedDocIds ?? new Set();
    const { showComplement, showConsensus, highlightMode } = viewSettings;
    const gutter = this.getGutterWidth(state);
    this._gutterWidth = gutter;

    const seqAreaTop = this.getSeqAreaTop(state);
    const rowHeight = this.getRowHeight(showComplement);
    const seqAreaHeight = this.height - seqAreaTop;
    const firstRow = Math.max(0, Math.floor(scroll.top / rowHeight));
    const lastRow = Math.min(documents.length - 1, Math.floor((scroll.top + seqAreaHeight) / rowHeight));

    const firstCol = Math.max(0, Math.floor(scroll.left / this.cellWidth));
    const visibleCols = Math.ceil((this.width - gutter) / this.cellWidth) + 2;
    const xAt = i => gutter + i * this.cellWidth - scroll.left;

    const maxLen = documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
    const lastCol = Math.min(firstCol + visibleCols, maxLen);

    // The consensus for the visible window is computed once per frame and shared
    // by the consensus row and by "disagreements to consensus" highlighting.
    let consensusWindow = null;
    if (showConsensus || highlightMode === 'consensus') {
      consensusWindow = [];
      for (let i = firstCol; i < lastCol; i++) {
        consensusWindow.push(getConsensusColumn(documents, i, viewSettings.consensusThreshold).char);
      }
    }

    // `compareAt` yields the character each row's base is judged against; the row
    // that *is* the comparison is left fully colored rather than greyed out whole.
    let compareAt = null;
    let referenceId = null;
    if (highlightMode === 'consensus') {
      compareAt = i => consensusWindow[i - firstCol];
    } else if (highlightMode === 'reference') {
      const ref = documents.find(d => d.id === viewSettings.referenceDocId) ?? documents[0];
      referenceId = ref.id;
      compareAt = i => ref.raw[i];
    }

    // Sequence area, clipped so scrolled bases never paint over the gutter or ruler.
    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, seqAreaTop, this.width - gutter, seqAreaHeight);
    ctx.clip();

    for (let row = firstRow; row <= lastRow; row++) {
      const doc = documents[row];
      const rowY = seqAreaTop + row * rowHeight - scroll.top;
      const isActive = doc.id === activeDocId;
      const contentHeight = rowHeight - ROW_GAP;

      if (isActive) {
        ctx.fillStyle = this.theme.activeRowBg;
        ctx.fillRect(gutter, rowY, this.width - gutter, contentHeight);
      }

      const from = Math.min(firstCol, doc.raw.length);
      const to = Math.min(firstCol + visibleCols, doc.raw.length);
      const rowCompare = doc.id === referenceId ? null : compareAt;
      this._drawBases(doc.raw, from, to, xAt, rowY, this.cellHeight, this.fontSize, false, rowCompare);
      if (showComplement) {
        this._drawBases(
          doc.raw, from, to, xAt, rowY + this.cellHeight,
          this.complementCellHeight, this.complementFontSize, true, rowCompare
        );
      }

      // Drawn over the bases, not under them: the cells are opaque, so a tint
      // beneath would only show through the 1px seams between them.
      if (selectedDocIds.has(doc.id)) {
        ctx.fillStyle = this.theme.selectedRowOverlay;
        ctx.fillRect(gutter, rowY, this.width - gutter, contentHeight);
      }

      if (isActive) {
        if (doc.selection) {
          ctx.fillStyle = this.theme.selection;
          ctx.fillRect(
            xAt(doc.selection.start), rowY,
            (doc.selection.end - doc.selection.start) * this.cellWidth, contentHeight
          );
        }
        if (columnCursor === null && this.cursorVisible && doc.cursorPos !== null) {
          ctx.fillStyle = this.theme.cursor;
          ctx.fillRect(xAt(doc.cursorPos) - 1, rowY, CURSOR_WIDTH, contentHeight);
        }
        if (state.dragInsertIndex !== null) {
          ctx.fillStyle = this.theme.dropMarker;
          ctx.fillRect(xAt(state.dragInsertIndex) - 1, rowY, CURSOR_WIDTH, contentHeight);
        }
      }
    }

    // Column cursor spans every visible row — it edits all of them, not just the active one.
    // Steady, not blinking: it marks a locus across every row rather than an
    // insertion caret in one of them.
    if (columnCursor !== null) {
      ctx.fillStyle = this.theme.columnCursor;
      ctx.fillRect(xAt(columnCursor) - 1, seqAreaTop, COLUMN_CURSOR_WIDTH, seqAreaHeight);
    }
    ctx.restore();

    if (showConsensus) this._drawConsensusRow(gutter, firstCol, xAt, consensusWindow);
    this._drawNameGutter(state, scroll, gutter, firstRow, lastRow, rowHeight, seqAreaTop);
    this._drawSharedRuler(gutter, firstCol, firstCol + visibleCols, xAt, columnCursor);
  }

  /** A 9th, non-editable row pinned just below the ruler: the majority call per column. */
  _drawConsensusRow(gutter, firstCol, xAt, consensusWindow) {
    const ctx = this.ctx;
    const rowY = RULER_HEIGHT;
    const rowH = this.cellHeight;

    ctx.fillStyle = this.theme.consensusBg;
    ctx.fillRect(0, rowY, this.width, rowH + ROW_GAP - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, rowY, this.width - gutter, rowH);
    ctx.clip();

    const consensus = consensusWindow.join('');
    this._drawBases(consensus, 0, consensus.length, i => xAt(firstCol + i), rowY, rowH, this.fontSize, false);
    ctx.restore();

    // Spans the gutter too, so the consensus reads as a banded header across the
    // whole view rather than as the first of the sequence rows.
    ctx.fillStyle = this.theme.consensusBorder;
    ctx.fillRect(0, rowY + rowH + ROW_GAP, this.width, CONSENSUS_SEPARATOR);
  }

  _drawNameGutter(state, scroll, gutter, firstRow, lastRow, rowHeight, seqAreaTop) {
    const ctx = this.ctx;
    const selectedDocIds = state.selectedDocIds ?? new Set();
    ctx.fillStyle = this.theme.gutterBg;
    ctx.fillRect(0, seqAreaTop, gutter, this.height - seqAreaTop);
    if (state.viewSettings.showConsensus) {
      ctx.fillStyle = this.theme.consensusBg;
      // Stops short of the separator rule, which is drawn across the full width.
      ctx.fillRect(0, RULER_HEIGHT, gutter, this.cellHeight + ROW_GAP);
      ctx.fillStyle = this.theme.nameText;
      ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('Consensus', NAME_PADDING, RULER_HEIGHT + this.cellHeight / 2);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, seqAreaTop, gutter, this.height - seqAreaTop);
    ctx.clip();

    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const numberWidth = this.getNumberWidth(state.documents.length);

    for (let row = firstRow; row <= lastRow; row++) {
      const doc = state.documents[row];
      const rowY = seqAreaTop + row * rowHeight - scroll.top;
      const isActive = doc.id === state.activeDocId;
      const isSelected = selectedDocIds.has(doc.id);
      const isReference = doc.id === state.viewSettings.referenceDocId;
      const centerY = rowY + (rowHeight - ROW_GAP) / 2;

      // Selection reads as a highlighted row, with an accent bar at the left edge
      // so it stays distinguishable from the (lighter) active-row tint. It outranks
      // the reference wash because it is the transient state the user is acting on —
      // setting a reference clears the selection, so the wash appears immediately after.
      if (isSelected) {
        ctx.fillStyle = this.theme.selectedRowBg;
        ctx.fillRect(0, rowY, gutter, rowHeight - ROW_GAP);
        ctx.fillStyle = this.theme.selectedRowBar;
        ctx.fillRect(0, rowY, SELECTION_BAR_WIDTH, rowHeight - ROW_GAP);
      } else if (isReference) {
        ctx.fillStyle = this.theme.referenceNameBg;
        ctx.fillRect(0, rowY, gutter, rowHeight - ROW_GAP);
      } else if (isActive) {
        ctx.fillStyle = this.theme.activeRowBg;
        ctx.fillRect(0, rowY, gutter, rowHeight - ROW_GAP);
      }

      // Row number, dimmed and in its own fixed-width column so the names align.
      ctx.fillStyle = this.theme.rowNumber;
      ctx.fillText(`${row + 1}.`, NAME_PADDING, centerY);

      let textX = NAME_PADDING + numberWidth;
      if (doc.dirty) {
        ctx.fillStyle = this.theme.dirtyMarker;
        ctx.beginPath();
        ctx.arc(textX + 2, centerY, 3, 0, Math.PI * 2);
        ctx.fill();
        textX += 11;
      }

      ctx.fillStyle = isActive ? this.theme.nameTextActive : this.theme.nameText;
      ctx.fillText(
        this._truncate(doc.name || 'Unnamed', gutter - textX - NAME_PADDING),
        textX, centerY
      );
    }
    ctx.restore();

    // Break the vertical border around the separator band so the thick rule reads
    // as one unbroken line across the view.
    ctx.strokeStyle = this.theme.gutterBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (state.viewSettings.showConsensus) {
      ctx.moveTo(gutter + 0.5, RULER_HEIGHT);
      ctx.lineTo(gutter + 0.5, seqAreaTop - CONSENSUS_SEPARATOR);
      ctx.moveTo(gutter + 0.5, seqAreaTop);
    } else {
      ctx.moveTo(gutter + 0.5, RULER_HEIGHT);
    }
    ctx.lineTo(gutter + 0.5, this.height);
    ctx.stroke();
  }

  _drawSharedRuler(gutter, firstCol, lastCol, xAt, columnCursor) {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.canvasBg;
    ctx.fillRect(0, 0, this.width, RULER_HEIGHT);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, 0, this.width - gutter, RULER_HEIGHT);
    ctx.clip();

    ctx.font = `${RULER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';

    const interval = this.getRulerInterval();
    const minorInterval = interval / 2;
    const showMinor = minorInterval * this.cellWidth >= MIN_MINOR_TICK_GAP;

    for (let i = firstCol; i <= lastCol; i++) {
      const pos1 = i + 1;
      const x = xAt(i);
      if (pos1 % interval === 0) {
        ctx.strokeStyle = this.theme.rulerTick;
        ctx.beginPath();
        ctx.moveTo(x + this.cellWidth / 2, RULER_HEIGHT - 6);
        ctx.lineTo(x + this.cellWidth / 2, RULER_HEIGHT);
        ctx.stroke();

        ctx.fillStyle = this.theme.rulerText;
        ctx.textAlign = 'center';
        ctx.fillText(`${pos1}`, x + this.cellWidth / 2, 4);
      } else if (showMinor && pos1 % minorInterval === 0) {
        ctx.strokeStyle = this.theme.rulerTick;
        ctx.beginPath();
        ctx.moveTo(x + this.cellWidth / 2, RULER_HEIGHT - 3);
        ctx.lineTo(x + this.cellWidth / 2, RULER_HEIGHT);
        ctx.stroke();
      }
    }

    if (columnCursor !== null) {
      const x = xAt(columnCursor);
      ctx.fillStyle = this.theme.columnCursor;
      ctx.fillRect(x, 0, this.cellWidth, RULER_HEIGHT);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(`${columnCursor + 1}`, x + this.cellWidth / 2, 4);
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

    const interval = this.getRulerInterval();
    const minorInterval = interval / 2;
    const showMinor = minorInterval * this.cellWidth >= MIN_MINOR_TICK_GAP;

    for (let i = seqStart; i < seqEnd; i++) {
      const pos1 = i + 1;
      const x = xAt(i);
      if (pos1 % interval === 0) {
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
      } else if (showMinor && pos1 % minorInterval === 0) {
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
  _drawBases(seq, from, to, xAt, y, cellH, fontSize, isComplement, compareAt = null) {
    if (from >= to) return;
    const ctx = this.ctx;
    const bg = this._bgBuckets;
    const fg = this._fgBuckets;
    // A zoomed-out column has no room for a letter; it is drawn as colour alone.
    const withText = fontSize > 0;
    for (const arr of bg.values()) arr.length = 0;
    for (const arr of fg.values()) arr.length = 0;

    for (let i = from; i < to; i++) {
      const ch = isComplement ? (complement(seq[i]) ?? seq[i]) : seq[i];
      const info = getCharInfo(ch);
      // Highlighting compares the underlying base, not the complement glyph, so
      // the two strands of a row agree or disagree together.
      const agrees = compareAt !== null && seq[i] === compareAt(i);
      // An agreeing cell gets no background at all rather than a grey one, so the
      // active-row tint and the canvas keep showing through, as in Geneious.
      const bgColor = agrees ? null : (info.isGap ? this.theme.gapBg : info.color);
      const fgColor = agrees
        ? this.theme.agreementText
        : (info.isGap ? this.theme.gapText : (TEXT_COLOR_MAP[ch] ?? '#FFFFFF'));
      const x = xAt(i);

      if (bgColor !== null) {
        let bucket = bg.get(bgColor);
        if (!bucket) { bucket = []; bg.set(bgColor, bucket); }
        bucket.push(x);
      }

      if (withText) {
        let glyphs = fg.get(fgColor);
        if (!glyphs) { glyphs = []; fg.set(fgColor, glyphs); }
        glyphs.push(x, ch);
      }
    }

    const prevAlpha = ctx.globalAlpha;
    if (isComplement) ctx.globalAlpha = 0.5;

    const cellW = this.cellDrawWidth;
    const rectH = cellH - 1;
    for (const [color, xs] of bg) {
      ctx.fillStyle = color;
      for (let k = 0; k < xs.length; k++) ctx.fillRect(xs[k], y, cellW, rectH);
    }

    if (withText) {
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
   * Resolve a canvas pixel to a hit. In stacked mode this is one of:
   *   - { kind: 'gutterEdge' } — the divider at the right of the name gutter
   *   - { kind: 'ruler', index } — the shared ruler, for placing a column cursor
   *   - { kind: 'name', docId } — a row's name, in the gutter
   *   - { kind: 'seq', docId, index } — a sequence cell
   * Single mode always returns { kind: 'seq', docId, index }.
   * Indices are clamped rather than rejected so dragging past an edge still extends
   * the selection.
   */
  hitTest(x, y, scroll, state) {
    const { documents, viewSettings } = state;
    if (documents.length === 0) return null;

    if (this.isStacked(state)) {
      const gutter = this._gutterWidth;
      // The divider is grabbable along its whole length, the ruler included, and
      // outranks what lies under it: a few pixels of name or base are no loss.
      if (Math.abs(x - gutter) <= GUTTER_EDGE_PX) return { kind: 'gutterEdge' };
      if (y < RULER_HEIGHT) {
        if (x < gutter) return null;
        const maxLen = documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
        const col = Math.round((x - gutter + scroll.left) / this.cellWidth);
        return { kind: 'ruler', index: Math.max(0, Math.min(maxLen - 1, col)) };
      }

      const seqAreaTop = this.getSeqAreaTop(state);
      if (y < seqAreaTop) return null; // consensus row: not interactive

      const rowHeight = this.getRowHeight(viewSettings.showComplement);
      const row = Math.floor((y - seqAreaTop + scroll.top) / rowHeight);
      if (row < 0 || row >= documents.length) return null;

      const doc = documents[row];
      if (x < gutter) return { kind: 'name', docId: doc.id };

      const col = Math.round((x - gutter + scroll.left) / this.cellWidth);
      return { kind: 'seq', docId: doc.id, index: Math.max(0, Math.min(doc.raw.length, col)) };
    }

    const doc = documents[0];
    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const rowHeight = this.getSingleRowHeight(viewSettings.showComplement);
    const row = Math.max(0, Math.floor((y + scroll.top) / rowHeight));
    const col = Math.max(0, Math.min(basesPerRow, Math.round((x - LEFT_MARGIN) / this.cellWidth)));
    const index = Math.max(0, Math.min(doc.raw.length, row * basesPerRow + col));
    return { kind: 'seq', docId: doc.id, index };
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
        y: this.getSeqAreaTop(state) + row * rowHeight - scroll.top,
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

  // --- Zoom ---

  /**
   * Record what sits under a canvas point in content units (fractional column and
   * row) that survive a zoom, so `getScrollForAnchor` can put it back under the
   * same pixel once the metrics change. Points over the gutter or ruler clamp into
   * the sequence area, so zooming works with the pointer anywhere on the canvas.
   * @returns {object} an opaque anchor for `getScrollForAnchor`
   */
  getZoomAnchor(x, y, scroll, state) {
    const { viewSettings } = state;

    if (this.isStacked(state)) {
      const gutter = this.getGutterWidth(state);
      const seqAreaTop = this.getSeqAreaTop(state);
      const px = Math.max(x, gutter);
      const py = Math.max(y, seqAreaTop);
      return {
        mode: 'stacked',
        col: (px - gutter + scroll.left) / this.cellWidth,
        row: (py - seqAreaTop + scroll.top) / this.getRowHeight(viewSettings.showComplement),
        x: px,
        y: py,
      };
    }

    // Single mode rewraps as the cell width changes, so the base index is what
    // survives the zoom; the offset within its row is kept as a fraction.
    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const py = Math.max(y, 0);
    const rowFloat = (py + scroll.top) / this.getSingleRowHeight(viewSettings.showComplement);
    const row = Math.floor(rowFloat);
    const col = Math.min(basesPerRow, Math.max(0, (x - LEFT_MARGIN) / this.cellWidth));
    return { mode: 'single', index: row * basesPerRow + col, rowFraction: rowFloat - row, y: py };
  }

  /**
   * Scroll offsets that put an anchor back under the pixel it was taken from,
   * at the current zoom. Call after `setZoom`.
   * @returns {{top: number, left: number}}
   */
  getScrollForAnchor(anchor, state) {
    const { viewSettings } = state;

    if (anchor.mode === 'stacked') {
      const gutter = this.getGutterWidth(state);
      const rowHeight = this.getRowHeight(viewSettings.showComplement);
      return {
        top: Math.max(0, anchor.row * rowHeight - (anchor.y - this.getSeqAreaTop(state))),
        left: Math.max(0, anchor.col * this.cellWidth - (anchor.x - gutter)),
      };
    }

    const basesPerRow = this.getBasesPerRow(viewSettings.lineWidth);
    const rowHeight = this.getSingleRowHeight(viewSettings.showComplement);
    const row = Math.floor(anchor.index / basesPerRow) + anchor.rowFraction;
    return { top: Math.max(0, row * rowHeight - anchor.y), left: 0 };
  }
}
