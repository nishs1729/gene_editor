// FilesPanel: collapsible list of every loaded file, on the left of the canvas.
// Clicking a file switches to it; each keeps its own documents, selection,
// zoom and undo history, restored exactly as it was left.

import useStore from './store.js';

export default function FilesPanel({ collapsed, onToggleCollapsed }) {
  const files = useStore(s => s.workspace.files);
  const activeFileId = useStore(s => s.workspace.activeFileId);
  // The active file's name and document count live at the top level of the
  // workspace, not in its (possibly stale) entry in `files` — see store.js.
  const activeName = useStore(s => s.workspace.fileName);
  const activeDocCount = useStore(s => s.workspace.documents.length);
  const switchFile = useStore(s => s.switchFile);
  const closeFile = useStore(s => s.closeFile);

  if (files.length === 0) return null;

  return (
    <div className={`files-panel ${collapsed ? 'files-panel-collapsed' : ''}`}>
      <div className="files-panel-header">
        {!collapsed && <span className="files-panel-title">Files</span>}
        <button
          className="files-panel-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Show loaded files' : 'Hide loaded files'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
      {!collapsed && (
        <ul className="files-panel-list">
          {files.map(f => {
            const isActive = f.id === activeFileId;
            const name = (isActive ? activeName : f.name) || 'Untitled';
            const count = isActive ? activeDocCount : f.documents.length;
            return (
              <li
                key={f.id}
                className={`files-panel-item ${isActive ? 'files-panel-item-active' : ''}`}
                onClick={() => switchFile(f.id)}
                title={name}
              >
                <span className="files-panel-item-name">{name}</span>
                <span className="files-panel-item-count">{count}</span>
                <button
                  className="files-panel-item-close"
                  onClick={(e) => { e.stopPropagation(); closeFile(f.id); }}
                  title="Close this file"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
