// Editing logic: keyboard handlers for typing, delete, undo/redo, clipboard.
// Returns a keydown handler factory.

import { isValidChar } from './iupac.js';

/**
 * Creates the main keydown handler for sequence editing.
 * @param {function} getState - returns { doc }
 * @param {object} store - zustand store with substitute, insertAt, deleteRange, undo, redo, setCursorPos, showToast
 * @param {function} handleSelectionKeys - from selection.js, returns true if key was consumed
 * @returns {function} keydown event handler
 */
export function createEditingKeyHandler(getState, store, handleSelectionKeys) {

  return function onKeyDown(e) {
    // Let selection module handle navigation keys first
    if (handleSelectionKeys(e)) {
      e.preventDefault();
      return;
    }

    const { doc } = getState();
    const { selection, cursorPos } = doc;
    const pos = cursorPos ?? 0;

    // --- Undo / Redo ---
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      store.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      store.redo();
      return;
    }

    // --- Copy ---
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !e.shiftKey) {
      if (selection) {
        const text = doc.raw.slice(selection.start, selection.end);
        navigator.clipboard.writeText(text).catch(() => {});
        e.preventDefault();
      }
      return;
    }

    // --- Cut ---
    if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X') && !e.shiftKey) {
      if (selection) {
        const text = doc.raw.slice(selection.start, selection.end);
        navigator.clipboard.writeText(text).catch(() => {});
        store.deleteRange(selection.start, selection.end);
        store.setCursorPos(selection.start);
        e.preventDefault();
      }
      return;
    }

    // --- Paste ---
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && !e.shiftKey) {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (!text) return;

        const upper = text.toUpperCase();
        const valid = [...upper].filter(c => isValidChar(c));
        const stripped = upper.length - valid.length;

        if (valid.length === 0) {
          store.showToast('Clipboard contained no valid IUPAC characters', 'warning');
          return;
        }

        const validStr = valid.join('');

        // Delete selection first if any
        if (selection) {
          store.deleteRange(selection.start, selection.end);
          store.insertAt(selection.start, validStr);
          store.setCursorPos(selection.start + validStr.length);
        } else {
          store.insertAt(pos, validStr);
          store.setCursorPos(pos + validStr.length);
        }

        if (stripped > 0) {
          store.showToast(`${stripped} invalid character${stripped > 1 ? 's' : ''} stripped from paste`, 'warning');
        }
      }).catch(() => {
        store.showToast('Could not read clipboard', 'error');
      });
      return;
    }

    // --- Backspace ---
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (selection) {
        store.deleteRange(selection.start, selection.end);
        store.setCursorPos(selection.start);
      } else if (pos > 0) {
        store.deleteRange(pos - 1, pos);
        store.setCursorPos(pos - 1);
      }
      return;
    }

    // --- Delete key ---
    if (e.key === 'Delete') {
      e.preventDefault();
      if (selection) {
        store.deleteRange(selection.start, selection.end);
        store.setCursorPos(selection.start);
      } else if (pos < doc.raw.length) {
        store.deleteRange(pos, pos + 1);
      }
      return;
    }

    // --- Typing a valid IUPAC character ---
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isValidChar(e.key)) {
        e.preventDefault();
        if (selection) {
          // Replace selection: delete range then insert
          store.deleteRange(selection.start, selection.end);
          store.insertAt(selection.start, e.key.toUpperCase());
          store.setCursorPos(selection.start + 1);
        } else if (pos < doc.raw.length) {
          // Substitute at cursor
          store.substitute(pos, e.key.toUpperCase());
          store.setCursorPos(pos + 1);
        } else {
          // At end of sequence: insert
          store.insertAt(pos, e.key.toUpperCase());
          store.setCursorPos(pos + 1);
        }
      }
      // Invalid char → silently rejected (no action)
      return;
    }
  };
}
