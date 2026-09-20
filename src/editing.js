// Editing logic: keydown handling for typing, deletion, clipboard, undo/redo.
//
// Typing INSERTS rather than overwrites, matching Geneious: "position your cursor
// and type or paste new bases — existing residues shift rightward... To overwrite,
// select the target region and type replacement sequence."
//
// Geneious's documented Shift-modifier for edit direction only has a well-defined
// meaning inside a fixed-width alignment, where the insert consumes a gap on the
// far side. Backspace and Delete already cover both directions for deletion, so
// the alignment-preserving operations are bound to Alt instead: Alt+char
// substitutes in place and Alt+Backspace/Delete leaves a gap, both of which keep
// column alignment intact. Shift stays free for selection extension.

import { isValidChar, GAP_CHAR } from './iupac.js';

/**
 * Resolve the character a keypress means.
 * Space is a shortcut for the gap character — it's the fastest key to reach when
 * hand-adjusting an alignment. This is a keyboard mapping only: space is still
 * not a valid sequence character, so parsing and paste keep stripping it.
 * On macOS, Alt+letter emits an accented glyph rather than the letter, so the
 * physical key code is the reliable source when Alt is held.
 */
function charFromEvent(e) {
  if (e.code === 'Space') return GAP_CHAR;
  if (e.altKey) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (e.code === 'Minus') return GAP_CHAR;
    return null;
  }
  return e.key.length === 1 ? e.key.toUpperCase() : null;
}

/**
 * Creates the main keydown handler for sequence editing.
 * @param {function} getContext - returns { state, doc, editingEnabled }
 * @param {object} store - zustand actions
 * @param {function} handleSelectionKeys - from selection.js; returns true if consumed
 * @returns {function} keydown event handler
 */
