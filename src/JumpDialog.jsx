// "Jump to position": a small prompt that scrolls a base position into view.

import { useEffect, useRef, useState } from 'react';
import useStore from './store.js';
import { getCanvasApi } from './canvasBridge.js';

function refocusCanvas() {
  document.querySelector('.sequence-canvas')?.focus();
}

export default function JumpDialog() {
  const open = useStore(s => s.dialog === 'jump');
  const closeDialog = useStore(s => s.closeDialog);
  const setColumnCursor = useStore(s => s.setColumnCursor);
  const showToast = useStore(s => s.showToast);
  const maxLength = useStore(s => s.workspace.documents.reduce((m, d) => Math.max(m, d.raw.length), 0));
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setValue('');
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  function close() {
    closeDialog();
    refocusCanvas();
  }

  function commit() {
    // Positions are quoted with thousands separators as often as not.
    const position = Number(value.replace(/[\s,_]/g, ''));
    if (!Number.isFinite(position) || position < 1) {
      showToast('Enter a base position, counting from 1', 'warning');
      return;
    }
    const col = Math.min(Math.round(position) - 1, Math.max(0, maxLength - 1));
    setColumnCursor(col);
    getCanvasApi()?.centerOnColumn(col);
    close();
  }

  function handleKeyDown(e) {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') close();
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <label className="modal-label" htmlFor="jump-input">
          Jump to position (1–{maxLength.toLocaleString()})
        </label>
        <input
          id="jump-input"
          ref={inputRef}
          className="modal-input"
          value={value}
          placeholder="e.g. 1,240"
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div className="modal-actions">
          <button className="toolbar-btn" onClick={close}>Cancel</button>
          <button className="toolbar-btn toolbar-btn-primary" onClick={commit}>Go</button>
        </div>
      </div>
    </div>
  );
}
