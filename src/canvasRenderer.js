// Canvas-based sequence renderer — the performance-critical core.
// Draws only visible rows/columns. All layout is derived from measured font metrics.
//
// Two layout modes share this class:
//   single  — one document, wrapped across rows (the v1 view)
//   stacked — several documents, one unwrapped row each under a shared ruler,
//             with a name gutter on the left (Geneious alignment-view style)

import { getCharInfo, complement, IUPAC_MAP, GAP_CHAR } from './iupac.js';
import { getConsensusColumn } from './sequenceModel.js';
import { getTheme } from './theme.js';
import { getPalette, DEFAULT_PALETTE } from './palettes.js';
import { buildRowLayout } from './rowLayout.js';
import { conservationScore } from './conservation.js';
import { featureAt } from './annotations.js';

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
// A column may be a fraction of a pixel: that is what lets a whole alignment sit
// in the window. The floor is only there to keep the arithmetic finite, and is
// low enough not to fight fit-to-window on a megabase alignment.
const MIN_CELL_WIDTH = 0.001;
// Below a pixel per column the per-base drawing is both wrong and slow, and the
// renderer switches to aggregating bases per pixel instead. The two thresholds
// differ so dragging the zoom slider across the boundary cannot flicker.
const OVERVIEW_ENTER = 1;
const OVERVIEW_EXIT = 1.2;
// How many bases are inspected per pixel in that mode. Capping it makes the cost
// of a frame depend on the width of the window rather than the length of the
// sequences, which is what keeps a megabase alignment responsive.
const SAMPLES_PER_PIXEL = 4;
// Anything that marks a position — cursor, selection, a search hit — is drawn at
// least this wide, so it stays findable when a column is a fraction of a pixel.
const MIN_MARKER_WIDTH = 2;
const ROW_GAP = 2;
const RULER_HEIGHT = 24;
const LEFT_MARGIN = 60; // single-mode gutter for position numbers
const CURSOR_WIDTH = 2;
// Ruler labels step up through these as columns narrow, so the numbers never
// collide however far the view is zoomed out.
const RULER_INTERVALS = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
  // A whole chromosome-scale sequence in one window needs coarser steps than the
  // per-base view ever asked for.
  10000, 20000, 50000, 100000, 200000, 500000, 1000000,
];
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
// Column guides band in blocks of ten, the same grouping the ruler counts in.
const COLUMN_BAND = 10;
const FLASH_MS = 900; // how long the "jump to position" marker takes to fade
const MINIMAP_HEIGHT = 22;
const MINIMAP_PADDING = 3; // above and below the density track
const CONSERVATION_HEIGHT = 34;
// Gutter row affordances: the eye and pin buttons, right-aligned in the name column.
const ROW_ICON_SIZE = 14;
const ROW_ICON_GAP = 2;
const GROUP_INDENT = 12;
const ANNOTATION_HEIGHT = 14; // the feature lane under each row
const ANNOTATION_ARROW = 5; // px of pointed end showing a feature's strand

/**
 * The commonest value among the first `n` entries of `buf`.
 * `n` is at most SAMPLES_PER_PIXEL, so the quadratic scan is a handful of
 * comparisons and costs less than allocating a tally per pixel would.
 */