export function createEditingKeyHandler(getContext, store, handleSelectionKeys) {

  return function onKeyDown(e) {
    if (handleSelectionKeys(e)) {
      e.preventDefault();
      return;
    }

    const { state, doc, editingEnabled } = getContext();
    const mod = e.ctrlKey || e.metaKey;

    /** Gate for anything that mutates the sequence. */
    function canEdit() {
      if (editingEnabled) return true;
      store.showToast('Click "Allow Editing" to edit this sequence', 'warning');
      return false;
    }

    // --- Save (allowed while locked, and independent of any row focus) ---
    if (mod && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      store.save();
      return;
    }

    // --- Undo / Redo (available in row mode, column cursor, and column selection) ---
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      if (canEdit()) store.undo();
      return;
    }
    if (mod && (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (canEdit()) store.redo();
      return;
    }

    // --- Rename (F2) ---
    // A name is not sequence data, so the edit lock doesn't apply. A single
    // selected row is the target if there is one, since selecting a row then
    // pressing F2 is the natural gesture; otherwise the focused row is renamed.
    if (e.key === 'F2') {
      e.preventDefault();
      const selected = [...(state.selectedDocIds ?? [])];
      const targetId = selected.length === 1 ? selected[0] : doc?.id;
      if (targetId) store.startRename(targetId);
      return;
    }

    // Column-selection mode: a range of columns selected by ruler drag across all rows.
    if (state.columnSelection) {
      const { start, end } = state.columnSelection;
      const colStart = Math.min(start, end);
      const colEnd = Math.max(start, end);

      // Copy (allowed while locked)
      if (mod && (e.key === 'c' || e.key === 'C') && !e.shiftKey) {
        e.preventDefault();
        const text = state.documents.map(d => d.raw.slice(colStart, colEnd)).join('\n');
        navigator.clipboard.writeText(text).catch(() => {});
        return;
      }

      // Cut
      if (mod && (e.key === 'x' || e.key === 'X') && !e.shiftKey) {
        e.preventDefault();
        if (!canEdit()) return;
        const text = state.documents.map(d => d.raw.slice(colStart, colEnd)).join('\n');
        navigator.clipboard.writeText(text).catch(() => {});
        store.deleteColumnRange(colStart, colEnd);
        store.setColumnCursor(colStart);
        return;
      }

      // Backspace / Delete
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (!canEdit()) return;
        if (e.altKey) {
          store.substituteColumnRange(colStart, colEnd, GAP_CHAR);
          store.setColumnCursor(colStart);
        } else {
          store.deleteColumnRange(colStart, colEnd);
          const maxLen = state.documents.reduce((m, d) => Math.max(m, d.raw.length), 0);
          store.setColumnCursor(Math.max(0, Math.min(colStart, maxLen - 1)));
        }
        return;
      }

      if (e.key.length !== 1 && !e.altKey) return;
      if (e.ctrlKey || e.metaKey) return;
      const char = charFromEvent(e);
      if (!char) return;
      e.preventDefault();
      if (!canEdit()) return;
      if (!isValidChar(char)) {
        store.showToast(`"${char}" is not a valid IUPAC base`, 'warning');
        return;
      }

      store.replaceColumnRange(colStart, colEnd, char);
      store.setColumnCursor(colStart + 1);
      return;
    }

    // Column-cursor mode: every keystroke applies to this column in every row at
    // once. Insert and delete are safe here precisely because they hit all rows
    // identically — the columns stay in register. The bindings mirror row mode:
    // type inserts, Alt+type substitutes in place, Backspace/Delete remove,
    // Alt+Backspace/Delete leave a gap. Left/Right/Escape go to handleSelectionKeys.
    if (state.columnCursor !== null) {
      const col = state.columnCursor;
      const maxLen = state.documents.reduce((m, d) => Math.max(m, d.raw.length), 0);

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (!canEdit()) return;
        const target = e.key === 'Backspace' ? col - 1 : col;
        if (target < 0 || target >= maxLen) return;

        if (e.altKey) {
          store.substituteColumn(target, GAP_CHAR);
          if (e.key === 'Backspace') store.setColumnCursor(target);
        } else {
          store.deleteColumn(target);
          // One column is gone, so the cursor has to stay inside the new extent.
          store.setColumnCursor(Math.max(0, Math.min(target, maxLen - 2)));
        }
        return;
      }

      if (e.key.length !== 1 && !e.altKey) return;
      if (e.ctrlKey || e.metaKey) return;
      const char = charFromEvent(e);
      if (!char) return;
      e.preventDefault();
      if (!canEdit()) return;
      if (!isValidChar(char)) {
        store.showToast(`"${char}" is not a valid IUPAC base`, 'warning');
        return;
      }

      if (e.altKey) {
        store.substituteColumn(col, char);
        store.setColumnCursor(Math.min(maxLen - 1, col + 1));
      } else {
        // Every row grows by one, so col + 1 is always in range afterwards.
        store.insertColumn(col, char);
        store.setColumnCursor(col + 1);
      }
      return;
    }

    if (!doc) return;
    const { selection } = doc;
    const pos = doc.cursorPos ?? 0;

    // --- Copy (allowed while locked) ---
    if (mod && (e.key === 'c' || e.key === 'C') && !e.shiftKey) {
      if (selection) {
        e.preventDefault();
        navigator.clipboard.writeText(doc.raw.slice(selection.start, selection.end)).catch(() => {});
      }
      return;
    }

    // --- Cut ---
    if (mod && (e.key === 'x' || e.key === 'X') && !e.shiftKey) {
      if (!selection) return;
      e.preventDefault();
      if (!canEdit()) return;
      navigator.clipboard.writeText(doc.raw.slice(selection.start, selection.end)).catch(() => {});
      store.deleteRange(selection.start, selection.end);
      store.setCursorPos(selection.start);
      return;
    }

    // --- Paste ---
    if (mod && (e.key === 'v' || e.key === 'V') && !e.shiftKey) {
      e.preventDefault();
      if (!canEdit()) return;
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        const upper = text.toUpperCase();
        const valid = [...upper].filter(c => isValidChar(c)).join('');
        const stripped = upper.length - valid.length;

        if (valid.length === 0) {
          store.showToast('Clipboard contained no valid IUPAC characters', 'warning');
          return;
        }

        if (selection) {
          store.replaceRange(selection.start, selection.end, valid);
          store.setCursorPos(selection.start + valid.length);
        } else {
          store.insertAt(pos, valid);
          store.setCursorPos(pos + valid.length);
        }

        if (stripped > 0) {
          store.showToast(
            `${stripped} invalid character${stripped > 1 ? 's' : ''} stripped from paste`,
            'warning'
          );
        }
      }).catch(() => {
        store.showToast('Could not read clipboard', 'error');
      });
      return;
    }

    // --- Backspace / Delete ---
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (!canEdit()) return;
      const forward = e.key === 'Delete';

      if (e.altKey) {
        // Column-preserving: leave gaps behind instead of closing them up.
        if (selection) {
          store.replaceRange(selection.start, selection.end, GAP_CHAR.repeat(selection.end - selection.start));
          store.setCursorPos(selection.end);
        } else if (forward && pos < doc.raw.length) {
          store.replaceRange(pos, pos + 1, GAP_CHAR);
          store.setCursorPos(pos + 1);
        } else if (!forward && pos > 0) {
          store.replaceRange(pos - 1, pos, GAP_CHAR);
          store.setCursorPos(pos - 1);
        }
        return;
      }

      if (selection) {
        store.deleteRange(selection.start, selection.end);
        store.setCursorPos(selection.start);
      } else if (forward && pos < doc.raw.length) {
        store.deleteRange(pos, pos + 1);
      } else if (!forward && pos > 0) {
        store.deleteRange(pos - 1, pos);
        store.setCursorPos(pos - 1);
      }
      return;
    }

    // --- Typing a base ---
    if (mod) return;
    const char = charFromEvent(e);
    if (!char || !isValidChar(char)) return;

    e.preventDefault();
    if (!canEdit()) return;

    if (e.altKey) {
      // Substitute in place — length and alignment columns unchanged.
      if (selection) {
        store.replaceRange(selection.start, selection.end, char.repeat(selection.end - selection.start));
        store.setCursorPos(selection.end);
      } else if (pos < doc.raw.length) {
        store.substitute(pos, char);
        store.setCursorPos(pos + 1);
      }
      return;
    }

    if (selection) {
      store.replaceRange(selection.start, selection.end, char);
      store.setCursorPos(selection.start + 1);
    } else {
      store.insertAt(pos, char);
      store.setCursorPos(pos + 1);
    }
  };
}
