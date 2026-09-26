import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createFeature, upsertFeature, removeFeature, featureAt, describeFeature,
  colorForType, FEATURE_TYPES, DEFAULT_FEATURE_TYPE,
  featuresAfterSplice, featuresAfterReverseComplement, featuresAfterMove, packFeatures,
} from '../annotations.js';
import {
  createDocument, insertAt, deleteRange, substitute, reverseComplementDoc, undo, redo,
} from '../sequenceModel.js';

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

describe('featuresAfterSplice', () => {
  const f = (start, end, extra = {}) => createFeature({ label: 'f', start, end, ...extra });

  it('leaves a feature in front of the edit alone', () => {
    const features = [f(2, 6)];
    expect(featuresAfterSplice(features, 10, 0, 5)).toBe(features);
  });

  it('shifts a feature after an insertion', () => {
    const [moved] = featuresAfterSplice([f(10, 20)], 0, 0, 5);
    expect([moved.start, moved.end]).toEqual([15, 25]);
  });

  it('grows a feature the insertion lands inside', () => {
    const [moved] = featuresAfterSplice([f(10, 20)], 15, 0, 5);
    expect([moved.start, moved.end]).toEqual([10, 25]);
  });

  it('keeps bases inserted at either edge outside the feature', () => {
    const [atStart] = featuresAfterSplice([f(10, 20)], 10, 0, 5);
    expect([atStart.start, atStart.end]).toEqual([15, 25]);
    const [atEnd] = featuresAfterSplice([f(10, 20)], 20, 0, 5);
    expect([atEnd.start, atEnd.end]).toEqual([10, 20]);
  });

  it('shifts a feature after a deletion and clips one the deletion reaches into', () => {
    const [clipped, shifted] = featuresAfterSplice([f(18, 30), f(40, 50)], 20, 5, 0);
    expect([clipped.start, clipped.end]).toEqual([18, 25]);
    expect([shifted.start, shifted.end]).toEqual([35, 45]);
  });

  it('drops a feature the deletion swallows whole', () => {
    expect(featuresAfterSplice([f(21, 24)], 20, 5, 0)).toEqual([]);
  });

  it('does not move anything for a same-length replace', () => {
    const features = [f(10, 20)];
    expect(featuresAfterSplice(features, 12, 4, 4)).toBe(features);
  });
});

describe('featuresAfterReverseComplement', () => {
  it('mirrors the coordinates and flips the strand', () => {
    const features = [createFeature({ label: 'cds', start: 10, end: 20, strand: 1 })];
    const [flipped] = featuresAfterReverseComplement(features, 100);
    expect([flipped.start, flipped.end]).toEqual([80, 90]);
    expect(flipped.strand).toBe(-1);
  });
});

describe('featuresAfterMove', () => {
  it('carries a feature inside the moved span along with it', () => {
    const features = [createFeature({ label: 'p', start: 10, end: 15 })];
    const [moved] = featuresAfterMove(features, 10, 15, 50);
    expect([moved.start, moved.end]).toEqual([45, 50]);
  });

  it('closes a downstream feature up behind the span that left', () => {
    const features = [createFeature({ label: 'p', start: 30, end: 40 })];
    const [moved] = featuresAfterMove(features, 0, 10, 60);
    expect([moved.start, moved.end]).toEqual([20, 30]);
  });
});

describe('packFeatures', () => {
  it('puts disjoint features in one lane', () => {
    const lanes = packFeatures([
      createFeature({ label: 'a', start: 0, end: 10 }),
      createFeature({ label: 'b', start: 10, end: 20 }),
    ]);
    expect(lanes).toHaveLength(1);
  });

  it('stacks an enclosed feature under the one containing it', () => {
    const gene = createFeature({ label: 'gene', start: 0, end: 100 });
    const exon = createFeature({ label: 'exon', start: 10, end: 20 });
    const lanes = packFeatures([gene, exon]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0][0].label).toBe('gene');
    expect(lanes[1][0].label).toBe('exon');
  });

  it('returns the same lanes for the same array', () => {
    const features = [createFeature({ label: 'a', start: 0, end: 10 })];
    expect(packFeatures(features)).toBe(packFeatures(features));
  });
});

describe('features through edits', () => {
  function docWith(raw, ...spans) {
    const doc = createDocument('seq', raw);
    return { ...doc, features: spans.map(([start, end]) => createFeature({ label: 'f', start, end })) };
  }

  it('moves with an insertion and comes back on undo', () => {
    const doc = docWith('ACGTACGTAC', [4, 8]);
    const edited = insertAt(doc, 0, 'GGG');
    expect([edited.features[0].start, edited.features[0].end]).toEqual([7, 11]);

    const undone = undo(edited);
    expect([undone.features[0].start, undone.features[0].end]).toEqual([4, 8]);

    const redone = redo(undone);
    expect([redone.features[0].start, redone.features[0].end]).toEqual([7, 11]);
  });

  it('restores a feature a deletion swallowed', () => {
    const doc = docWith('ACGTACGTAC', [4, 6]);
    const edited = deleteRange(doc, 3, 8);
    expect(edited.features).toEqual([]);
    expect(undo(edited).features).toHaveLength(1);
  });

  it('flips with a reverse complement', () => {
    const doc = docWith('ACGTACGTAC', [0, 4]);
    const flipped = reverseComplementDoc(doc);
    expect([flipped.features[0].start, flipped.features[0].end]).toEqual([6, 10]);
    expect(flipped.features[0].strand).toBe(-1);
    expect(undo(flipped).features[0].strand).toBe(1);
  });

  it('leaves features alone when a substitution does not move a base', () => {
    const doc = docWith('ACGTACGTAC', [4, 8]);
    const edited = substitute(doc, 5, 'T');
    expect(edited.features).toBe(doc.features);
  });
});
