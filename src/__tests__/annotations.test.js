import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createFeature, upsertFeature, removeFeature, featureAt, describeFeature,
  colorForType, FEATURE_TYPES, DEFAULT_FEATURE_TYPE,
} from '../annotations.js';

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
  };
}
vi.stubGlobal('localStorage', makeLocalStorage());

const { default: useStore } = await import('../store.js');

describe('createFeature', () => {
  it('fills in an id, a colour and a label from the type', () => {
    const feature = createFeature({ start: 0, end: 10, type: 'Promoter' });
    expect(feature.id).toBeTruthy();
    expect(feature.label).toBe('Promoter');
    expect(feature.color).toBe(colorForType('Promoter'));
    expect(feature.strand).toBe(1);
  });

  it('keeps an explicit label, colour and strand', () => {
    const feature = createFeature({
      start: 3, end: 9, label: '  lacZ  ', color: '#123456', strand: -1, notes: 'from the paper',
    });
    expect(feature).toMatchObject({
      label: 'lacZ', color: '#123456', strand: -1, notes: 'from the paper', start: 3, end: 9,
    });
  });

  it('falls back to the default for an unknown type', () => {
    expect(createFeature({ start: 0, end: 4, type: 'Exon' }).type).toBe(DEFAULT_FEATURE_TYPE);
  });

  it('rejects a span that covers no bases', () => {
    expect(createFeature({ start: 5, end: 5 })).toBeNull();
    expect(createFeature({ start: 9, end: 2 })).toBeNull();
    expect(createFeature({})).toBeNull();
  });

  it('gives every type a colour', () => {
    for (const type of FEATURE_TYPES) {
      expect(colorForType(type.id)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('feature lists', () => {
  const a = createFeature({ id: 'a', start: 10, end: 20, label: 'A' });
  const b = createFeature({ id: 'b', start: 0, end: 5, label: 'B' });

  it('keeps features sorted by position', () => {
    expect(upsertFeature([a], b).map(f => f.id)).toEqual(['b', 'a']);
  });

  it('replaces a feature with the same id rather than duplicating it', () => {
    const edited = { ...a, label: 'A2' };
    const list = upsertFeature([b, a], edited);
    expect(list).toHaveLength(2);
    expect(list.find(f => f.id === 'a').label).toBe('A2');
  });

  it('removes by id', () => {
    expect(removeFeature([a, b], 'a').map(f => f.id)).toEqual(['b']);
  });

  it('finds the feature covering a column, end-exclusive', () => {
    expect(featureAt([a, b], 10).id).toBe('a');
    expect(featureAt([a, b], 19).id).toBe('a');
    expect(featureAt([a, b], 20)).toBeNull();
    expect(featureAt([], 3)).toBeNull();
  });

  it('describes a feature for the tooltip in 1-based coordinates', () => {
    expect(describeFeature(a)).toBe('A · CDS · 11–20 (10 bp, +)');
  });
});

describe('store: annotations', () => {
  const get = () => useStore.getState();
  const docs = () => get().workspace.documents;

  beforeEach(() => {
    get().loadWorkspace([
      { name: 'alpha', sequence: 'ACGTACGTAC' },
      { name: 'beta', sequence: 'ACGTACGTAC' },
    ]);
  });

  it('adds a feature to the named document only', () => {
    get().saveFeature(docs()[0].id, { start: 2, end: 6, label: 'primer', type: 'Primer' });
    expect(docs()[0].features).toHaveLength(1);
    expect(docs()[0].features[0]).toMatchObject({ label: 'primer', start: 2, end: 6 });
    expect(docs()[1].features).toHaveLength(0);
  });

  it('refuses a span that covers no bases, and says so', () => {
    get().saveFeature(docs()[0].id, { start: 4, end: 4 });
    expect(docs()[0].features).toHaveLength(0);
    expect(get().toast.type).toBe('warning');
  });

  it('edits in place when the id is already there', () => {
    get().saveFeature(docs()[0].id, { start: 2, end: 6, label: 'first' });
    const id = docs()[0].features[0].id;
    get().saveFeature(docs()[0].id, { id, start: 2, end: 6, label: 'second' });
    expect(docs()[0].features).toHaveLength(1);
    expect(docs()[0].features[0].label).toBe('second');
  });

  it('undoes and redoes an annotation as one step', () => {
    const id = docs()[0].id;
    get().saveFeature(id, { start: 2, end: 6, label: 'primer' });
    expect(docs()[0].features).toHaveLength(1);

    get().undo();
    expect(docs()[0].features).toHaveLength(0);

    get().redo();
    expect(docs()[0].features).toHaveLength(1);
    expect(docs()[0].features[0].label).toBe('primer');
  });

  it('undoes a deletion back to the feature that was there', () => {
    const id = docs()[0].id;
    get().saveFeature(id, { start: 2, end: 6, label: 'primer' });
    const featureId = docs()[0].features[0].id;

    get().deleteFeature(id, featureId);
    expect(docs()[0].features).toHaveLength(0);

    get().undo();
    expect(docs()[0].features.map(f => f.id)).toEqual([featureId]);
  });

  it('opens and closes the annotation editor', () => {
    get().openAnnotation({ docId: docs()[0].id, start: 1, end: 4 });
    expect(get().annotationDraft).toMatchObject({ start: 1, end: 4 });
    get().closeAnnotation();
    expect(get().annotationDraft).toBeNull();
  });
});
