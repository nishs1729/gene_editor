// App: root component wiring toolbar, stats, canvas, selection readout, and toast.

import { useEffect, useState } from 'react';
import useStore from './store.js';
import Toolbar from './Toolbar.jsx';
import StatsPanel from './StatsPanel.jsx';
import SequenceCanvas from './SequenceCanvas.jsx';
import SelectionReadout from './SelectionReadout.jsx';
import RenameDialog from './RenameDialog.jsx';
import HelpModal from './HelpModal.jsx';
import FindBar from './FindBar.jsx';
import JumpDialog from './JumpDialog.jsx';
import DistanceMatrixModal from './DistanceMatrixModal.jsx';
import TreeModal from './TreeModal.jsx';
import AnnotationDialog from './AnnotationDialog.jsx';
import Toast from './Toast.jsx';
import { parseFasta } from './fasta.js';
import { ZOOM_STEP } from './ZoomControls.jsx';

/** Keystrokes aimed at a form field are that field's, not the editor's. */
function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
}

export default function App() {
  const fullscreen = useStore(s => s.workspace.viewSettings.fullscreen);
  const theme = useStore(s => s.theme);
  const toggleFullscreen = useStore(s => s.toggleFullscreen);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Window-level shortcuts: view and dialog commands, which have to work wherever
  // focus is. Sequence editing keys stay on the canvas, in editing.js.
  useEffect(() => {
    function handleKeyDown(e) {
      const store = useStore.getState();

      if (e.key === 'Escape') {
        if (store.dialog !== null) return; // the modal closes itself
        if (store.find.open) {
          store.closeFind();
          return;
        }
        if (fullscreen) toggleFullscreen();
        return;
      }

      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        store.setZoom(store.workspace.viewSettings.zoom * ZOOM_STEP);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        // setZoom does the clamping, including the fit-to-window floor.
        store.setZoom(store.workspace.viewSettings.zoom / ZOOM_STEP);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        store.setZoom(1);
        return;
      }
      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        store.openFind();
        return;
      }
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        store.openDialog('jump');
        return;
      }
      if (!mod && (e.key === '?' || e.key === 'F1')) {
        e.preventDefault();
        store.openDialog(store.dialog === 'help' ? null : 'help');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreen, toggleFullscreen]);

  // Dropping a FASTA file anywhere on the window opens it.
  function handleDrop(e) {
    e.preventDefault();
    setDropActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    const store = useStore.getState();
    const reader = new FileReader();
    reader.onload = ev => {
      const records = parseFasta(ev.target.result).filter(r => r.sequence.length > 0);
      if (records.length === 0) {
        store.showToast('No valid sequences found in file', 'error');
        return;
      }
      store.loadWorkspace(records, file.name);
      store.showToast(
        records.length === 1
          ? `Loaded "${records[0].name}" (${records[0].sequence.length.toLocaleString()} bp)`
          : `Loaded ${records.length} sequences`,
        'info'
      );
    };
    reader.readAsText(file);
  }

  return (
    <div
      className={`app ${fullscreen ? 'app-fullscreen' : ''} ${dropActive ? 'app-drop-active' : ''}`}
      onDragOver={e => { e.preventDefault(); setDropActive(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropActive(false); }}
      onDrop={handleDrop}
    >
      <Toolbar />
      {!fullscreen && <StatsPanel />}
      <div className="canvas-area">
        <SequenceCanvas />
        <FindBar />
      </div>
      {/* The status bar stays in fullscreen: it is where zoom and the view
          options live, and losing them is worse than losing 30px of canvas. */}
      <SelectionReadout />
      <RenameDialog />
      <HelpModal />
      <JumpDialog />
      <DistanceMatrixModal />
      <TreeModal />
      <AnnotationDialog />
      <Toast />
    </div>
  );
}
