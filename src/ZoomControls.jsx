// Zoom widget: slider, step buttons, fit-to-width and presets.
//
// Lives in the status bar, where vertical space is tight — everything here is
// sized to sit inside a 22px row without crowding the position readout beside it.
// Zoom is a multiple of a base column's natural width, so the readout is a
// percentage rather than a pixel count: the natural width depends on the font.

import useStore, { MIN_ZOOM, MAX_ZOOM } from './store.js';
import { getCanvasApi } from './canvasBridge.js';

// A step that feels like one notch of a mouse wheel at either end of the range.
export const ZOOM_STEP = 1.25;

export const ZOOM_PRESETS = [
  { id: 'compact', label: 'Compact', zoom: 0.6 },
  { id: 'default', label: 'Default', zoom: 1 },
  { id: 'detailed', label: 'Detailed', zoom: 2 },
];

// The track runs from "the whole alignment fits the window" to one base per
// 50px, which can be three orders of magnitude. On a linear track 100% would sit
// a few percent from the end and everything below it would be crammed into a
// sliver, so the slider is logarithmic: equal distances are equal ratios.
//
// `min` is the fit-to-window zoom, so the left end of the track is always
// "everything in view" however big the window or the alignment is.

/** Slider position (0–1) for a zoom factor. */
export function zoomToSlider(zoom, min = MIN_ZOOM) {
  const logMin = Math.log(min);
  const span = Math.log(MAX_ZOOM) - logMin;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (Math.log(zoom) - logMin) / span));
}

/** Zoom factor for a slider position (0–1). */
export function sliderToZoom(position, min = MIN_ZOOM) {
  const logMin = Math.log(min);
  return Math.exp(logMin + position * (Math.log(MAX_ZOOM) - logMin));
}

/**
 * Zoom as a percentage, readable across the whole range: whole numbers where
 * they are meaningful, one decimal at the bottom where 1% and 0.6% differ by a
 * factor the eye can see on the canvas.
 */
export function formatZoom(zoom) {
  const percent = zoom * 100;
  if (percent >= 10) return `${Math.round(percent)}%`;
  return `${percent.toFixed(1)}%`;
}

export default function ZoomControls() {
  const zoom = useStore(s => s.workspace.viewSettings.zoom);
  const setZoom = useStore(s => s.setZoom);
  const hasDocuments = useStore(s => s.workspace.documents.length > 0);
  // The floor is "everything in the window", which moves with the window.
  const minZoom = useStore(s => s.workspace.minZoom);

  const label = formatZoom(zoom);
  const preset = ZOOM_PRESETS.find(p => Math.abs(p.zoom - zoom) < 0.001)?.id ?? '';

  return (
    <div className="zoom-controls">
      <button
        className="status-btn status-btn-icon"
        onClick={() => setZoom(zoom / ZOOM_STEP)}
        disabled={zoom <= minZoom}
        title="Zoom out (Ctrl+-)"
        aria-label="Zoom out"
      >
        −
      </button>

      <input
        className="zoom-slider"
        type="range"
        min={0}
        max={1}
        step={0.005}
        value={zoomToSlider(zoom, minZoom)}
        onChange={e => setZoom(sliderToZoom(Number(e.target.value), minZoom))}
        title={`Base column width: ${label} of normal`}
        aria-label="Zoom level"
      />

      <button
        className="status-btn status-btn-icon"
        onClick={() => setZoom(zoom * ZOOM_STEP)}
        disabled={zoom >= MAX_ZOOM}
        title="Zoom in (Ctrl+=)"
        aria-label="Zoom in"
      >
        +
      </button>

      <button
        className="status-btn zoom-readout"
        onClick={() => setZoom(1)}
        title="Reset zoom (Ctrl+0)"
        aria-label="Reset zoom"
      >
        {label}
      </button>

      <button
        className="status-btn"
        onClick={() => getCanvasApi()?.fitToWidth()}
        disabled={!hasDocuments}
        title="Zoom so the longest sequence fills the window"
      >
        Fit
      </button>

      <select
        className="status-select"
        value={preset}
        onChange={e => {
          const next = ZOOM_PRESETS.find(p => p.id === e.target.value);
          if (next) setZoom(next.zoom);
        }}
        title="Zoom presets"
        aria-label="Zoom preset"
      >
        <option value="">Custom</option>
        {ZOOM_PRESETS.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}