function mode(buf, n) {
  if (n === 0) return null;
  let best = buf[0];
  let bestCount = 0;
  for (let i = 0; i < n; i++) {
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (buf[j] === buf[i]) count++;
    }
    if (count > bestCount) {
      best = buf[i];
      bestCount = count;
    }
  }
  return best;
}

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.theme = getTheme('dark');
    this.palette = getPalette(DEFAULT_PALETTE);
    this.zoom = 1;
    this.overviewMode = false; // set from the metrics: true below a pixel per column
    this.overviewStride = 1;
    // Reused per pixel so the overview allocates nothing per frame; see _drawRowOverview.
    this._sampleBuf = Array.from({ length: SAMPLES_PER_PIXEL }, () => null);
    this._applyMetrics();

    this.cursorVisible = true;
    this.cursorBlinkTimer = null;
    this.flash = null; // { col, start } — the fading marker "jump to position" leaves
    this.hoverDocId = null; // row under the pointer, which reveals its gutter controls
    this.annotationLane = false; // set per frame from the state being drawn

    // Reused across frames so per-base drawing doesn't allocate (see _drawBases).
    this._bgBuckets = new Map();
    this._fgBuckets = new Map();
    this._gutterWidth = NAME_GUTTER_MIN;

    // Measuring every name, and plotting every column of the overview, cost more
    // than everything else on a large alignment, and neither changes when the
    // cursor moves or a row is selected. Both are held until their inputs do.
    this._gutterCache = { names: null, width: NAME_GUTTER_MIN };
    this._minimapCache = { bars: null, raws: null, width: 0, height: 0, maxLen: 0 };
    this._naturalCellWidth_ = 0;
  }

  setTheme(name) {
    this.theme = getTheme(name);
  }

  /** @param {string} id - a palette id from palettes.js. */
  setPalette(id) {
    this.palette = getPalette(id);
  }

  /** Canvas background: a palette may override the theme's (the neon one does). */
  get backgroundColor() {
    return this.palette.canvasBg ?? this.theme.canvasBg;
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

    // Not rounded to whole pixels: at the bottom of the zoom range a column is a
    // fraction of one, and rounding up would put a floor under how much of an
    // alignment can be on screen at once.
    this.cellWidth = Math.max(MIN_CELL_WIDTH, (glyphWidth + CELL_SPACING) * this.zoom);
    // The 1px seam is what separates cells at a readable size; on a 3px column it
    // would eat a third of the colour, so narrow columns are drawn solid.
    this.cellDrawWidth = this.cellWidth > 4 ? this.cellWidth - 1 : this.cellWidth;

    // Hysteresis: entering and leaving the overview at the same width would make
    // the view flicker while the zoom slider is dragged across the threshold.
    if (this.overviewMode) {
      if (this.cellWidth >= OVERVIEW_EXIT) this.overviewMode = false;
    } else if (this.cellWidth <= OVERVIEW_ENTER) {
      this.overviewMode = true;
    }

    // Sample every `overviewStride` columns. Being a multiple of the sequence's
    // own coordinates rather than the viewport's, the same bases are sampled
    // whatever the view is scrolled to, so a pixel does not shimmer while panning.
    this.overviewStride = this.overviewMode
      ? Math.max(1, Math.round(1 / this.cellWidth / SAMPLES_PER_PIXEL))
      : 1;
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

  /**
   * Column width at zoom 1, the unit "fit to width" solves against. The font it
   * measures never changes, so this is measured once.
   */
  _naturalCellWidth() {
    if (this._naturalCellWidth_ === 0) {
      this.ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
      this._naturalCellWidth_ = this._widestGlyphWidth() + CELL_SPACING;
    }
    return this._naturalCellWidth_;
  }

  /**
   * The zoom at which the longest sequence exactly fills the visible width.
   * Unclamped — the store's clampZoom decides what is legible.
   * @returns {number}
   */
  getFitZoom(state) {
    const maxLen = state.documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
    if (maxLen === 0) return 1;
    const gutter = this.isStacked(state) ? this.getGutterWidth(state) : LEFT_MARGIN;
    const available = this.width - gutter - RIGHT_PADDING;
    if (available <= 0) return 1;
    return available / (maxLen * this._naturalCellWidth());
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

  /**
   * Height of one sequence row: bases, the complement strand if shown, and the
   * annotation lane if any sequence has features to put in it. The lane is the
   * same height on every row even when only one has features, because rows of
   * differing heights would make every position calculation a running total.
   */
  getRowHeight(showComplement) {
    let h = this.cellHeight;
    if (showComplement) h += this.complementCellHeight;
    if (this.annotationLane) h += ANNOTATION_HEIGHT;
    return h + ROW_GAP;
  }

  /** Whether the annotation lane is in the layout, for the state being drawn. */
  _updateAnnotationLane(state) {
    this.annotationLane = Boolean(
      state.viewSettings?.showAnnotations
      && state.documents?.some(d => d.features?.length > 0)
    );
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

    // Measuring every name is only worth redoing when the names themselves
    // change; a moving cursor or a new selection leaves them alone.
    const cache = this._gutterCache;
    const documents = state.documents;
    if (cache.names && cache.names.length === documents.length
      && documents.every((d, i) => cache.names[i] === d.name)) {
      this._gutterWidth = cache.width;
      return cache.width;
    }

    const ctx = this.ctx;
    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    let widest = 0;
    for (const doc of documents) {
      const w = ctx.measureText(doc.name || 'Unnamed').width;
      if (w > widest) widest = w;
    }
    const needed = NAME_PADDING + this.getNumberWidth(documents.length) + widest + NAME_PADDING;
    this._gutterWidth = Math.round(
      Math.min(NAME_GUTTER_MAX, Math.max(NAME_GUTTER_MIN, needed))
    );
    cache.names = documents.map(d => d.name);
    cache.width = this._gutterWidth;
    return this._gutterWidth;
  }

  /**
   * Where each band under the ruler begins. The bands stack in reading order —
   * overview, consensus, conservation, then the pinned rows — and each one that
   * is turned off simply takes no space.
   */
  _headerLayout(state) {
    const stacked = this.isStacked(state);
    const { showMinimap, showConsensus, showConservation } = state.viewSettings;
    let y = RULER_HEIGHT;

    const minimapY = y;
    const minimapOn = Boolean(stacked && showMinimap);
    if (minimapOn) y += MINIMAP_HEIGHT;

    const consensusY = y;
    const consensusOn = Boolean(stacked && showConsensus);
    if (consensusOn) y += this.cellHeight + ROW_GAP + CONSENSUS_SEPARATOR;

    const conservationY = y;
    const conservationOn = Boolean(stacked && showConservation);
    if (conservationOn) y += CONSERVATION_HEIGHT + ROW_GAP;

    return {
      minimapOn, minimapY,
      consensusOn, consensusY,
      conservationOn, conservationY,
      frozenY: y,
    };
  }

  /** Y at which the vertically scrolling rows begin, below the ruler and every frozen band. */
  getSeqAreaTop(state) {
    if (!this.isStacked(state)) return RULER_HEIGHT;
    const { frozen } = buildRowLayout(state);
    return this._headerLayout(state).frozenY
      + frozen.length * this.getRowHeight(state.viewSettings.showComplement);
  }

  /** Full scrollable content size, used to size the scroll container's spacer. */
  getContentSize(state) {
    const { documents, viewSettings } = state;
    if (documents.length === 0) return { width: 0, height: 0 };
    this._updateAnnotationLane(state);

    if (this.isStacked(state)) {
      const gutter = this.getGutterWidth(state);
      const maxLen = documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
      const { scrolling } = buildRowLayout(state);
      return {
        width: gutter + maxLen * this.cellWidth + RIGHT_PADDING,
        height: this.getSeqAreaTop(state) + scrolling.length * this.getRowHeight(viewSettings.showComplement) + ROW_GAP,
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
    this._updateAnnotationLane(state);
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, this.width, this.height);

    if (state.documents.length === 0) {
      ctx.fillStyle = this.theme.rulerText;
      ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Open a FASTA file or a .gene project to begin', this.width / 2, this.height / 2);
      ctx.textAlign = 'left';
      return;
    }

    if (this.isStacked(state)) {
      this._renderStacked(state, scroll);
    } else {
      this._renderSingle(state, scroll);
    }
  }

  /**
   * Draw the same view into someone else's context — the PNG exporter's
   * offscreen canvas. The caller owns the transform, so scaling and captions
   * are its business; this only borrows the metrics and the drawing code.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width - logical width to draw at
   * @param {number} height - logical height to draw at
   */
  drawInto(ctx, width, height, state, scroll) {
    const prevCtx = this.ctx;
    const prevCanvas = this.canvas;
    const prevDpr = this.dpr;
    const prevCursor = this.cursorVisible;
    try {
      this.ctx = ctx;
      this.canvas = { width, height, style: {} };
      this.dpr = 1;
      this.cursorVisible = false; // a blinking caret has no place in a figure
      this.render(state, scroll);
    } finally {
      this.ctx = prevCtx;
      this.canvas = prevCanvas;
      this.dpr = prevDpr;
      this.cursorVisible = prevCursor;
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
    const matches = this._groupMatches(state.find)?.get(doc.id);

    for (let row = firstRow; row <= lastRow; row++) {
      const rowY = row * rowHeight - scroll.top;
      const seqStart = row * basesPerRow;
      const seqEnd = Math.min(seqStart + basesPerRow, doc.raw.length);
      const baseY = rowY + RULER_HEIGHT;
      const xAt = i => LEFT_MARGIN + (i - seqStart) * this.cellWidth;

      this._drawRowRuler(rowY, seqStart, seqEnd, xAt, LEFT_MARGIN);
      if (this.overviewMode) {
        this._drawRowOverview(doc.raw, seqStart, seqEnd, xAt, baseY, this.cellHeight, false);
        if (showComplement) {
          this._drawRowOverview(
            doc.raw, seqStart, seqEnd, xAt, baseY + this.cellHeight,
            this.complementCellHeight, true
          );
        }
      } else {
        this._drawBases(doc.raw, seqStart, seqEnd, xAt, baseY, this.cellHeight, this.fontSize, false);
        if (showComplement) {
          this._drawBases(
            doc.raw, seqStart, seqEnd, xAt, baseY + this.cellHeight,
            this.complementCellHeight, this.complementFontSize, true
          );
        }
      }

      if (matches) {
        this._drawMatches(matches, seqStart, seqEnd, xAt, baseY, this.getRowHeight(showComplement) - ROW_GAP);
      }

      if (doc.selection) {
        const from = Math.max(doc.selection.start, seqStart);
        const to = Math.min(doc.selection.end, seqEnd);
        if (from < to) {
          ctx.fillStyle = this.theme.selection;
          ctx.fillRect(
            xAt(from), baseY,
            Math.max(MIN_MARKER_WIDTH, (to - from) * this.cellWidth),
            this.getRowHeight(showComplement) - ROW_GAP
          );
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
    const { documents, activeDocId, viewSettings, columnCursor, columnSelection } = state;
    const { showComplement, highlightMode } = viewSettings;
    const gutter = this.getGutterWidth(state);
    this._gutterWidth = gutter;

    const header = this._headerLayout(state);
    const { frozen, scrolling } = buildRowLayout(state);
    const rowHeight = this.getRowHeight(showComplement);
    const seqAreaTop = header.frozenY + frozen.length * rowHeight;
    const seqAreaHeight = this.height - seqAreaTop;
    const firstRow = Math.max(0, Math.floor(scroll.top / rowHeight));
    const lastRow = Math.min(scrolling.length - 1, Math.floor((scroll.top + seqAreaHeight) / rowHeight));

    const firstCol = Math.max(0, Math.floor(scroll.left / this.cellWidth));
    const visibleCols = Math.ceil((this.width - gutter) / this.cellWidth) + 2;
    const xAt = i => gutter + i * this.cellWidth - scroll.left;

    const maxLen = documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
    const lastCol = Math.min(firstCol + visibleCols, maxLen);
    const matchesByDoc = this._groupMatches(state.find);

    // The consensus for the visible window is computed once per frame and shared
    // by the consensus row and by "disagreements to consensus" highlighting.
    let consensusWindow = null;
    if (header.consensusOn || highlightMode === 'consensus') {
      consensusWindow = [];
      // Calling the consensus is a scan of every row, so in the overview it is
      // done only at the columns that are actually sampled and held across the
      // ones in between — the same approximation the row drawing makes.
      const stride = this.overviewStride;
      let call = GAP_CHAR;
      for (let i = firstCol; i < lastCol; i++) {
        if (stride === 1 || i % stride === 0) {
          call = getConsensusColumn(documents, i, viewSettings.consensusThreshold).char;
        }
        consensusWindow.push(call);
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

    const rowContext = {
      state, gutter, xAt, firstCol, visibleCols, rowHeight,
      compareAt, referenceId, matchesByDoc, activeDocId, columnCursor,
    };

    // Sequence area, clipped so scrolled bases never paint over the gutter or ruler.
    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, seqAreaTop, this.width - gutter, seqAreaHeight);
    ctx.clip();

    for (let row = firstRow; row <= lastRow; row++) {
      const entry = scrolling[row];
      const rowY = seqAreaTop + row * rowHeight - scroll.top;
      if (entry.kind === 'sequence') this._drawSequenceRow(entry.doc, rowY, rowContext);
    }

    // Guides go over the bases, not under: the cells are opaque, so a band drawn
    // beneath them would only show through the 1px seams.
    if (viewSettings.showColumnGuides) {
      this._drawColumnBands(xAt, firstCol, lastCol, seqAreaTop, seqAreaHeight);
    }

    // Column selection spans every visible row — painted at reduced opacity to
    // distinguish it from the single-column edit cursor.
    if (columnSelection) {
      const s = Math.min(columnSelection.start, columnSelection.end);
      const e = Math.max(columnSelection.start, columnSelection.end);
      ctx.fillStyle = this.theme.columnSelection ?? 'rgba(99,179,237,0.22)';
      ctx.fillRect(
        xAt(s), seqAreaTop,
        Math.max(MIN_MARKER_WIDTH, (e - s) * this.cellWidth), seqAreaHeight
      );
    }

    // Column cursor spans every visible row — it edits all of them, not just the active one.
    // Steady, not blinking: it marks a locus across every row rather than an
    // insertion caret in one of them.
    if (columnCursor !== null) {
      ctx.fillStyle = this.theme.columnCursor;
      ctx.fillRect(xAt(columnCursor) - 1, seqAreaTop, COLUMN_CURSOR_WIDTH, seqAreaHeight);
    }

    if (this.flash) this._drawFlash(xAt, firstCol, lastCol, seqAreaTop, seqAreaHeight);
    ctx.restore();

    // Pinned rows: the same row drawing, in a band that does not scroll.
    if (frozen.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(gutter, header.frozenY, this.width - gutter, frozen.length * rowHeight);
      ctx.clip();
      frozen.forEach((entry, i) => {
        this._drawSequenceRow(entry.doc, header.frozenY + i * rowHeight, rowContext);
      });
      ctx.restore();
    }

    if (header.minimapOn) this._drawMinimap(state, scroll, gutter, header.minimapY, maxLen);
    if (header.consensusOn) {
      this._drawConsensusRow(gutter, firstCol, xAt, consensusWindow, header.consensusY);
    }
    if (header.conservationOn) {
      this._drawConservation(state, gutter, firstCol, lastCol, xAt, header.conservationY);
    }
    this._drawNameGutter(state, scroll, {
      gutter, header, frozen, scrolling, firstRow, lastRow, rowHeight, seqAreaTop,
    });
    this._drawSharedRuler(
      gutter, firstCol, firstCol + visibleCols, xAt, columnCursor, columnSelection,
      viewSettings.showColumnGuides
    );
  }

  /** One sequence row of the alignment: bases, hits, and the active row's cursor. */
  _drawSequenceRow(doc, rowY, context) {
    const ctx = this.ctx;
    const {
      state, gutter, xAt, firstCol, visibleCols, rowHeight,
      compareAt, referenceId, matchesByDoc, activeDocId, columnCursor,
    } = context;
    const selectedDocIds = state.selectedDocIds ?? new Set();
    const showComplement = state.viewSettings.showComplement;
    const isActive = doc.id === activeDocId;
    const contentHeight = rowHeight - ROW_GAP;

    if (isActive) {
      ctx.fillStyle = this.theme.activeRowBg;
      ctx.fillRect(gutter, rowY, this.width - gutter, contentHeight);
    }

    const from = Math.min(firstCol, doc.raw.length);
    const to = Math.min(firstCol + visibleCols, doc.raw.length);
    const rowCompare = doc.id === referenceId ? null : compareAt;
    if (this.overviewMode) {
      this._drawRowOverview(doc.raw, from, to, xAt, rowY, this.cellHeight, false, rowCompare);
      if (showComplement) {
        this._drawRowOverview(
          doc.raw, from, to, xAt, rowY + this.cellHeight,
          this.complementCellHeight, true, rowCompare
        );
      }
    } else {
      this._drawBases(doc.raw, from, to, xAt, rowY, this.cellHeight, this.fontSize, false, rowCompare);
      if (showComplement) {
        this._drawBases(
          doc.raw, from, to, xAt, rowY + this.cellHeight,
          this.complementCellHeight, this.complementFontSize, true, rowCompare
        );
      }
    }

    const rowMatches = matchesByDoc?.get(doc.id);
    if (rowMatches) this._drawMatches(rowMatches, from, to, xAt, rowY, contentHeight);

    if (this.annotationLane && doc.features?.length) {
      const laneY = rowY + this.cellHeight + (showComplement ? this.complementCellHeight : 0);
      this._drawFeatures(doc.features, firstCol, firstCol + visibleCols, xAt, laneY);
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
          Math.max(MIN_MARKER_WIDTH, (doc.selection.end - doc.selection.start) * this.cellWidth),
          contentHeight
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

  /**
   * Search hits, grouped by the row they are on. Built once per frame: a hit
   * list can run to thousands, and scanning it per row would be quadratic.
   * @returns {Map<string, Array<object>>|null}
   */
  _groupMatches(find) {
    if (!find?.matches?.length) return null;
    const byDoc = new Map();
    for (let i = 0; i < find.matches.length; i++) {
      const m = find.matches[i];
      let list = byDoc.get(m.docId);
      if (!list) { list = []; byDoc.set(m.docId, list); }
      list.push({ ...m, active: i === find.activeIndex });
    }
    return byDoc;
  }

  /** Boxes over the hits on one row, with the current hit picked out. */
  _drawMatches(matches, from, to, xAt, y, height) {
    const ctx = this.ctx;
    for (const m of matches) {
      if (m.end <= from || m.start >= to) continue;
      const s = Math.max(m.start, from);
      const e = Math.min(m.end, to);
      ctx.fillStyle = m.active ? this.theme.matchHighlightActive : this.theme.matchHighlight;
      ctx.fillRect(xAt(s), y, Math.max(MIN_MARKER_WIDTH, (e - s) * this.cellWidth), height);
    }
  }

  /** Mark a column with a highlight that fades out over `FLASH_MS`. */
  flashColumn(col) {
    this.flash = { col, start: Date.now() };
  }

  /** The fading jump marker, drawn over everything in the sequence area. */
  _drawFlash(xAt, firstCol, lastCol, y, height) {
    const { col, start } = this.flash;
    const elapsed = Date.now() - start;
    if (elapsed > FLASH_MS) {
      this.flash = null;
      return;
    }
    if (col < firstCol || col >= lastCol) return;
    const ctx = this.ctx;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = 1 - elapsed / FLASH_MS;
    ctx.fillStyle = this.theme.matchHighlightActive;
    ctx.fillRect(xAt(col), y, Math.max(MIN_MARKER_WIDTH, this.cellWidth), height);
    ctx.globalAlpha = prevAlpha;
  }

  /**
   * Faint banding every ten columns, so a position can be tracked down through
   * many rows without counting. Drawn from the ruler down, so the band the eye
   * picks in the numbers is the one it follows into the sequences.
   */
  _drawColumnBands(xAt, firstCol, lastCol, y, height) {
    // A band narrower than a few pixels stops reading as banding and starts
    // reading as a haze over the sequence, which is the opposite of a guide.
    const bandWidth = COLUMN_BAND * this.cellWidth;
    if (bandWidth < 4) return;

    const ctx = this.ctx;
    ctx.fillStyle = this.theme.columnBand;
    const firstBand = Math.floor(firstCol / COLUMN_BAND);
    const lastBand = Math.floor((lastCol - 1) / COLUMN_BAND);
    for (let band = firstBand; band <= lastBand; band++) {
      if (band % 2 === 0) continue; // every other block, so the bands alternate
      ctx.fillRect(xAt(band * COLUMN_BAND), y, bandWidth, height);
    }
  }

  /** A non-editable row pinned below the ruler: the majority call per column. */
  _drawConsensusRow(gutter, firstCol, xAt, consensusWindow, rowY) {
    const ctx = this.ctx;
    const rowH = this.cellHeight;

    ctx.fillStyle = this.theme.consensusBg;
    ctx.fillRect(0, rowY, this.width, rowH + ROW_GAP - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, rowY, this.width - gutter, rowH);
    ctx.clip();

    const consensus = consensusWindow.join('');
    const consensusXAt = i => xAt(firstCol + i);
    if (this.overviewMode) {
      this._drawRowOverview(consensus, 0, consensus.length, consensusXAt, rowY, rowH, false);
    } else {
      this._drawBases(consensus, 0, consensus.length, consensusXAt, rowY, rowH, this.fontSize, false);
    }
    ctx.restore();

    // Spans the gutter too, so the consensus reads as a banded header across the
    // whole view rather than as the first of the sequence rows.
    ctx.fillStyle = this.theme.consensusBorder;
    ctx.fillRect(0, rowY + rowH + ROW_GAP, this.width, CONSENSUS_SEPARATOR);
  }

  /**
   * Per-column conservation, as a bar chart under the consensus. Bar height is
   * the score; colour is the band it falls in, so a glance finds the variable
   * regions without reading the axis.
   */
  _drawConservation(state, gutter, firstCol, lastCol, xAt, top) {
    const ctx = this.ctx;
    const height = CONSERVATION_HEIGHT;

    ctx.fillStyle = this.theme.consensusBg;
    ctx.fillRect(0, top, this.width, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, top, this.width - gutter, height);
    ctx.clip();

    const metric = state.viewSettings.conservationMetric ?? 'identity';
    // Scoring a column reads every row, so the overview scores one column per
    // sample and widens its bar to cover the ones it stands for.
    const stride = this.overviewStride;
    const barWidth = Math.max(1, stride === 1 ? this.cellDrawWidth : stride * this.cellWidth);
    const baseline = top + height - 1;
    for (let col = firstCol; col < lastCol; col += stride) {
      const { score, coverage } = conservationScore(state.documents, col, metric);
      if (coverage === 0) continue;
      const barHeight = Math.max(1, Math.round(score * (height - 4)));
      ctx.fillStyle = score >= 0.9
        ? this.theme.conservationHigh
        : score >= 0.5 ? this.theme.conservationMid : this.theme.conservationLow;
      ctx.fillRect(xAt(col), baseline - barHeight, barWidth, barHeight);
    }
    ctx.restore();

    ctx.fillStyle = this.theme.nameText;
    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Conservation', NAME_PADDING, top + height / 2);

    ctx.strokeStyle = this.theme.gutterBorder;
    ctx.beginPath();
    ctx.moveTo(0, top + height - 0.5);
    ctx.lineTo(this.width, top + height - 0.5);
    ctx.stroke();
  }

  /**
   * Overview strip: the whole alignment squeezed into the width of the window,
   * with a box showing which part of it the sequence area is looking at.
   * The track plots per-column coverage — where the alignment has data and where
   * it is ragged — which is the shape that matters when navigating a long one.
   */
  _drawMinimap(state, scroll, gutter, top, maxLen) {
    const ctx = this.ctx;
    const trackTop = top + MINIMAP_PADDING;
    const trackHeight = MINIMAP_HEIGHT - MINIMAP_PADDING * 2;
    const width = this.width - gutter;
    if (width <= 0 || maxLen === 0) return;

    ctx.fillStyle = this.theme.minimapBg;
    ctx.fillRect(0, top, this.width, MINIMAP_HEIGHT);

    ctx.fillStyle = this.theme.nameText;
    ctx.font = `${RULER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Overview', NAME_PADDING, top + MINIMAP_HEIGHT / 2);

    // Measuring the coverage reads every row, which on a large alignment costs
    // more than the rest of the frame put together — and it cannot change when
    // the scroll, cursor or selection does, which is what most redraws are
    // about. So the bars are measured once and only the painting is per frame.
    const bars = this._minimapBars(state.documents, width, trackHeight, maxLen);
    ctx.fillStyle = this.theme.minimapTrack;
    for (let px = 0; px < bars.length; px++) {
      const h = bars[px];
      if (h > 0) ctx.fillRect(gutter + px, trackTop + trackHeight - h, 1, h);
    }

    // The viewport box, clamped to stay grabbable when the view is zoomed right out.
    const viewportCols = Math.min(maxLen, (this.width - gutter) / this.cellWidth);
    const boxX = gutter + (scroll.left / this.cellWidth / maxLen) * width;
    const boxW = Math.max(6, (viewportCols / maxLen) * width);
    ctx.fillStyle = this.theme.minimapViewport;
    ctx.fillRect(boxX, top, Math.min(boxW, width), MINIMAP_HEIGHT);
    ctx.strokeStyle = this.theme.minimapViewportBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, top + 0.5, Math.min(boxW, width) - 1, MINIMAP_HEIGHT - 1);

    ctx.strokeStyle = this.theme.gutterBorder;
    ctx.beginPath();
    ctx.moveTo(0, top + MINIMAP_HEIGHT - 0.5);
    ctx.lineTo(this.width, top + MINIMAP_HEIGHT - 0.5);
    ctx.stroke();
  }

  /**
   * Height of the overview's coverage bar for each pixel column, 0 where the
   * alignment has nothing at all. One bar per pixel, sampling only a few columns
   * within each, so it costs the same on a megabase alignment as on a short one
   * — but it still reads every row, which is the most expensive thing a frame
   * does on a large alignment. It depends only on the sequences, so the result
   * is kept until one of them changes.
   * @returns {Int32Array}
   */
  _minimapBars(documents, width, trackHeight, maxLen) {
    const cache = this._minimapCache;
    const fresh = cache.bars
      && cache.width === width
      && cache.height === trackHeight
      && cache.maxLen === maxLen
      && cache.raws.length === documents.length
      && documents.every((d, i) => cache.raws[i] === d.raw);
    if (fresh) return cache.bars;

    // A container's width is routinely fractional, and a typed array's length
    // may not be; the last bar covers the part-pixel, as the old loop did.
    const bars = new Int32Array(Math.ceil(width));
    const columnsPerPixel = maxLen / width;
    const stride = Math.max(1, Math.round(columnsPerPixel / SAMPLES_PER_PIXEL));
    for (let px = 0; px < bars.length; px++) {
      const from = Math.floor(px * columnsPerPixel);
      const to = Math.max(from + 1, Math.floor((px + 1) * columnsPerPixel));
      let covered = 0;
      let total = 0;
      for (const doc of documents) {
        const raw = doc.raw;
        for (let col = from; col < to; col += stride) {
          const c = raw[col];
          if (c === undefined) continue;
          total++;
          if (c !== GAP_CHAR) covered++;
        }
      }
      bars[px] = total === 0 ? 0 : Math.max(1, Math.round((covered / total) * trackHeight));
    }

    cache.bars = bars;
    cache.raws = documents.map(d => d.raw);
    cache.width = width;
    cache.height = trackHeight;
    cache.maxLen = maxLen;
    return bars;
  }

  /**
   * Which alignment column a minimap x maps to.
   * @returns {number}
   */
  minimapColumnAt(x, state) {
    const gutter = this._gutterWidth;
    const width = this.width - gutter;
    const maxLen = state.documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
    if (width <= 0 || maxLen === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (x - gutter) / width));
    return Math.min(maxLen - 1, Math.floor(ratio * maxLen));
  }

  _drawNameGutter(state, scroll, layout) {
    const ctx = this.ctx;
    const { gutter, header, frozen, scrolling, firstRow, lastRow, rowHeight, seqAreaTop } = layout;

    ctx.fillStyle = this.theme.gutterBg;
    ctx.fillRect(0, header.frozenY, gutter, this.height - header.frozenY);
    if (header.consensusOn) {
      ctx.fillStyle = this.theme.consensusBg;
      // Stops short of the separator rule, which is drawn across the full width.
      ctx.fillRect(0, header.consensusY, gutter, this.cellHeight + ROW_GAP);
      ctx.fillStyle = this.theme.nameText;
      ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('Consensus', NAME_PADDING, header.consensusY + this.cellHeight / 2);
    }

    // Row numbers count documents, so the width is sized to the largest of them
    // however few rows are on screen.
    const numberWidth = this.getNumberWidth(state.documents.length);
    const indexOf = new Map(state.documents.map((d, i) => [d.id, i]));

    // Pinned rows first, in their own band, then the scrolling ones under a clip.
    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    frozen.forEach((entry, i) => {
      this._drawGutterRow(entry, header.frozenY + i * rowHeight, {
        state, gutter, rowHeight, numberWidth, indexOf,
      });
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, seqAreaTop, gutter, this.height - seqAreaTop);
    ctx.clip();
    ctx.font = `${NAME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    for (let row = firstRow; row <= lastRow; row++) {
      this._drawGutterRow(scrolling[row], seqAreaTop + row * rowHeight - scroll.top, {
        state, gutter, rowHeight, numberWidth, indexOf,
      });
    }

    // Where a dragged row would land, drawn as a line between rows.
    if (state.rowDropIndex != null) {
      const y = seqAreaTop + state.rowDropIndex * rowHeight - scroll.top;
      ctx.fillStyle = this.theme.dropMarker;
      ctx.fillRect(0, y - 1, gutter, 2);
    }
    ctx.restore();

    // Break the vertical border around the separator band so the thick rule reads
    // as one unbroken line across the view.
    ctx.strokeStyle = this.theme.gutterBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (header.consensusOn) {
      ctx.moveTo(gutter + 0.5, RULER_HEIGHT);
      ctx.lineTo(gutter + 0.5, header.consensusY + this.cellHeight + ROW_GAP);
      ctx.moveTo(gutter + 0.5, header.consensusY + this.cellHeight + ROW_GAP + CONSENSUS_SEPARATOR);
    } else {
      ctx.moveTo(gutter + 0.5, RULER_HEIGHT);
    }
    ctx.lineTo(gutter + 0.5, this.height);
    ctx.stroke();
  }

  /** One gutter entry: a sequence name with its controls, or a group header. */
  _drawGutterRow(entry, rowY, context) {
    const ctx = this.ctx;
    const { state, gutter, rowHeight, numberWidth, indexOf } = context;
    const contentHeight = rowHeight - ROW_GAP;
    const centerY = rowY + contentHeight / 2;

    if (entry.kind === 'group') {
      ctx.fillStyle = this.theme.consensusBg;
      ctx.fillRect(0, rowY, gutter, contentHeight);
      ctx.fillStyle = this.theme.nameTextActive;
      ctx.fillText(entry.group.collapsed ? '▶' : '▼', NAME_PADDING, centerY);
      ctx.fillText(
        this._truncate(
          `${entry.group.name} (${entry.memberCount})`,
          gutter - NAME_PADDING * 2 - GROUP_INDENT
        ),
        NAME_PADDING + GROUP_INDENT, centerY
      );
      return;
    }

    const doc = entry.doc;
    const selectedDocIds = state.selectedDocIds ?? new Set();
    const isActive = doc.id === state.activeDocId;
    const isSelected = selectedDocIds.has(doc.id);
    const isReference = doc.id === state.viewSettings.referenceDocId;
    const isPinned = state.pinnedDocIds?.has(doc.id) ?? false;

    // Selection reads as a highlighted row, with an accent bar at the left edge
    // so it stays distinguishable from the (lighter) active-row tint. It outranks
    // the reference wash because it is the transient state the user is acting on —
    // setting a reference clears the selection, so the wash appears immediately after.
    if (isSelected) {
      ctx.fillStyle = this.theme.selectedRowBg;
      ctx.fillRect(0, rowY, gutter, contentHeight);
      ctx.fillStyle = this.theme.selectedRowBar;
      ctx.fillRect(0, rowY, SELECTION_BAR_WIDTH, contentHeight);
    } else if (isReference) {
      ctx.fillStyle = this.theme.referenceNameBg;
      ctx.fillRect(0, rowY, gutter, contentHeight);
    } else if (isActive) {
      ctx.fillStyle = this.theme.activeRowBg;
      ctx.fillRect(0, rowY, gutter, contentHeight);
    }

    const indent = entry.depth * GROUP_INDENT;

    // Row number, dimmed and in its own fixed-width column so the names align.
    ctx.fillStyle = this.theme.rowNumber;
    ctx.fillText(`${(indexOf.get(doc.id) ?? 0) + 1}.`, NAME_PADDING + indent, centerY);

    let textX = NAME_PADDING + indent + numberWidth;
    if (doc.dirty) {
      ctx.fillStyle = this.theme.dirtyMarker;
      ctx.beginPath();
      ctx.arc(textX + 2, centerY, 3, 0, Math.PI * 2);
      ctx.fill();
      textX += 11;
    }

    // The controls only appear for the row under the pointer — or for a pinned
    // row, where the pin is state worth seeing without hunting for it.
    const hovered = this.hoverDocId === doc.id;
    const iconsWidth = hovered || isPinned ? (ROW_ICON_SIZE + ROW_ICON_GAP) * 2 : 0;

    ctx.fillStyle = isActive ? this.theme.nameTextActive : this.theme.nameText;
    ctx.fillText(
      this._truncate(doc.name || 'Unnamed', gutter - textX - NAME_PADDING - iconsWidth),
      textX, centerY
    );

    if (iconsWidth > 0) {
      const zones = this.rowIconZones(gutter);
      this._drawEyeIcon(zones.eye, centerY, hovered);
      this._drawPinIcon(zones.pin, centerY, isPinned, hovered);
    }
  }

  /**
   * The feature lane under one row: a pointed bar per feature, labelled when
   * there is room for the text. The point is at the end the feature reads
   * towards, which is the quickest way to show strand without a second glyph.
   */
  _drawFeatures(features, firstCol, lastCol, xAt, laneY) {
    const ctx = this.ctx;
    const height = ANNOTATION_HEIGHT - 3;
    const top = laneY + 1;

    for (const feature of features) {
      if (feature.end <= firstCol || feature.start >= lastCol) continue;
      const x = xAt(feature.start);
      // A feature that spans a fraction of a pixel is still worth a mark.
      const width = Math.max(MIN_MARKER_WIDTH, (feature.end - feature.start) * this.cellWidth);
      const point = Math.min(ANNOTATION_ARROW, width / 2);
      const forward = feature.strand !== -1;

      ctx.fillStyle = feature.color;
      ctx.beginPath();
      if (forward) {
        ctx.moveTo(x, top);
        ctx.lineTo(x + width - point, top);
        ctx.lineTo(x + width, top + height / 2);
        ctx.lineTo(x + width - point, top + height);
        ctx.lineTo(x, top + height);
      } else {
        ctx.moveTo(x + width, top);
        ctx.lineTo(x + point, top);
        ctx.lineTo(x, top + height / 2);
        ctx.lineTo(x + point, top + height);
        ctx.lineTo(x + width, top + height);
      }
      ctx.closePath();
      ctx.fill();

      if (width > 34) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, top, width - point, height);
        ctx.clip();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `${RULER_FONT_SIZE}px ${FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(feature.label, x + 4, top + height / 2 + 0.5);
        ctx.restore();
      }
    }
  }

  /** X positions of the eye and pin controls, given the gutter width. */
  rowIconZones(gutter) {
    const pin = gutter - NAME_PADDING - ROW_ICON_SIZE;
    return { pin, eye: pin - ROW_ICON_SIZE - ROW_ICON_GAP, size: ROW_ICON_SIZE };
  }

  _drawEyeIcon(x, centerY, emphasised) {
    const ctx = this.ctx;
    const cx = x + ROW_ICON_SIZE / 2;
    ctx.strokeStyle = emphasised ? this.theme.nameTextActive : this.theme.rowNumber;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, centerY, 5.5, 3.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = emphasised ? this.theme.nameTextActive : this.theme.rowNumber;
    ctx.beginPath();
    ctx.arc(cx, centerY, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawPinIcon(x, centerY, pinned, emphasised) {
    const ctx = this.ctx;
    const cx = x + ROW_ICON_SIZE / 2;
    const color = pinned
      ? this.theme.selectedRowBar
      : (emphasised ? this.theme.nameTextActive : this.theme.rowNumber);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, centerY - 2, 3.2, 0, Math.PI * 2);
    if (pinned) ctx.fill(); else ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, centerY + 1);
    ctx.lineTo(cx, centerY + 5);
    ctx.stroke();
  }

  _drawSharedRuler(gutter, firstCol, lastCol, xAt, columnCursor, columnSelection, showColumnGuides) {
    const ctx = this.ctx;
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, this.width, RULER_HEIGHT);

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, 0, this.width - gutter, RULER_HEIGHT);
    ctx.clip();

    if (showColumnGuides) this._drawColumnBands(xAt, firstCol, lastCol, 0, RULER_HEIGHT);

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

    if (columnSelection) {
      const s = Math.min(columnSelection.start, columnSelection.end);
      const e = Math.max(columnSelection.start, columnSelection.end);
      const selX = xAt(s);
      const selW = Math.max(MIN_MARKER_WIDTH, (e - s) * this.cellWidth);
      ctx.fillStyle = this.theme.columnSelection ?? 'rgba(99,179,237,0.30)';
      ctx.fillRect(selX, 0, selW, RULER_HEIGHT);
    }

    if (columnCursor !== null) {
      const x = xAt(columnCursor);
      // The tab carries a position label, so it needs room for one however
      // narrow the column beneath it has become.
      const tabWidth = Math.max(MIN_MARKER_WIDTH, this.cellWidth);
      ctx.fillStyle = this.theme.columnCursor;
      ctx.fillRect(x, 0, tabWidth, RULER_HEIGHT);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(`${columnCursor + 1}`, x + tabWidth / 2, 4);
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
      const bgColor = agrees
        ? null
        : (info.isGap ? this.theme.gapBg : (this.palette.fill[ch] ?? this.palette.fill.N));
      const fgColor = agrees
        ? this.theme.agreementText
        : (info.isGap ? this.theme.gapText : (this.palette.text[ch] ?? '#FFFFFF'));
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

  /**
   * Draw a row by the pixel rather than by the base.
   *
   * Below a pixel per column there is no room for a cell, let alone a letter, and
   * one fillRect per base would be thousands of sub-pixel draws landing on the
   * same handful of pixels. So the loop inverts: for each pixel, look at the
   * bases that fall under it and pick the one colour that represents them.
   *
   * Gaps win a pixel by majority, which is what keeps the gap columns of an
   * alignment legible as white breaks when the whole thing is in the window;
   * otherwise the commonest base wins, so the palette still means something.
   * Runs of one colour are coalesced, since this view is mostly long flat stretches.
   *
   * @param {string} seq
   * @param {number} from - first column to draw (inclusive)
   * @param {number} to - last column (exclusive)
   * @param {function(number): number} xAt - column index to canvas x
   * @param {number} y
   * @param {number} cellH
   * @param {boolean} isComplement
   * @param {function(number): string|null} compareAt - highlighting comparison, or null
   */
  _drawRowOverview(seq, from, to, xAt, y, cellH, isComplement, compareAt = null) {
    if (from >= to) return;
    const ctx = this.ctx;
    const stride = this.overviewStride;
    const buf = this._sampleBuf;
    const rectH = cellH - 1;
    const originX = xAt(0);
    const colAt = x => (x - originX) / this.cellWidth;

    const startX = Math.floor(xAt(from));
    const endX = Math.ceil(xAt(to));

    const prevAlpha = ctx.globalAlpha;
    if (isComplement) ctx.globalAlpha = 0.5;

    let runColor = null;
    let runStart = startX;

    for (let x = startX; x <= endX; x++) {
      let color = null;

      if (x < endX) {
        const colFrom = Math.max(from, Math.floor(colAt(x)));
        const colTo = Math.min(to, Math.max(colFrom + 1, Math.ceil(colAt(x + 1))));

        // Start at the first sampling position at or after colFrom, so the
        // positions are a fixed lattice in the sequence rather than the viewport.
        let col = stride === 1 ? colFrom : Math.ceil(colFrom / stride) * stride;
        if (col >= colTo) col = colFrom;

        let total = 0;
        let gaps = 0;
        let agree = 0;
        let kinds = 0;
        for (; col < colTo && total < SAMPLES_PER_PIXEL; col += stride) {
          const raw = seq[col];
          if (raw === undefined) continue;
          total++;
          if (compareAt !== null && raw === compareAt(col)) agree++;
          if (raw === GAP_CHAR) gaps++;
          else if (kinds < SAMPLES_PER_PIXEL) {
            buf[kinds++] = isComplement ? (complement(raw) ?? raw) : raw;
          }
        }

        if (total > 0) {
          // A pixel that agrees with the comparison row is left unpainted, the
          // same way an agreeing cell is in the per-base path.
          const agreeing = compareAt !== null && agree * 2 >= total;
          if (!agreeing) {
            color = gaps * 2 >= total
              ? this.theme.gapBg
              : (this.palette.fill[mode(buf, kinds)] ?? this.palette.fill.N);
          }
        }
      }

      if (color !== runColor) {
        if (runColor !== null && x > runStart) {
          ctx.fillStyle = runColor;
          ctx.fillRect(runStart, y, x - runStart, rectH);
        }
        runColor = color;
        runStart = x;
      }
    }

    ctx.globalAlpha = prevAlpha;
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
    this._updateAnnotationLane(state);

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

      const header = this._headerLayout(state);
      if (header.minimapOn && y < header.minimapY + MINIMAP_HEIGHT) {
        if (x < gutter) return null;
        return { kind: 'minimap', index: this.minimapColumnAt(x, state) };
      }

      const { frozen, scrolling } = buildRowLayout(state);
      const rowHeight = this.getRowHeight(viewSettings.showComplement);
      const seqAreaTop = header.frozenY + frozen.length * rowHeight;

      let entry = null;
      let rowTop = 0;
      if (y >= header.frozenY && y < seqAreaTop) {
        const index = Math.floor((y - header.frozenY) / rowHeight);
        entry = frozen[index];
        rowTop = header.frozenY + index * rowHeight;
      } else if (y >= seqAreaTop) {
        const index = Math.floor((y - seqAreaTop + scroll.top) / rowHeight);
        entry = scrolling[index];
        rowTop = seqAreaTop + index * rowHeight - scroll.top;
      }
      if (!entry) return null; // consensus, conservation and empty space below the rows

      if (entry.kind === 'group') {
        return x < gutter ? { kind: 'group', groupId: entry.group.id } : null;
      }

      const doc = entry.doc;
      if (x < gutter) {
        // The controls sit at the right edge of the name, over the truncation.
        const zones = this.rowIconZones(gutter);
        if (x >= zones.eye && x < zones.eye + zones.size) {
          return { kind: 'rowIcon', icon: 'hide', docId: doc.id };
        }
        if (x >= zones.pin && x < zones.pin + zones.size) {
          return { kind: 'rowIcon', icon: 'pin', docId: doc.id };
        }
        return { kind: 'name', docId: doc.id, rowTop };
      }

      const col = Math.round((x - gutter + scroll.left) / this.cellWidth);
      const index = Math.max(0, Math.min(doc.raw.length, col));

      // The lane sits at the bottom of the row, under the bases (and under the
      // complement strand when that is showing).
      if (this.annotationLane && doc.features?.length) {
        const laneTop = rowTop + this.cellHeight
          + (viewSettings.showComplement ? this.complementCellHeight : 0);
        if (y >= laneTop && y < laneTop + ANNOTATION_HEIGHT) {
          const feature = featureAt(doc.features, Math.floor((x - gutter + scroll.left) / this.cellWidth));
          if (feature) return { kind: 'annotation', docId: doc.id, feature };
        }
      }

      return { kind: 'seq', docId: doc.id, index };
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
    this._updateAnnotationLane(state);
    const contentHeight = this.getRowHeight(viewSettings.showComplement) - ROW_GAP;

    if (this.isStacked(state)) {
      const rowHeight = this.getRowHeight(viewSettings.showComplement);
      const header = this._headerLayout(state);
      const { frozen, scrolling } = buildRowLayout(state);

      const frozenRow = frozen.findIndex(r => r.doc?.id === docId);
      const scrollRow = frozenRow === -1 ? scrolling.findIndex(r => r.doc?.id === docId) : -1;
      if (frozenRow === -1 && scrollRow === -1) return null;

      const y = frozenRow !== -1
        ? header.frozenY + frozenRow * rowHeight
        : header.frozenY + frozen.length * rowHeight + scrollRow * rowHeight - scroll.top;

      return {
        x: this._gutterWidth + index * this.cellWidth - scroll.left,
        y,
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

  /**
   * Where a row dragged to canvas `y` would be inserted, as an index into the
   * scrolling row list — the gap above a row rather than the row itself, so a
   * drop between two rows is unambiguous.
   * @returns {{rowIndex: number, docIndex: number}|null}
   */
  rowDropAt(y, scroll, state) {
    if (!this.isStacked(state)) return null;
    const rowHeight = this.getRowHeight(state.viewSettings.showComplement);
    const { frozen, scrolling } = buildRowLayout(state);
    const seqAreaTop = this._headerLayout(state).frozenY + frozen.length * rowHeight;
    const offset = y - seqAreaTop + scroll.top;
    const rowIndex = Math.max(0, Math.min(scrolling.length, Math.round(offset / rowHeight)));

    // Translate back to a position in the document list: the row that would end
    // up below the dragged one decides where it lands.
    const below = scrolling[rowIndex];
    const docIndex = below?.doc
      ? state.documents.findIndex(d => d.id === below.doc.id)
      : state.documents.length;
    return { rowIndex, docIndex: docIndex === -1 ? state.documents.length : docIndex };
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
