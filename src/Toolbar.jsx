// Toolbar: file operations, edit lock, undo/redo, complement toggles, theme, fullscreen.

import { useRef } from 'react';
import useStore, { getActiveDoc } from './store.js';
import { parseFasta, toFasta } from './fasta.js';

export default function Toolbar() {
  const fileInputRef = useRef(null);

  const workspace = useStore(s => s.workspace);
  const theme = useStore(s => s.theme);
  const activeDoc = useStore(getActiveDoc);
  const loadWorkspace = useStore(s => s.loadWorkspace);
  const undoAction = useStore(s => s.undo);
  const redoAction = useStore(s => s.redo);
  const toggleComplement = useStore(s => s.toggleComplement);
  const toggleFullscreen = useStore(s => s.toggleFullscreen);
  const toggleEditingEnabled = useStore(s => s.toggleEditingEnabled);
  const toggleTheme = useStore(s => s.toggleTheme);
  const reverseComplementActive = useStore(s => s.reverseComplementActive);
  const save = useStore(s => s.save);
  const showToast = useStore(s => s.showToast);

  const { editingEnabled, viewSettings } = workspace;
  const hasSequence = (activeDoc?.raw.length ?? 0) > 0;
  const canUndo = editingEnabled && (activeDoc?.history.length ?? 0) > 0;
  const canRedo = editingEnabled && (activeDoc?.future.length ?? 0) > 0;
  const isDirty = workspace.documents.some(d => d.dirty);

  function handleFileLoad(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const records = parseFasta(ev.target.result).filter(r => r.sequence.length > 0);
      if (records.length === 0) {
        showToast('No valid sequences found in file', 'error');
        return;
      }
      loadWorkspace(records);
      showToast(
        records.length === 1
          ? `Loaded "${records[0].name}" (${records[0].sequence.length.toLocaleString()} bp)`
          : `Loaded ${records.length} sequences`,
        'info'
      );
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-loading the same file
  }

  function handleExport() {
    if (!activeDoc || !hasSequence) {
      showToast('No sequence to export', 'warning');
      return;
    }
    const name = activeDoc.name || 'sequence';
    const blob = new Blob([toFasta(name, activeDoc.raw)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.fasta`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported "${name}"`, 'info');
  }

  function handleReverseComplement() {
    if (!editingEnabled) {
      showToast('Click "Allow Editing" to edit this sequence', 'warning');
      return;
    }
    reverseComplementActive();
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
          accept=".fasta,.fa,.fna,.fas,.aln,.txt"
          onChange={handleFileLoad}
          style={{ display: 'none' }}
        />

        <button className="toolbar-btn" onClick={handleExport} disabled={!hasSequence} title="Export the active sequence as FASTA">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 14h12M8 2v9M4 7l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export
        </button>

        <button className="toolbar-btn" onClick={save} disabled={!isDirty} title="Save the workspace (Ctrl+S)">
          Save{isDirty ? ' •' : ''}
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${editingEnabled ? 'toolbar-btn-active' : ''}`}
          onClick={toggleEditingEnabled}
          title={editingEnabled ? 'Lock the sequence against edits' : 'Unlock the sequence for editing'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            {editingEnabled
              ? <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              : <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>}
          </svg>
          Allow Editing
        </button>

        <button className="toolbar-btn" onClick={undoAction} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h7a3 3 0 0 1 0 6H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M6 3L3 6l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Undo
        </button>
        <button className="toolbar-btn" onClick={redoAction} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
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
          className={`toolbar-btn ${viewSettings.showComplement ? 'toolbar-btn-active' : ''}`}
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

        <button className="toolbar-btn" onClick={handleReverseComplement} disabled={!hasSequence} title="Reverse-complement the active sequence">
          RevComp
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-btn-icon"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 11.2A6.5 6.5 0 0 1 6.8 3a6.5 6.5 0 1 0 8.2 8.2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          )}
        </button>

        <button
          className={`toolbar-btn toolbar-btn-icon ${viewSettings.fullscreen ? 'toolbar-btn-active' : ''}`}
          onClick={toggleFullscreen}
          title={viewSettings.fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
        >
          {viewSettings.fullscreen ? (
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
