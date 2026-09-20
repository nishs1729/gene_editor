// The status bar: where the cursor is on the left, how the canvas is drawn on
// the right. View and zoom controls live here rather than in the toolbar because
// they describe the view rather than acting on the data.

import useStore, { getActiveDoc } from './store.js';
import ToolbarMenu, { MenuToggle, MenuSection } from './ToolbarMenu.jsx';
import ZoomControls from './ZoomControls.jsx';
import { PALETTE_OPTIONS } from './palettes.js';

export default function SelectionReadout() {
  const doc = useStore(getActiveDoc);
  const editingEnabled = useStore(s => s.workspace.editingEnabled);
  const viewSettings = useStore(s => s.workspace.viewSettings);
  const isStacked = useStore(s => s.workspace.documents.length > 1);
  const setColorPalette = useStore(s => s.setColorPalette);
  const toggleColumnGuides = useStore(s => s.toggleColumnGuides);
  const toggleMinimap = useStore(s => s.toggleMinimap);
  const toggleConservation = useStore(s => s.toggleConservation);
  const toggleComplement = useStore(s => s.toggleComplement);
  const toggleAnnotations = useStore(s => s.toggleAnnotations);

  const selection = doc?.selection;
  const hasSequence = Boolean(doc && doc.length > 0);

  return (
    <div className="selection-readout">
      {hasSequence && (
        selection ? (
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
        )
      )}
      {hasSequence && !editingEnabled && (
        <span className="readout-lock">Read-only — click “Allow Editing” to edit</span>
      )}

      <div className="readout-controls">
        <ZoomControls />

        <ToolbarMenu
          label="View"
          title="Canvas appearance"
          align="right"
          drop="up"
          className="status-btn"
        >
          {() => (
            <>
              <MenuSection>Base colours</MenuSection>
              {PALETTE_OPTIONS.map(p => (
                <MenuToggle
                  key={p.id}
                  checked={viewSettings.colorPalette === p.id}
                  onClick={() => setColorPalette(p.id)}
                >
                  {p.label}
                </MenuToggle>
              ))}

              <MenuSection>Tracks &amp; guides</MenuSection>
              <MenuToggle
                checked={viewSettings.showColumnGuides}
                onClick={toggleColumnGuides}
                title="Faint banding every ten columns, from the ruler down"
              >
                Column guides
              </MenuToggle>
              <MenuToggle
                checked={viewSettings.showMinimap}
                onClick={toggleMinimap}
                disabled={!isStacked}
                title="Overview strip under the ruler"
              >
                Minimap
              </MenuToggle>
              <MenuToggle
                checked={viewSettings.showConservation}
                onClick={toggleConservation}
                disabled={!isStacked}
                title="Per-column conservation bars under the consensus"
              >
                Conservation histogram
              </MenuToggle>
              <MenuToggle
                checked={viewSettings.showComplement}
                onClick={toggleComplement}
                title="Show the complement strand under each sequence"
              >
                Complement strand
              </MenuToggle>
              <MenuToggle
                checked={viewSettings.showAnnotations}
                onClick={toggleAnnotations}
                title="Show the feature lane under each sequence"
              >
                Feature annotations
              </MenuToggle>
            </>
          )}
        </ToolbarMenu>
      </div>
    </div>
  );
}
