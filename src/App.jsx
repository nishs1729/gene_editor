// App: root component wiring toolbar, stats, canvas, selection readout, and toast.

import { useEffect } from 'react';
import useStore from './store.js';
import Toolbar from './Toolbar.jsx';
import StatsPanel from './StatsPanel.jsx';
import SequenceCanvas from './SequenceCanvas.jsx';
import SelectionReadout from './SelectionReadout.jsx';
import Toast from './Toast.jsx';

export default function App() {
  const fullscreen = useStore(s => s.workspace.viewSettings.fullscreen);
  const theme = useStore(s => s.theme);
  const toggleFullscreen = useStore(s => s.toggleFullscreen);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && fullscreen) toggleFullscreen();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreen, toggleFullscreen]);

  return (
    <div className={`app ${fullscreen ? 'app-fullscreen' : ''}`}>
      <Toolbar />
      {!fullscreen && <StatsPanel />}
      <SequenceCanvas />
      {!fullscreen && <SelectionReadout />}
      <Toast />
    </div>
  );
}
