// Publication output: vector SVG, high-resolution PNG, and variant tables.
//
// The figure exporters draw the view as it stands rather than re-laying it out,
// so what lands in a paper is what was on screen — same palette, same zoom, same
// column window.

import { getPalette } from './palettes.js';
import { getTheme } from './theme.js';
import { getCharInfo } from './iupac.js';
import { getConsensusColumn } from './sequenceModel.js';
import { visibleDocuments } from './rowLayout.js';
import { findVariants } from './conservation.js';

const SVG_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Hand `text` to the browser as a download. */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A CSV field, quoted only when it has to be. */
function csvField(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header, rows, delimiter = ',') {
  return [header, ...rows].map(row => row.map(csvField).join(delimiter)).join('\n');
}

/**
 * Which columns a figure should cover: the active selection if there is one,
 * otherwise the window currently scrolled into view.
 * @returns {{from: number, to: number}}
 */
export function figureColumns(state, scroll, renderer) {
  const active = state.documents.find(d => d.id === state.activeDocId);
  if (active?.selection) {
    return { from: active.selection.start, to: active.selection.end };
  }
  const gutter = renderer.isStacked(state) ? renderer.getGutterWidth(state) : 0;
  const maxLen = state.documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
  const from = Math.max(0, Math.floor(scroll.left / renderer.cellWidth));
  const visible = Math.ceil((renderer.width - gutter) / renderer.cellWidth);
  return { from, to: Math.min(maxLen, from + visible) };
}

/**
 * A standalone SVG of the alignment over [from, to).
 * @param {object} state - the render state
 * @param {{from: number, to: number, title?: string, cellWidth?: number, cellHeight?: number, theme?: string, includeConsensus?: boolean}} options
 * @returns {string} SVG source
 */
export function buildAlignmentSvg(state, options) {
  const {
    from, to,
    title = '',
    cellWidth = 14,
    cellHeight = 20,
    theme: themeName = 'light',
    includeConsensus = true,
  } = options;

  const theme = getTheme(themeName);
  const palette = getPalette(state.viewSettings.colorPalette);
  const documents = visibleDocuments(state);
  const columns = Math.max(0, to - from);
  const rowGap = 2;
  const nameWidth = 150;
  const rulerHeight = 18;
  const titleHeight = title ? 26 : 0;
  const showConsensus = includeConsensus && documents.length > 1;
  const consensusHeight = showConsensus ? cellHeight + rowGap : 0;

  const width = nameWidth + columns * cellWidth + 8;
  const height = titleHeight + rulerHeight + consensusHeight
    + documents.length * (cellHeight + rowGap) + 8;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" font-family="${SVG_FONT}">`
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${theme.canvasBg}"/>`);

  if (title) {
    parts.push(
      `<text x="8" y="17" font-size="13" font-weight="600" fill="${theme.nameTextActive}">`
      + `${escapeXml(title)}</text>`
    );
  }

  // Ruler: a tick and a label every ten columns, counting from 1.
  const rulerY = titleHeight + rulerHeight - 5;
  for (let col = from; col < to; col++) {
    if ((col + 1) % 10 !== 0) continue;
    const x = nameWidth + (col - from) * cellWidth + cellWidth / 2;
    parts.push(
      `<text x="${x}" y="${rulerY}" font-size="9" text-anchor="middle" `
      + `fill="${theme.rulerText}">${col + 1}</text>`
    );
  }

  const cellText = (ch, x, y, fill) => (
    `<text x="${x + cellWidth / 2}" y="${y + cellHeight / 2 + 4}" font-size="11" `
    + `text-anchor="middle" fill="${fill}">${escapeXml(ch)}</text>`
  );

  let y = titleHeight + rulerHeight;

  if (showConsensus) {
    parts.push(
      `<text x="8" y="${y + cellHeight / 2 + 4}" font-size="10" `
      + `fill="${theme.nameText}">Consensus</text>`
    );
    for (let col = from; col < to; col++) {
      const ch = getConsensusColumn(
        state.documents, col, state.viewSettings.consensusThreshold
      ).char;
      const x = nameWidth + (col - from) * cellWidth;
      const info = getCharInfo(ch);
      const fill = info.isGap ? theme.gapBg : (palette.fill[ch] ?? palette.fill.N);
      parts.push(`<rect x="${x}" y="${y}" width="${cellWidth - 1}" height="${cellHeight - 1}" fill="${fill}"/>`);
      parts.push(cellText(ch, x, y, info.isGap ? theme.gapText : (palette.text[ch] ?? '#FFFFFF')));
    }
    y += cellHeight + rowGap;
  }

  for (const doc of documents) {
    parts.push(
      `<text x="8" y="${y + cellHeight / 2 + 4}" font-size="10" `
      + `fill="${theme.nameText}">${escapeXml(doc.name || 'Unnamed')}</text>`
    );
    for (let col = from; col < to; col++) {
      const ch = doc.raw[col];
      if (ch === undefined) continue;
      const x = nameWidth + (col - from) * cellWidth;
      const info = getCharInfo(ch);
      const fill = info.isGap ? theme.gapBg : (palette.fill[ch] ?? palette.fill.N);
      parts.push(`<rect x="${x}" y="${y}" width="${cellWidth - 1}" height="${cellHeight - 1}" fill="${fill}"/>`);
      parts.push(cellText(ch, x, y, info.isGap ? theme.gapText : (palette.text[ch] ?? '#FFFFFF')));
    }

    // Features ride at the foot of their row, as a coloured underline with a label.
    for (const feature of doc.features ?? []) {
      if (feature.end <= from || feature.start >= to) continue;
      const fx = nameWidth + (Math.max(feature.start, from) - from) * cellWidth;
      const fw = (Math.min(feature.end, to) - Math.max(feature.start, from)) * cellWidth;
      parts.push(
        `<rect x="${fx}" y="${y + cellHeight - 3}" width="${fw}" height="2" fill="${feature.color}"/>`
      );
    }
    y += cellHeight + rowGap;
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * Re-draw the current view into an offscreen canvas at `scale`, with an optional
 * caption strip, and hand back the PNG blob.
 * @param {object} renderer - the live CanvasRenderer, used for its metrics
 * @param {object} state
 * @param {{top: number, left: number}} scroll
 * @param {{scale?: number, header?: string, theme?: string}} [options]
 * @returns {Promise<Blob>}
 */
export function renderPng(renderer, state, scroll, options = {}) {
  const { scale = 2, header = '', theme: themeName = 'dark' } = options;
  const theme = getTheme(themeName);
  const width = renderer.width;
  const height = renderer.height;
  const headerHeight = header ? 28 : 0;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round((height + headerHeight) * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, width, height + headerHeight);

  if (header) {
    ctx.fillStyle = theme.nameTextActive;
    ctx.font = `13px ${SVG_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(header, 10, headerHeight / 2);
  }

  // The renderer draws from the canvas origin, so the caption is made room for
  // by translating the context under it.
  ctx.translate(0, headerHeight);
  renderer.drawInto(ctx, width, height, state, scroll);

  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
}

/**
 * Every difference from the reference, one row per variant.
 * @returns {string} CSV source
 */
export function buildVariantCsv(documents, reference, delimiter = ',') {
  const variants = findVariants(documents, reference);
  return toCsv(
    ['Position', 'Reference Base', 'Sequence Name', 'Observed Base', 'Variant Type', 'Column Conservation %'],
    variants.map(v => [v.position, v.referenceBase, v.name, v.observed, v.type, v.conservation]),
    delimiter
  );
}
