// SequenceCanvas: React wrapper for the canvas-based sequence renderer.
// Manages canvas lifecycle, 2D scroll, resize, and wires selection/editing handlers.

import { useRef, useEffect, useCallback, useState } from 'react';
import useStore, { getActiveDoc } from './store.js';
import { CanvasRenderer } from './canvasRenderer.js';
import { createMouseHandlers, createSelectionKeyHandlers } from './selection.js';
import { createEditingKeyHandler } from './editing.js';

/** The slice of store state the renderer draws from. */
function renderState() {
  const { documents, activeDocId, viewSettings, dragInsertIndex } = useStore.getState().workspace;
  return { documents, activeDocId, viewSettings, dragInsertIndex };
}

export default function SequenceCanvas() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const scrollRef = useRef({ top: 0, left: 0 });
  const animFrameRef = useRef(null);

  const workspace = useStore(s => s.workspace);
  const theme = useStore(s => s.theme);
  const { fullscreen } = workspace.viewSettings;

  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });

  const scheduleRender = useCallback(() => {
    if (animFrameRef.current) return;
    animFrameRef.current = requestAnimationFrame(() => {
      animFrameRef.current = null;
      const renderer = rendererRef.current;
      if (!renderer) return;
      const state = renderState();
      renderer.render(state, scrollRef.current);
      const size = renderer.getContentSize(state);
      setContentSize(prev =>
        prev.width === size.width && prev.height === size.height ? prev : size
      );
    });
  }, []);

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

    const mouse = createMouseHandlers(renderer, getContext, actions);
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
          onMouseMove={(e) => mouseHandlersRef.current?.onMouseMove(e)}
          onKeyDown={(e) => keyHandlerRef.current?.(e)}
          style={{ position: 'sticky', top: 0, left: 0 }}
        />
      </div>
    </div>
  );
}
