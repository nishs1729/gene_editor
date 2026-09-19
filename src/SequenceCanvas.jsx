// SequenceCanvas: React wrapper for the canvas-based sequence renderer.
// Manages canvas lifecycle, scroll, resize, and wires selection/editing handlers.

import { useRef, useEffect, useCallback } from 'react';
import useStore from './store.js';
import { CanvasRenderer } from './canvasRenderer.js';
import { createMouseHandlers, createSelectionKeyHandlers } from './selection.js';
import { createEditingKeyHandler } from './editing.js';

export default function SequenceCanvas() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const scrollTopRef = useRef(0);
  const animFrameRef = useRef(null);

  // Subscribe to the pieces of state we need
  const doc = useStore(s => s.doc);
  const fullscreen = useStore(s => s.doc.viewSettings.fullscreen);

  // Get store actions (stable references)
  const storeActions = useRef(null);
  storeActions.current = {
    setSelection: useStore.getState().setSelection,
    setCursorPos: useStore.getState().setCursorPos,
    clearSelection: useStore.getState().clearSelection,
    substitute: useStore.getState().substitute,
    insertAt: useStore.getState().insertAt,
    deleteRange: useStore.getState().deleteRange,
    undo: useStore.getState().undo,
    redo: useStore.getState().redo,
    showToast: useStore.getState().showToast,
  };

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    rendererRef.current = new CanvasRenderer(canvas);

    return () => {
      if (rendererRef.current) {
        rendererRef.current.stopCursorBlink();
      }
    };
  }, []);

  // Resize handler
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

    // Initial size
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      renderer.resize(rect.width, rect.height);
    }

    return () => observer.disconnect();
  }, []);

  // Schedule a render on the next animation frame (debounced)
  const scheduleRender = useCallback(() => {
    if (animFrameRef.current) return;
    animFrameRef.current = requestAnimationFrame(() => {
      animFrameRef.current = null;
      const renderer = rendererRef.current;
      if (!renderer) return;
      const currentDoc = useStore.getState().doc;
      renderer.render(currentDoc, scrollTopRef.current);
    });
  }, []);

  // Re-render when doc changes
  useEffect(() => {
    scheduleRender();
  }, [doc, scheduleRender]);

  // Cursor blink re-render
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.startCursorBlink();
    const blinkInterval = setInterval(() => {
      scheduleRender();
    }, 530);

    return () => {
      clearInterval(blinkInterval);
      renderer.stopCursorBlink();
    };
  }, [scheduleRender]);

  // Scroll handler
  const handleScroll = useCallback((e) => {
    scrollTopRef.current = e.target.scrollTop;
    scheduleRender();
  }, [scheduleRender]);

  // Mouse handlers
  const mouseHandlersRef = useRef(null);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const getState = () => ({
      doc: useStore.getState().doc,
      scrollTop: scrollTopRef.current,
    });

    mouseHandlersRef.current = createMouseHandlers(renderer, getState, storeActions.current);
  }, []);

  // Keyboard handler
  const keyHandlerRef = useRef(null);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const getState = () => ({
      doc: useStore.getState().doc,
    });

    const getBasesPerRow = () => {
      return renderer.getBasesPerRow(useStore.getState().doc.viewSettings.lineWidth);
    };

    const { handleSelectionKeys } = createSelectionKeyHandlers(getState, storeActions.current, getBasesPerRow);
    keyHandlerRef.current = createEditingKeyHandler(getState, storeActions.current, handleSelectionKeys);
  }, []);

  // Compute total scrollable height
  const renderer = rendererRef.current;
  let totalHeight = 0;
  if (renderer && doc.raw.length > 0) {
    const basesPerRow = renderer.getBasesPerRow(doc.viewSettings.lineWidth);
    totalHeight = renderer.getTotalHeight(doc.raw, basesPerRow, doc.viewSettings.showComplement);
  }

  return (
    <div
      ref={containerRef}
      className={`sequence-canvas-container ${fullscreen ? 'fullscreen' : ''}`}
      onScroll={handleScroll}
      style={{
        overflow: 'auto',
        flex: 1,
        position: 'relative',
      }}
    >
      <div style={{ height: totalHeight, minHeight: '100%', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="sequence-canvas"
          onMouseDown={(e) => mouseHandlersRef.current?.onMouseDown(e)}
          onMouseMove={(e) => mouseHandlersRef.current?.onMouseMove(e)}
          onMouseUp={(e) => mouseHandlersRef.current?.onMouseUp(e)}
          onKeyDown={(e) => keyHandlerRef.current?.(e)}
          style={{
            position: 'sticky',
            top: 0,
            left: 0,
            display: 'block',
            outline: 'none',
            cursor: 'text',
          }}
        />
      </div>
    </div>
  );
}
