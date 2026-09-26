// Toolbar: what acts on the data — files, edit lock, undo/redo, organisation,
// cleanup, transforms, analysis and export. How the canvas *draws* that data
// (zoom, palette, tracks) lives in the status bar instead, in SelectionReadout.

import { useRef, useState } from 'react';
import useStore, { getActiveDoc, currentFiles, projectOf } from './store.js';
import ToolbarMenu, { MenuItem, MenuToggle, MenuSection } from './ToolbarMenu.jsx';
import { TRANSFORMS } from './sequenceModel.js';
import {
  downloadBlob, downloadText, fastaFor, modifiedFileName, projectFileName, selectionFileName,
} from './exporters.js';
import { encodeProject } from './project.js';
import { createZip } from './zip.js';
import { openFiles, OPEN_ACCEPT } from './openFiles.js';
import { MIN_TREE_SEQUENCES } from './phylogenetics.js';

// Matches the percentages Geneious offers on its own consensus threshold control.
const CONSENSUS_THRESHOLDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95, 1];

const SORT_MODES = [
  { id: 'name-asc', label: 'Name (A–Z)' },
  { id: 'name-desc', label: 'Name (Z–A)' },
  { id: 'length-desc', label: 'Length (longest first)' },
  { id: 'length-asc', label: 'Length (shortest first)' },
  { id: 'similarity', label: 'Similarity to reference' },
];

const TRANSFORM_SCOPES = [
  { id: 'active', label: 'Active sequence' },
  { id: 'selected', label: 'Selected sequences' },
  { id: 'span', label: 'Selected span' },
];

