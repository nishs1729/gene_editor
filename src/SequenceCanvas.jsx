// SequenceCanvas: React wrapper for the canvas-based sequence renderer.
// Manages canvas lifecycle, 2D scroll, resize, and wires selection/editing handlers.

import { useRef, useEffect, useCallback, useState } from 'react';
import useStore, { getActiveDoc, clampZoom } from './store.js';
import { CanvasRenderer } from './canvasRenderer.js';
import { createMouseHandlers, createSelectionKeyHandlers } from './selection.js';
import { createEditingKeyHandler } from './editing.js';
import { registerCanvasApi } from './canvasBridge.js';
import { describeFeature } from './annotations.js';

// Wheel deltas differ by an order of magnitude between mice and trackpads, so
// zoom moves exponentially with the delta rather than in fixed steps.
const ZOOM_SENSITIVITY = 0.002;
const LINE_DELTA_PX = 16; // Firefox reports wheel deltas in lines, not pixels

/** The slice of store state the renderer and interaction handlers read from. */
function renderState() {
  const state = useStore.getState();
  const { documents, activeDocId, viewSettings, dragInsertIndex, selectedDocIds, columnCursor, columnSelection } =
    state.workspace;
  return {
    documents, activeDocId, viewSettings, dragInsertIndex, selectedDocIds,
    columnCursor, columnSelection,
    find: state.find,
  };
}

