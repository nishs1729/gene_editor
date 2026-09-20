// Find & replace: a floating bar over the top-right of the canvas.
// Non-blocking on purpose — the alignment stays visible and editable while a
// search is running, which is the point of highlighting hits in place.

import { useEffect, useRef } from 'react';
import useStore from './store.js';
import { SEARCH_MODES, MAX_MISMATCHES, validateQuery } from './search.js';
import { getCanvasApi } from './canvasBridge.js';

export default function FindBar() {
  const find = useStore(s => s.find);
  const editingEnabled = useStore(s => s.workspace.editingEnabled);
  const patchFind = useStore(s => s.patchFind);
  const closeFind = useStore(s => s.closeFind);
  const runSearch = useStore(s => s.runSearch);
  const stepMatch = useStore(s => s.stepMatch);
  const replaceActiveMatch = useStore(s => s.replaceActiveMatch);
  const replaceAllMatches = useStore(s => s.replaceAllMatches);
  const showToast = useStore(s => s.showToast);
  const inputRef = useRef(null);

  const { open, query, replacement, options, matches, activeIndex } = find;
  const error = validateQuery(query, options.mode);
  const isRegex = options.mode === 'regex';

  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  // Re-run whenever the query, the options or the sequences themselves change.
  const documents = useStore(s => s.workspace.documents);
  useEffect(() => {
    if (open) runSearch();
  }, [open, query, options, documents, runSearch]);

  if (!open) return null;

  /** Bring a hit into view and select it, so editing keys land on it. */
  function focusMatch(match) {
    if (!match) return;
    const store = useStore.getState();
    store.setActiveDoc(match.docId);
    store.setSelection(match.start, match.end);
    const api = getCanvasApi();
    api?.revealRow(match.docId);
    api?.centerOnColumn(match.start, { flash: false });
  }

  function step(delta) {
    focusMatch(stepMatch(delta));
  }

  function guardEdit() {
    if (editingEnabled) return true;
    showToast('Click "Allow Editing" to replace bases', 'warning');
    return false;
  }

  function handleKeyDown(e) {
    e.stopPropagation(); // the canvas would otherwise treat these as base keys
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      closeFind();
    }
  }

  return (
    <div className="find-bar" role="search" onKeyDown={handleKeyDown}>
      <div className="find-row">
        <input
          ref={inputRef}
          className="find-input"
          value={query}
          placeholder="Find motif"
          onChange={e => patchFind({ query: e.target.value.toUpperCase() })}
          aria-label="Search query"
          autoFocus
        />
        <span className="find-count">
          {query === '' ? '' : matches.length === 0 ? 'No matches' : `${activeIndex + 1} of ${matches.length}`}
        </span>
        <button
          className="toolbar-btn toolbar-btn-icon"
          onClick={() => step(-1)}
          disabled={matches.length === 0}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
        >
          ▲
        </button>
        <button
          className="toolbar-btn toolbar-btn-icon"
          onClick={() => step(1)}
          disabled={matches.length === 0}
          title="Next match (Enter)"
          aria-label="Next match"
        >
          ▼
        </button>
        <button
          className="toolbar-btn toolbar-btn-icon"
          onClick={closeFind}
          title="Close (Esc)"
          aria-label="Close find"
        >
          ✕
        </button>
      </div>

      <div className="find-row">
        <input
          className="find-input"
          value={replacement}
          placeholder="Replace with"
          onChange={e => patchFind({ replacement: e.target.value.toUpperCase() })}
          aria-label="Replacement"
        />
        <button
          className="toolbar-btn"
          onClick={() => guardEdit() && replaceActiveMatch()}
          disabled={activeIndex < 0}
        >
          Replace
        </button>
        <button
          className="toolbar-btn"
          onClick={() => guardEdit() && replaceAllMatches()}
          disabled={matches.length === 0}
        >
          All
        </button>
      </div>

      <div className="find-row find-options">
        <select
          className="toolbar-select"
          value={options.mode}
          onChange={e => patchFind({ options: { mode: e.target.value } })}
          aria-label="Search mode"
          title="IUPAC treats degenerate codes as the bases they stand for"
        >
          {SEARCH_MODES.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>

        <label className="find-option" title="Allowed mismatched positions">
          Mismatches
          <input
            type="number"
            min={0}
            max={MAX_MISMATCHES}
            value={options.mismatches}
            disabled={isRegex}
            onChange={e => patchFind({
              options: { mismatches: Math.min(MAX_MISMATCHES, Math.max(0, Number(e.target.value) || 0)) },
            })}
          />
        </label>

        <label className="find-option" title="Also match the query on the opposite strand">
          <input
            type="checkbox"
            checked={options.reverseComplement}
            disabled={isRegex}
            onChange={e => patchFind({ options: { reverseComplement: e.target.checked } })}
          />
          Rev-comp
        </label>

        <label className="find-option" title="Search every sequence, not just the active one">
          <input
            type="checkbox"
            checked={options.allSequences}
            onChange={e => patchFind({ options: { allSequences: e.target.checked } })}
          />
          All rows
        </label>
      </div>

      {error && <div className="find-error">{error}</div>}
    </div>
  );
}
