// OpenProjectDialog: when a project is opened while files are already open,
// asks whether it joins them or takes their place.

import useStore, { currentFiles } from './store.js';

export default function OpenProjectDialog() {
  const pending = useStore(s => s.pendingProjects[0]);
  const openCount = useStore(s => s.workspace.files.length);
  const hasUnsaved = useStore(s =>
    s.workspace.unsavedChanges || currentFiles(s.workspace).some(f => f.documents.some(d => d.dirty))
  );
  const resolve = useStore(s => s.resolvePendingProject);

  if (!pending) return null;

  const incoming = pending.project.files.length;
  const cancel = () => resolve('cancel');

  function handleKeyDown(e) {
    // The window-level Escape handler would otherwise leave fullscreen too.
    e.stopPropagation();
    if (e.key === 'Escape') cancel();
  }

  return (
    <div className="modal-backdrop" onMouseDown={cancel} onKeyDown={handleKeyDown}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby="open-project-title"
        onMouseDown={e => e.stopPropagation()}
      >
        <div id="open-project-title" className="modal-label">Open “{pending.fileName || 'project'}”</div>
        <p className="modal-text">
          It holds {incoming} file{incoming === 1 ? '' : 's'}, and {openCount} file
          {openCount === 1 ? ' is' : 's are'} already open.
        </p>
        {hasUnsaved && (
          <p className="modal-text modal-warning">
            Replacing discards the changes to the open files that have not been saved or exported.
          </p>
        )}
        <div className="modal-actions">
          <button className="toolbar-btn" onClick={cancel}>Cancel</button>
          <button
            className="toolbar-btn"
            onClick={() => resolve('replace')}
            title="Close the open files and open only the project"
          >
            Replace open files
          </button>
          <button
            className="toolbar-btn toolbar-btn-primary"
            onClick={() => resolve('add')}
            title="Keep the open files and add the project's files alongside them"
            autoFocus
          >
            Add to open files
          </button>
        </div>
      </div>
    </div>
  );
}
