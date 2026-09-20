// Add or edit a feature annotation on a sequence.

import { useEffect, useState } from 'react';
import useStore from './store.js';
import { FEATURE_TYPES, DEFAULT_FEATURE_TYPE, colorForType } from './annotations.js';

function refocusCanvas() {
  document.querySelector('.sequence-canvas')?.focus();
}

const EMPTY = { label: '', type: DEFAULT_FEATURE_TYPE, color: '', strand: 1, notes: '' };

export default function AnnotationDialog() {
  const draft = useStore(s => s.annotationDraft);
  const documents = useStore(s => s.workspace.documents);
  const closeAnnotation = useStore(s => s.closeAnnotation);
  const saveFeature = useStore(s => s.saveFeature);
  const deleteFeature = useStore(s => s.deleteFeature);
  const [form, setForm] = useState(EMPTY);

  const doc = draft ? documents.find(d => d.id === draft.docId) : null;
  const existing = doc && draft?.featureId
    ? doc.features.find(f => f.id === draft.featureId)
    : null;

  useEffect(() => {
    if (!draft) return;
    setForm(existing
      ? { ...existing }
      : { ...EMPTY, color: colorForType(DEFAULT_FEATURE_TYPE) });
  }, [draft, existing]);

  if (!draft || !doc) return null;

  const start = existing?.start ?? draft.start ?? 0;
  const end = existing?.end ?? draft.end ?? 0;

  function close() {
    closeAnnotation();
    refocusCanvas();
  }

  function commit() {
    saveFeature(doc.id, { ...form, id: existing?.id, start, end });
    refocusCanvas();
  }

  function handleKeyDown(e) {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') commit();
    else if (e.key === 'Escape') close();
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Edit annotation' : 'Add annotation'}
      >
        <label className="modal-label">
          {existing ? 'Edit annotation' : 'Add annotation'} · {doc.name || 'Unnamed'} ·{' '}
          {start + 1}–{end} ({end - start} bp)
        </label>

        <input
          className="modal-input"
          value={form.label}
          placeholder="Label"
          onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          aria-label="Label"
          autoFocus
        />

        <div className="form-row">
          <select
            className="toolbar-select"
            value={form.type}
            onChange={e => setForm(f => ({
              ...f,
              type: e.target.value,
              // Keep the colour in step with the type unless it was chosen by hand.
              color: f.color === colorForType(f.type) ? colorForType(e.target.value) : f.color,
            }))}
            aria-label="Feature type"
          >
            {FEATURE_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>

          <select
            className="toolbar-select"
            value={form.strand}
            onChange={e => setForm(f => ({ ...f, strand: Number(e.target.value) }))}
            aria-label="Strand"
          >
            <option value={1}>Forward (+)</option>
            <option value={-1}>Reverse (−)</option>
          </select>

          <input
            type="color"
            className="color-input"
            value={form.color || colorForType(form.type)}
            onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
            aria-label="Colour"
          />
        </div>

        <textarea
          className="modal-input"
          rows={2}
          value={form.notes}
          placeholder="Notes (optional)"
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          aria-label="Notes"
        />

        <div className="modal-actions">
          {existing && (
            <button
              className="toolbar-btn btn-danger"
              onClick={() => { deleteFeature(doc.id, existing.id); refocusCanvas(); }}
            >
              Delete
            </button>
          )}
          <button className="toolbar-btn" onClick={close}>Cancel</button>
          <button className="toolbar-btn toolbar-btn-primary" onClick={commit}>
            {existing ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
