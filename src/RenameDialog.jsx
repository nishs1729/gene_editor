// RenameDialog: the F2 rename prompt for a sequence name.

import { useEffect, useRef } from 'react';
import useStore from './store.js';

/** The canvas owns the keyboard; without this, editing stops after a rename. */
function refocusCanvas() {
  document.querySelector('.sequence-canvas')?.focus();
}

export default function RenameDialog() {
  const doc = useStore(s => s.workspace.documents.find(d => d.id === s.workspace.renamingDocId));
  const renameDoc = useStore(s => s.renameDoc);
  const cancelRename = useStore(s => s.cancelRename);
  const inputRef = useRef(null);

  // Pre-select the whole name, so typing replaces it as it does in a file browser.
  useEffect(() => {
    inputRef.current?.select();
  }, [doc?.id]);

  if (!doc) return null;

  function commit() {
    renameDoc(doc.id, inputRef.current.value);
    refocusCanvas();
  }

  function close() {
    cancelRename();
    refocusCanvas();
  }

  function handleKeyDown(e) {
    // The window-level Escape handler would otherwise leave fullscreen too.
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') close();
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <label className="modal-label" htmlFor="rename-input">Rename sequence</label>
        <input
          id="rename-input"
          ref={inputRef}
          className="modal-input"
          defaultValue={doc.name}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div className="modal-actions">
          <button className="toolbar-btn" onClick={close}>Cancel</button>
          <button className="toolbar-btn toolbar-btn-primary" onClick={commit}>Rename</button>
        </div>
      </div>
    </div>
  );
}
