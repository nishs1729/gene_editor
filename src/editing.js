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
 * On macOS, Alt+letter emits an accented glyph rather than the letter, so the
 * physical key code is the reliable source when Alt is held.
 */
function charFromEvent(e) {
  if (e.altKey) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (e.code === 'Minus') return GAP_CHAR;
    return null;
  }
  return e.key.length === 1 ? e.key.toUpperCase() : null;
}

/**
 * Creates the main keydown handler for sequence editing.
 * @param {function} getContext - returns { doc, editingEnabled }
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

    const { doc, editingEnabled } = getContext();
    if (!doc) return;

    const { selection } = doc;
    const pos = doc.cursorPos ?? 0;
    const mod = e.ctrlKey || e.metaKey;

    /** Gate for anything that mutates the sequence. */
    function canEdit() {
      if (editingEnabled) return true;
      store.showToast('Click "Allow Editing" to edit this sequence', 'warning');
      return false;
    }

    // --- Save (allowed while locked) ---
    if (mod && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      store.save();
      return;
    }

    // --- Copy (allowed while locked) ---
    if (mod && (e.key === 'c' || e.key === 'C') && !e.shiftKey) {
      if (selection) {
        e.preventDefault();
        navigator.clipboard.writeText(doc.raw.slice(selection.start, selection.end)).catch(() => {});
      }
      return;
    }

    // --- Undo / Redo ---
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      if (canEdit()) store.undo();
      return;
    }
    if (mod && ((e.key === 'z' || e.key === 'Z') && e.shiftKey || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (canEdit()) store.redo();
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
