// Toolbar: file operations, undo/redo, reverse-complement toggle, line width, fullscreen.

import { useRef } from 'react';
import useStore from './store.js';
import { parseFasta, toFasta } from './fasta.js';
import { reverseComplement } from './sequenceModel.js';

export default function Toolbar() {
  const fileInputRef = useRef(null);

  const doc = useStore(s => s.doc);
  const loadDocument = useStore(s => s.loadDocument);
  const undoAction = useStore(s => s.undo);
  const redoAction = useStore(s => s.redo);
  const toggleComplement = useStore(s => s.toggleComplement);
  const toggleFullscreen = useStore(s => s.toggleFullscreen);
  const showToast = useStore(s => s.showToast);

  const canUndo = doc.history.length > 0;
  const canRedo = doc.future.length > 0;

  // Load FASTA file
  function handleFileLoad(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const records = parseFasta(text);
      if (records.length === 0) {
        showToast('No valid sequences found in file', 'error');
        return;
      }
      const { name, sequence } = records[0];
      if (sequence.length === 0) {
        showToast('Sequence is empty', 'warning');
        return;
      }
      loadDocument(name, sequence);
      showToast(`Loaded "${name}" (${sequence.length.toLocaleString()} bp)`, 'info');
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-loaded
    e.target.value = '';
  }

  // Export FASTA
  function handleExport() {
    if (doc.raw.length === 0) {
      showToast('No sequence to export', 'warning');
      return;
    }

    const fastaStr = toFasta(doc.name || 'sequence', doc.raw);
    const blob = new Blob([fastaStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name || 'sequence'}.fasta`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported FASTA file', 'info');
  }

  // Apply reverse complement (mutates raw, pushable to undo)
  function handleReverseComplement() {
    if (doc.raw.length === 0) return;
    const rc = reverseComplement(doc.raw);
    loadDocument(doc.name + ' (RC)', rc);
    showToast('Applied reverse complement', 'info');
  }

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-btn-primary"
          onClick={() => fileInputRef.current?.click()}
          title="Load a FASTA file"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 14h12M8 2v9M4 7l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(180 8 8)"/>
          </svg>
          Load FASTA
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".fasta,.fa,.fna,.fas,.txt"
          onChange={handleFileLoad}
          style={{ display: 'none' }}
        />

        <button
          className="toolbar-btn"
          onClick={handleExport}
          disabled={doc.raw.length === 0}
          title="Export sequence as FASTA"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 14h12M8 2v9M4 7l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={undoAction}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h7a3 3 0 0 1 0 6H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M6 3L3 6l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Undo
        </button>
        <button
          className="toolbar-btn"
          onClick={redoAction}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 6H6a3 3 0 0 0 0 6h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M10 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Redo
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${doc.viewSettings.showComplement ? 'toolbar-btn-active' : ''}`}
          onClick={toggleComplement}
          title="Toggle complement strand display"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 5h12M2 11h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="5" cy="5" r="1" fill="currentColor"/>
            <circle cx="11" cy="11" r="1" fill="currentColor"/>
          </svg>
          Complement
        </button>

        <button
          className="toolbar-btn"
          onClick={handleReverseComplement}
          disabled={doc.raw.length === 0}
          title="Apply reverse complement to the sequence"
        >
          RevComp
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <button
          className={`toolbar-btn toolbar-btn-icon ${doc.viewSettings.fullscreen ? 'toolbar-btn-active' : ''}`}
          onClick={toggleFullscreen}
          title={doc.viewSettings.fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
        >
          {doc.viewSettings.fullscreen ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 2v4H2M12 2v4h4M6 16v-4H2M12 16v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 6V2h4M16 6V2h-4M2 12v4h4M16 12v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