export default function SequenceCanvas() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const spacerRef = useRef(null);
  const rendererRef = useRef(null);
  const scrollRef = useRef({ top: 0, left: 0 });
  const animFrameRef = useRef(null);

  const workspace = useStore(s => s.workspace);
  const theme = useStore(s => s.theme);
  const find = useStore(s => s.find);
  const setZoom = useStore(s => s.setZoom);
  const { fullscreen, zoom, colorPalette } = workspace.viewSettings;

  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState(null); // { x, y, feature } for a hovered annotation

  // The spacer is written directly as well as through state: a zoom has to scroll
  // the container within the new extent in the same tick, before React commits.
  const applyContentSize = useCallback((size) => {
    const spacer = spacerRef.current;
    if (spacer) {
      spacer.style.width = size.width ? `${size.width}px` : '100%';
      spacer.style.height = `${size.height}px`;
    }
    setContentSize(prev =>
      prev.width === size.width && prev.height === size.height ? prev : size
    );
  }, []);

  const scheduleRender = useCallback(() => {
    if (animFrameRef.current) return;
    animFrameRef.current = requestAnimationFrame(() => {
      animFrameRef.current = null;
      const renderer = rendererRef.current;
      if (!renderer) return;
      const state = renderState();
      renderer.render(state, scrollRef.current);
      applyContentSize(renderer.getContentSize(state));

      // How far out the view can usefully go depends on the window and on the
      // sequences, both of which change under us. This is the one place that
      // sees every such change, and the store ignores a value that has not moved.
      if (state.documents.length > 0) {
        useStore.getState().setMinZoom(renderer.getFitZoom(state));
      }
    });
  }, [applyContentSize]);

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current = new CanvasRenderer(canvas);
    rendererRef.current.setTheme(useStore.getState().theme);
    return () => rendererRef.current?.stopCursorBlink();
  }, []);

  // Resize with the container
  useEffect(() => {
    const container = containerRef.current;
    const renderer = rendererRef.current;
    if (!container || !renderer) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          renderer.resize(width, height);
          scheduleRender();
        }
      }
    });
    observer.observe(container);

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) renderer.resize(rect.width, rect.height);

    return () => observer.disconnect();
  }, [scheduleRender]);

  // Redraw on document/view changes
  useEffect(() => {
    scheduleRender();
  }, [workspace, scheduleRender]);

  // Redraw on theme change
  useEffect(() => {
    rendererRef.current?.setTheme(theme);
    scheduleRender();
  }, [theme, scheduleRender]);

  // Keep the renderer's metrics in step with the stored zoom, whoever changed it.
  useEffect(() => {
    rendererRef.current?.setZoom(zoom);
    scheduleRender();
  }, [zoom, scheduleRender]);

  // Redraw on palette change
  useEffect(() => {
    rendererRef.current?.setPalette(colorPalette);
    scheduleRender();
  }, [colorPalette, scheduleRender]);

  // Redraw when the search hits change, so the highlights follow them
  useEffect(() => {
    scheduleRender();
  }, [find, scheduleRender]);

  // Imperative handles for the toolbar and dialogs, which have no ref to any of this.
  useEffect(() => {
    return registerCanvasApi({
      /** Zoom so the longest sequence fills the view. */
      fitToWidth: () => {
        const renderer = rendererRef.current;
        if (!renderer) return;
        const state = renderState();
        if (state.documents.length === 0) return;
        setZoom(renderer.getFitZoom(state));
      },

      /** Scroll `col` to the middle of the sequence area, and flash it. */
      centerOnColumn: (col, options = {}) => {
        const renderer = rendererRef.current;
        const container = containerRef.current;
        if (!renderer || !container) return;
        const state = renderState();
        const gutter = renderer.isStacked(state) ? renderer.getGutterWidth(state) : 0;
        const viewportWidth = renderer.width - gutter;
        container.scrollLeft = Math.max(0, col * renderer.cellWidth - viewportWidth / 2);
        scrollRef.current = { top: container.scrollTop, left: container.scrollLeft };
        if (options.flash !== false) renderer.flashColumn(col);
        scheduleRender();
        // The flash fades on its own, so the frames that show it fading have to
        // be asked for — nothing else changes in that window.
        setTimeout(scheduleRender, 200);
        setTimeout(scheduleRender, 500);
        setTimeout(scheduleRender, 900);
      },

      /** Scroll a row into view vertically (used when a search match is off-screen). */
      revealRow: (docId) => {
        const renderer = rendererRef.current;
        const container = containerRef.current;
        if (!renderer || !container) return;
        const state = renderState();
        const row = state.documents.findIndex(d => d.id === docId);
        if (row === -1 || !renderer.isStacked(state)) return;
        const rowHeight = renderer.getRowHeight(state.viewSettings.showComplement);
        const seqAreaHeight = renderer.height - renderer.getSeqAreaTop(state);
        const top = row * rowHeight;
        if (top < container.scrollTop || top + rowHeight > container.scrollTop + seqAreaHeight) {
          container.scrollTop = Math.max(0, top - seqAreaHeight / 2 + rowHeight);
          scrollRef.current = { top: container.scrollTop, left: container.scrollLeft };
          scheduleRender();
        }
      },

      /** The renderer itself, for exporters that re-draw the current view. */
      getRenderer: () => rendererRef.current,
      getScroll: () => scrollRef.current,
    });
  }, [scheduleRender, setZoom]);

  // Ctrl/Cmd + wheel zooms about the pointer, as in Geneious. The listener is
  // native rather than React's onWheel because that one is passive, and so cannot
  // preventDefault the browser's own page zoom.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const renderer = rendererRef.current;
      const state = renderState();
      if (!renderer || state.documents.length === 0) return;

      const current = useStore.getState().workspace.viewSettings.zoom;
      const delta = e.deltaMode === 1 ? e.deltaY * LINE_DELTA_PX : e.deltaY;
      const next = clampZoom(current * Math.exp(-delta * ZOOM_SENSITIVITY));
      if (next === current) return;

      const rect = renderer.canvas.getBoundingClientRect();
      const anchor = renderer.getZoomAnchor(
        e.clientX - rect.left, e.clientY - rect.top, scrollRef.current, state
      );

      renderer.setZoom(next);
      // Resize the spacer first: the container will not scroll past an extent it
      // does not have yet.
      applyContentSize(renderer.getContentSize(state));

      const scroll = renderer.getScrollForAnchor(anchor, state);
      container.scrollTop = scroll.top;
      container.scrollLeft = scroll.left;
      scrollRef.current = { top: container.scrollTop, left: container.scrollLeft };

      setZoom(next);
      scheduleRender();
    }

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [applyContentSize, scheduleRender, setZoom]);

  // Cursor blink
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.startCursorBlink();
    const interval = setInterval(scheduleRender, 530);
    return () => {
      clearInterval(interval);
      renderer.stopCursorBlink();
    };
  }, [scheduleRender]);

  const handleScroll = useCallback((e) => {
    scrollRef.current = { top: e.target.scrollTop, left: e.target.scrollLeft };
    scheduleRender();
  }, [scheduleRender]);

  /** Feature details follow the pointer; the canvas itself cannot hold a tooltip. */
  const handleHover = useCallback((e) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const rect = renderer.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = renderer.hitTest(x, y, scrollRef.current, renderState());
    setTooltip(prev => {
      if (hit?.kind !== 'annotation') return prev === null ? prev : null;
      if (prev?.feature?.id === hit.feature.id) return prev;
      return { x, y, feature: hit.feature };
    });
  }, []);

  // Mouse + keyboard handlers
  const mouseHandlersRef = useRef(null);
  const keyHandlerRef = useRef(null);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const actions = useStore.getState();
    const getContext = () => {
      const state = useStore.getState();
      return {
        state: renderState(),
        doc: getActiveDoc(state),
        scroll: scrollRef.current,
        editingEnabled: state.workspace.editingEnabled,
        basesPerRow: renderer.getBasesPerRow(state.workspace.viewSettings.lineWidth),
      };
    };

    const mouse = createMouseHandlers(renderer, getContext, actions, scheduleRender);
    mouseHandlersRef.current = mouse;

    const { handleSelectionKeys } = createSelectionKeyHandlers(getContext, actions);
    keyHandlerRef.current = createEditingKeyHandler(getContext, actions, handleSelectionKeys);

    return () => mouse.destroy();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`sequence-canvas-container ${fullscreen ? 'fullscreen' : ''}`}
      onScroll={handleScroll}
    >
      <div
        ref={spacerRef}
        style={{
          width: contentSize.width || '100%',
          height: contentSize.height,
          minHeight: '100%',
          position: 'relative',
        }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="sequence-canvas"
          onMouseDown={(e) => mouseHandlersRef.current?.onMouseDown(e)}
          onMouseMove={(e) => {
            mouseHandlersRef.current?.onMouseMove(e);
            handleHover(e);
          }}
          onMouseLeave={() => setTooltip(null)}
          onKeyDown={(e) => keyHandlerRef.current?.(e)}
          style={{ position: 'sticky', top: 0, left: 0 }}
        />

        {tooltip && (
          <div
            className="annotation-tooltip"
            style={{ left: tooltip.x + 14, top: tooltip.y + 16 }}
          >
            <div>{describeFeature(tooltip.feature)}</div>
            {tooltip.feature.notes && (
              <div className="tooltip-notes">{tooltip.feature.notes}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
