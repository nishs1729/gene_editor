// "How to Use": a tabbed guide to the editor and its keybindings.

import { useEffect, useState } from 'react';
import useStore from './store.js';

const TABS = [
  { id: 'start', label: 'Getting Started' },
  { id: 'editing', label: 'Editing & Alignment' },
  { id: 'reference', label: 'Reference & Consensus' },
  { id: 'keys', label: 'Keybindings' },
];

const SHORTCUTS = [
  {
    group: 'Navigation',
    keys: [
      [['←'], ['→'], 'Move the cursor one base'],
      [['↑'], ['↓'], 'Previous / next sequence (stacked) or line (single sequence)'],
      [['Home'], ['End'], 'Jump to the start or end of the sequence'],
      [['Ctrl', 'G'], null, 'Jump to a base position'],
    ],
  },
  {
    group: 'Selection',
    keys: [
      [['Shift', '←/→'], null, 'Extend the selection'],
      [['Ctrl', 'A'], null, 'Select the whole sequence'],
      [['Ctrl', 'click'], null, 'Add or remove a sequence from the row selection'],
      [['Shift', 'click'], null, 'Select a range of sequences in the gutter'],
      [['drag on ruler'], null, 'Select a column range across every sequence'],
      [['Esc'], null, 'Clear the column cursor or column selection'],
    ],
  },
  {
    group: 'Editing',
    keys: [
      [['A'], ['C G T'], 'Type a base; IUPAC codes R Y S W K M B D H V N and U are accepted'],
      [['Space'], ['-'], 'Insert an alignment gap'],
      [['Alt', 'base'], null, 'Substitute in place, keeping the columns aligned'],
      [['Backspace'], ['Delete'], 'Delete backwards / forwards'],
      [['Alt', 'Backspace'], null, 'Replace with a gap instead of closing the column up'],
      [['Ctrl', 'C/X/V'], null, 'Copy, cut, paste'],
      [['F2'], null, 'Rename the focused or selected sequence'],
    ],
  },
  {
    group: 'History & File',
    keys: [
      [['Ctrl', 'Z'], null, 'Undo'],
      [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y'], 'Redo'],
      [['Ctrl', 'S'], null, 'Save the workspace'],
    ],
  },
  {
    group: 'View & Dialogs',
    keys: [
      [['Ctrl', '='], ['Ctrl', '-'], 'Zoom in / out'],
      [['Ctrl', '0'], null, 'Reset zoom'],
      [['Ctrl', 'wheel'], null, 'Zoom about the pointer'],
      [['Ctrl', 'F'], null, 'Find and replace'],
      [['?'], ['F1'], 'Open this guide'],
      [['Esc'], null, 'Close a dialog, or leave fullscreen'],
    ],
  },
];

function Keys({ combo }) {
  return (
    <span className="kbd-combo">
      {combo.map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

export default function HelpModal() {
  const open = useStore(s => s.dialog === 'help');
  const closeDialog = useStore(s => s.closeDialog);
  const [tab, setTab] = useState('start');

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDialog();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, closeDialog]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={closeDialog}>
      <div
        className="modal modal-lg"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Gene Editor User Guide"
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Gene Editor User Guide</h2>
            <p className="modal-subtitle">
              Loading, editing and aligning sequences — and every shortcut that does it faster.
            </p>
          </div>
          <button className="modal-close" onClick={closeDialog} aria-label="Close guide">✕</button>
        </div>

        <div className="tab-bar" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body" role="tabpanel">
          {tab === 'start' && (
            <>
              <h3>The workspace</h3>
              <p>
                One sequence opens as a <strong>wrapped view</strong>, each line under its own ruler.
                Several sequences open as a <strong>stacked alignment</strong>: one unwrapped row each,
                names in the left gutter, under a shared ruler. Drag the divider at the right of the
                gutter to give the names more or less room.
              </p>
              <h3>Loading sequences</h3>
              <p>
                Use <strong>Load FASTA</strong>, or drop a <code>.fasta</code>, <code>.fa</code>,
                <code>.fna</code>, <code>.aln</code> or <code>.txt</code> file anywhere on the window.
                Lower-case bases are uppercased and <code>.</code> gaps become <code>-</code> on the way in.
              </p>
              <h3>Exporting</h3>
              <p>
                <strong>Export ▾</strong> writes FASTA for the selected sequences — or for all of them
                when nothing is selected — and also produces publication SVG and PNG figures and a
                variant report against the reference.
              </p>
              <h3>Theme, palette and fullscreen</h3>
              <p>
                The sun/moon button switches light and dark chrome. Base colours are separate: pick a
                palette under <strong>View ▾</strong>, including a colourblind-safe and a grayscale set.
                The arrows button goes fullscreen; <kbd>Esc</kbd> leaves it.
              </p>
            </>
          )}

          {tab === 'editing' && (
            <>
              <h3>Unlocking edits</h3>
              <p>
                Sequences open locked. Click <strong>Allow Editing</strong> before typing — it is what
                stops a stray keystroke from changing data you only meant to read.
              </p>
              <h3>Typing bases</h3>
              <p>
                Typing <strong>inserts</strong> and pushes the rest of the row right; hold
                <kbd>Alt</kbd> to <strong>substitute in place</strong> and keep the alignment columns in
                register. <kbd>Space</kbd> and <kbd>-</kbd> both insert a gap. Degenerate IUPAC codes
                (R Y S W K M B D H V N) and <kbd>U</kbd> are accepted everywhere a base is.
              </p>
              <h3>Moving blocks</h3>
              <p>
                Select a span, then drag it left or right: the bases are lifted and re-inserted where
                you drop them, as one undoable step. Grab either edge of a selection to resize it.
              </p>
              <h3>Editing a whole column</h3>
              <p>
                Click the ruler to put a <strong>column cursor</strong> on that position — typing then
                edits every sequence at once, so the columns stay aligned. Drag along the ruler to
                select a <strong>column range</strong>: typing replaces it in every row,
                <kbd>Backspace</kbd> removes it from every row, and <kbd>Ctrl</kbd>+<kbd>C</kbd> copies
                the block.
              </p>
              <h3>Cleaning up an alignment</h3>
              <p>
                <strong>Tools ▾</strong> strips all-gap columns, trims ragged 5′/3′ ends below a coverage
                threshold, and pads short sequences to a common length. <strong>Transform ▾</strong>
                reverses, complements and transcribes, either the active sequence, every selected one, or
                just the selected span.
              </p>
            </>
          )}

          {tab === 'reference' && (
            <>
              <h3>Selecting sequences</h3>
              <p>
                Click a name in the gutter to select that sequence on its own;
                <kbd>Ctrl</kbd>+click adds another to the selection and <kbd>Shift</kbd>+click takes
                the range in between. Selecting more than one switches the info panel from that
                sequence's composition to a summary of the group.
              </p>
              <h3>Setting a reference</h3>
              <p>
                Select one sequence, then click <strong>Add as Reference</strong>. The reference moves
                to the top of the alignment and stays pinned there.
              </p>
              <h3>Highlighting differences</h3>
              <p>
                The highlighting dropdown greys out every base that agrees with the consensus — or with
                the reference — so only the disagreements keep their colour.
              </p>
              <h3>Consensus and conservation</h3>
              <p>
                The consensus row sits under the ruler and calls the majority base per column; the
                threshold dropdown sets how much agreement it takes before a column is called rather than
                left as <code>N</code>. Turn on the <strong>conservation histogram</strong> under
                <strong> View ▾</strong> for a per-column bar: green above 90%, amber from 50%, red below.
              </p>
              <h3>Managing tracks</h3>
              <p>
                Double-click a name or press <kbd>F2</kbd> to rename. Drag names to reorder, or use
                <strong> Organise ▾</strong> to sort by name, length or similarity to the reference and
                to group sequences under a collapsible header. The eye and pin icons on a gutter row
                hide a track or stick it to the top.
              </p>
              <h3>Comparing sequences</h3>
              <p>
                <strong>Distances</strong> opens the pairwise identity matrix; <strong>Tree</strong>
                builds a dendrogram from those same distances by UPGMA or Neighbour-Joining, and both
                export for use elsewhere.
              </p>
            </>
          )}

          {tab === 'keys' && (
            <div className="shortcut-groups">
              {SHORTCUTS.map(section => (
                <section key={section.group}>
                  <h3>{section.group}</h3>
                  <table className="shortcut-table">
                    <tbody>
                      {section.keys.map(([primary, alternate, description], i) => (
                        <tr key={i}>
                          <td className="shortcut-keys">
                            <Keys combo={primary} />
                            {alternate && <span className="shortcut-or">or</span>}
                            {alternate && <Keys combo={alternate} />}
                          </td>
                          <td>{description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
