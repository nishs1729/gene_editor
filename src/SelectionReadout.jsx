// SelectionReadout: displays current selection range and length in the status bar.

import useStore from './store.js';

export default function SelectionReadout() {
  const selection = useStore(s => s.doc.selection);
  const cursorPos = useStore(s => s.doc.cursorPos);
  const seqLength = useStore(s => s.doc.length);

  if (seqLength === 0) return null;

  if (selection) {
    const len = selection.end - selection.start;
    return (
      <div className="selection-readout">
        <span className="readout-label">Selection:</span>
        <span className="readout-value">
          {selection.start + 1}–{selection.end} ({len} base{len !== 1 ? 's' : ''})
        </span>
      </div>
    );
  }

  return (
    <div className="selection-readout">
      <span className="readout-label">Position:</span>
      <span className="readout-value">{(cursorPos ?? 0) + 1}</span>
    </div>
  );
}
