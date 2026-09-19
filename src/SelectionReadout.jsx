// SelectionReadout: current selection range and length for the active sequence.

import useStore, { getActiveDoc } from './store.js';

export default function SelectionReadout() {
  const doc = useStore(getActiveDoc);
  const editingEnabled = useStore(s => s.workspace.editingEnabled);

  if (!doc || doc.length === 0) return null;

  const selection = doc.selection;

  return (
    <div className="selection-readout">
      {selection ? (
        <>
          <span className="readout-label">Selection:</span>
          <span className="readout-value">
            {selection.start + 1}–{selection.end} ({(selection.end - selection.start).toLocaleString()} base
            {selection.end - selection.start !== 1 ? 's' : ''})
          </span>
        </>
      ) : (
        <>
          <span className="readout-label">Position:</span>
          <span className="readout-value">{(doc.cursorPos ?? 0) + 1}</span>
        </>
      )}
      {!editingEnabled && <span className="readout-lock">Read-only — click “Allow Editing” to edit</span>}
    </div>
  );
}