export default function Toolbar() {
  const fileInputRef = useRef(null);
  const [trimCoverage, setTrimCoverage] = useState(70);
  const [transformScope, setTransformScope] = useState('active');

  const workspace = useStore(s => s.workspace);
  const theme = useStore(s => s.theme);
  const activeDoc = useStore(getActiveDoc);
  const undoAction = useStore(s => s.undo);
  const redoAction = useStore(s => s.redo);
  const toggleComplement = useStore(s => s.toggleComplement);
  const toggleFullscreen = useStore(s => s.toggleFullscreen);
  const toggleEditingEnabled = useStore(s => s.toggleEditingEnabled);
  const toggleTheme = useStore(s => s.toggleTheme);
  const toggleConsensus = useStore(s => s.toggleConsensus);
  const setConsensusThreshold = useStore(s => s.setConsensusThreshold);
  const setHighlightMode = useStore(s => s.setHighlightMode);
  const save = useStore(s => s.save);
  const showToast = useStore(s => s.showToast);

  const toggleReferenceDoc = useStore(s => s.toggleReferenceDoc);
  const sortDocs = useStore(s => s.sortDocs);
  const showAllDocs = useStore(s => s.showAllDocs);
  const createGroup = useStore(s => s.createGroup);
  const ungroup = useStore(s => s.ungroup);
  const addSelectionToGroup = useStore(s => s.addSelectionToGroup);
  const stripGapColumns = useStore(s => s.stripGapColumns);
  const trimEnds = useStore(s => s.trimEnds);
  const padSequences = useStore(s => s.padSequences);
  const applyTransform = useStore(s => s.applyTransform);
  const openAnnotation = useStore(s => s.openAnnotation);
  const openDialog = useStore(s => s.openDialog);

  const { editingEnabled, viewSettings, selectedDocIds } = workspace;
  const hasSequence = (activeDoc?.raw.length ?? 0) > 0;
  const hasFiles = workspace.files.length > 0;
  // The reference is a single sequence, so the button only acts on an unambiguous
  // selection of one.
  const singleSelectedId = selectedDocIds.size === 1 ? [...selectedDocIds][0] : null;
  const hasReference = viewSettings.referenceDocId !== null;
  const canUndo = workspace.workspaceHistory.length > 0
    || (editingEnabled && (activeDoc?.history.length ?? 0) > 0);
  const canRedo = workspace.workspaceFuture.length > 0
    || (editingEnabled && (activeDoc?.future.length ?? 0) > 0);
  // Save covers every open file, so any of them having changed counts.
  const isDirty = workspace.unsavedChanges
    || currentFiles(workspace).some(f => f.documents.some(d => d.dirty));
  const isStacked = workspace.documents.length > 1;
  const selectedCount = selectedDocIds.size;

  function handleOpen(e) {
    openFiles([...(e.target.files ?? [])]);
    e.target.value = ''; // allow opening the same file again
  }

  function exportFasta(fileName, documents, label) {
    const text = fastaFor(documents);
    if (!text) {
      showToast('No sequences to export', 'warning');
      return;
    }
    downloadText(fileName, text);
    showToast(`Exported ${label} as ${fileName}`, 'info');
  }

  async function handleExportProject() {
    const files = currentFiles(workspace);
    try {
      const blob = await encodeProject(projectOf(workspace));
      const fileName = projectFileName(files.map(f => f.name));
      downloadBlob(fileName, blob);
      showToast(`Exported the project as ${fileName}`, 'info');
    } catch {
      showToast('Could not write the project file', 'error');
    }
  }

  function handleExportFile() {
    exportFasta(modifiedFileName(workspace.fileName), workspace.documents, 'this file');
  }

  function handleExportSelected() {
    const selected = workspace.documents.filter(d => selectedDocIds.has(d.id));
    const label = `${selected.length} sequence${selected.length === 1 ? '' : 's'}`;
    exportFasta(selectionFileName(workspace.fileName, selected), selected, label);
  }

  function handleExportAllFiles() {
    const entries = currentFiles(workspace)
      .map(f => ({ name: modifiedFileName(f.name), data: fastaFor(f.documents) }))
      .filter(e => e.data);
    if (entries.length === 0) {
      showToast('No sequences to export', 'warning');
      return;
    }
    downloadBlob('all_files_modified.zip', new Blob([createZip(entries)], { type: 'application/zip' }));
    showToast(`Exported ${entries.length} file${entries.length === 1 ? '' : 's'} as all_files_modified.zip`, 'info');
  }

  /** Cleanup and transform operations rewrite sequence data, so they respect the lock. */
  function withEditing(action) {
    return () => {
      if (!editingEnabled) {
        showToast('Click "Allow Editing" to change these sequences', 'warning');
        return;
      }
      action();
    };
  }

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-btn-primary"
          onClick={() => fileInputRef.current?.click()}
          title="Open FASTA files, or a .gene project (you can also drop them on the window)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 14h12M8 2v9M4 7l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(180 8 8)"/>
          </svg>
          Open
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={OPEN_ACCEPT}
          onChange={handleOpen}
          multiple
          style={{ display: 'none' }}
        />

        <ToolbarMenu label="Export" title="Save your work to files" disabled={!hasFiles}>
          {close => (
            <>
              <MenuItem
                onClick={() => { handleExportProject(); close(); }}
                title="Everything that's open (all files, edits, undo history and view settings) in one .gene file you can reopen on any machine"
              >
                Project (.gene)
              </MenuItem>

              <MenuSection>FASTA</MenuSection>
              <MenuItem
                onClick={() => { handleExportFile(); close(); }}
                title={`The sequences of the file on screen, saved as ${modifiedFileName(workspace.fileName)}`}
              >
                This file
              </MenuItem>
              <MenuItem
                onClick={() => { handleExportSelected(); close(); }}
                disabled={selectedCount === 0}
                title={selectedCount === 0
                  ? 'Select sequences first: click a name, Ctrl+click to add more'
                  : 'Only the selected sequences, as a single FASTA file'}
              >
                Selected sequences{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </MenuItem>
              <MenuItem
                onClick={() => { handleExportAllFiles(); close(); }}
                title="Every open file, each saved as its own <name>_modified FASTA, together in one .zip"
              >
                All files (.zip)
              </MenuItem>
            </>
          )}
        </ToolbarMenu>

        <button
          className="toolbar-btn"
          onClick={save}
          disabled={!hasFiles && !isDirty}
          title="Keep every open file, with its undo history, in this browser for next time (Ctrl+S)"
        >
          Save{isDirty ? ' •' : ''}
        </button>
      </div>

      {isStacked && (
        <>
          <div className="toolbar-separator" />
          <div className="toolbar-group">
            <button
              className={`toolbar-btn ${viewSettings.showConsensus ? 'toolbar-btn-active' : ''}`}
              onClick={toggleConsensus}
              title="Toggle the consensus row"
            >
              Consensus
            </button>
            <select
              className="toolbar-select"
              value={viewSettings.consensusThreshold}
              onChange={e => setConsensusThreshold(Number(e.target.value))}
              disabled={!viewSettings.showConsensus}
              title="Agreement required among the non-gap bases in a column before it is called; below this the consensus shows N"
              aria-label="Consensus threshold"
            >
              {CONSENSUS_THRESHOLDS.map(t => (
                <option key={t} value={t}>{Math.round(t * 100)}%</option>
              ))}
            </select>

            <select
              className="toolbar-select"
              value={viewSettings.highlightMode}
              onChange={e => setHighlightMode(e.target.value)}
              title="Grey out bases that agree with the consensus or with a reference sequence, so disagreements stand out"
              aria-label="Highlighting"
            >
              <option value="none">No highlighting</option>
              <option value="consensus">Disagreements to consensus</option>
              <option value="reference">Disagreements to reference</option>
            </select>

            {hasReference ? (
              <button
                className="toolbar-btn toolbar-btn-active"
                onClick={() => toggleReferenceDoc(viewSettings.referenceDocId)}
                title="Remove the current reference sequence"
              >
                Remove Reference
              </button>
            ) : (
              <button
                className="toolbar-btn"
                onClick={() => toggleReferenceDoc(singleSelectedId)}
                disabled={singleSelectedId === null}
                title={singleSelectedId === null
                  ? 'Click one sequence name to select it, then make it the reference'
                  : 'Make this sequence the reference the others are compared against'}
              >
                Add as Reference
              </button>
            )}

            <ToolbarMenu label="Organise" title="Order, group and hide sequences">
              {close => (
                <>
                  <MenuSection>Sort sequences</MenuSection>
                  {SORT_MODES.map(mode => (
                    <MenuItem
                      key={mode.id}
                      onClick={() => { sortDocs(mode.id); close(); }}
                      disabled={mode.id === 'similarity' && !hasReference}
                      title={mode.id === 'similarity' && !hasReference
                        ? 'Set a reference sequence first'
                        : undefined}
                    >
                      {mode.label}
                    </MenuItem>
                  ))}

                  <MenuSection>Groups</MenuSection>
                  <MenuItem
                    onClick={() => { createGroup(`Group ${workspace.groups.length + 1}`); close(); }}
                    disabled={selectedCount === 0}
                    title="Collect the selected sequences under one collapsible header"
                  >
                    Group {selectedCount > 0 ? `${selectedCount} selected` : 'selection'}
                  </MenuItem>
                  {workspace.groups.map(group => (
                    <MenuItem
                      key={group.id}
                      onClick={() => {
                        if (selectedCount > 0) addSelectionToGroup(group.id);
                        else ungroup(group.id);
                        close();
                      }}
                    >
                      {selectedCount > 0 ? `Add to "${group.name}"` : `Ungroup "${group.name}"`}
                    </MenuItem>
                  ))}

                  <MenuSection>Hidden tracks</MenuSection>
                  <MenuItem
                    onClick={() => { showAllDocs(); close(); }}
                    disabled={workspace.hiddenDocIds.size === 0}
                  >
                    Show all ({workspace.hiddenDocIds.size} hidden)
                  </MenuItem>
                </>
              )}
            </ToolbarMenu>

            <button
              className="toolbar-btn"
              onClick={() => openDialog('distance')}
              title="Pairwise identity between every sequence"
            >
              Distances
            </button>

            <button
              className="toolbar-btn"
              onClick={() => openDialog('tree')}
              disabled={workspace.documents.length < MIN_TREE_SEQUENCES}
              title={workspace.documents.length < MIN_TREE_SEQUENCES
                ? `Load at least ${MIN_TREE_SEQUENCES} sequences to build a tree`
                : 'Build a phylogenetic tree (UPGMA or Neighbour-Joining)'}
            >
              Tree
            </button>

            <ToolbarMenu label="Tools" title="Alignment cleanup">
              {close => (
                <>
                  <MenuSection>Columns</MenuSection>
                  <MenuItem
                    onClick={() => { withEditing(stripGapColumns)(); close(); }}
                    title="Remove every column that is a gap in all sequences"
                  >
                    Strip all-gap columns
                  </MenuItem>
                  <MenuItem
                    onClick={() => { withEditing(padSequences)(); close(); }}
                    title="Pad shorter sequences with trailing gaps"
                  >
                    Pad to equal length
                  </MenuItem>

                  <MenuSection>Trim ragged ends</MenuSection>
                  <div className="menu-field">
                    <label htmlFor="trim-coverage">Min coverage</label>
                    <input
                      id="trim-coverage"
                      type="number"
                      min={1}
                      max={100}
                      value={trimCoverage}
                      onChange={e => setTrimCoverage(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                    />
                    <span>%</span>
                  </div>
                  <MenuItem
                    onClick={() => { withEditing(() => trimEnds(trimCoverage / 100))(); close(); }}
                    title="Trim 5' and 3' columns below that coverage"
                  >
                    Trim ends
                  </MenuItem>
                </>
              )}
            </ToolbarMenu>
          </div>
        </>
      )}

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

        <button
          className="toolbar-btn"
          onClick={() => {
            const selection = activeDoc?.selection;
            if (!selection) {
              showToast('Select the bases to annotate first', 'warning');
              return;
            }
            openAnnotation({ docId: activeDoc.id, start: selection.start, end: selection.end });
          }}
          disabled={!hasSequence}
          title="Annotate the selected span"
        >
          Annotate
        </button>

        <ToolbarMenu label="Transform" title="Reverse, complement and transcribe" disabled={!hasSequence}>
          {close => (
            <>
              <MenuSection>Apply to</MenuSection>
              {TRANSFORM_SCOPES.map(scope => (
                <MenuToggle
                  key={scope.id}
                  checked={transformScope === scope.id}
                  onClick={() => setTransformScope(scope.id)}
                  disabled={scope.id === 'selected' && selectedCount === 0}
                >
                  {scope.label}
                </MenuToggle>
              ))}

              <MenuSection>Transform</MenuSection>
              {Object.entries(TRANSFORMS).map(([kind, transform]) => (
                <MenuItem
                  key={kind}
                  onClick={() => { withEditing(() => applyTransform(kind, transformScope))(); close(); }}
                >
                  {transform.label}
                </MenuItem>
              ))}
            </>
          )}
        </ToolbarMenu>
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

        <button
          className="toolbar-btn toolbar-btn-icon"
          onClick={() => openDialog('help')}
          title="How to use this editor (?)"
          aria-label="How to use this editor"
        >
          ?
        </button>
      </div>
    </div>
  );
}
