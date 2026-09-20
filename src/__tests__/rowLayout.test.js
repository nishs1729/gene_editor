import { describe, it, expect } from 'vitest';
import { buildRowLayout, visibleDocuments } from '../rowLayout.js';

const doc = id => ({ id, name: id, raw: 'ACGT' });

function workspace(overrides = {}) {
  return {
    documents: [doc('a'), doc('b'), doc('c'), doc('d')],
    hiddenDocIds: new Set(),
    pinnedDocIds: new Set(),
    groups: [],
    ...overrides,
  };
}

const keys = rows => rows.map(r => r.key);

describe('buildRowLayout', () => {
  it('is the document list in order when nothing is hidden, pinned or grouped', () => {
    const { frozen, scrolling } = buildRowLayout(workspace());
    expect(frozen).toEqual([]);
    expect(keys(scrolling)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('tolerates a workspace without the newer fields at all', () => {
    const { scrolling } = buildRowLayout({ documents: [doc('a'), doc('b')] });
    expect(keys(scrolling)).toEqual(['a', 'b']);
  });

  it('drops hidden tracks from the layout entirely', () => {
    const { scrolling } = buildRowLayout(workspace({ hiddenDocIds: new Set(['b']) }));
    expect(keys(scrolling)).toEqual(['a', 'c', 'd']);
  });

  it('lifts pinned tracks into the frozen band, in document order', () => {
    const { frozen, scrolling } = buildRowLayout(workspace({ pinnedDocIds: new Set(['c', 'a']) }));
    expect(keys(frozen)).toEqual(['a', 'c']);
    expect(keys(scrolling)).toEqual(['b', 'd']);
  });

  it('hides a track even when it is pinned', () => {
    const { frozen } = buildRowLayout(workspace({
      pinnedDocIds: new Set(['a']),
      hiddenDocIds: new Set(['a']),
    }));
    expect(frozen).toEqual([]);
  });

  it('puts a group header where its first member falls, and indents the members', () => {
    const { scrolling } = buildRowLayout(workspace({
      groups: [{ id: 'g1', name: 'Isolates', docIds: ['b', 'c'], collapsed: false }],
    }));
    expect(keys(scrolling)).toEqual(['a', 'group:g1', 'b', 'c', 'd']);
    expect(scrolling[2].depth).toBe(1);
    expect(scrolling[1].memberCount).toBe(2);
  });

  it('collects members that are scattered through the document list', () => {
    const { scrolling } = buildRowLayout(workspace({
      groups: [{ id: 'g1', name: 'Controls', docIds: ['b', 'd'], collapsed: false }],
    }));
    expect(keys(scrolling)).toEqual(['a', 'group:g1', 'b', 'd', 'c']);
  });

  it('replaces the members with the header alone when collapsed', () => {
    const { scrolling } = buildRowLayout(workspace({
      groups: [{ id: 'g1', name: 'Isolates', docIds: ['b', 'c'], collapsed: true }],
    }));
    expect(keys(scrolling)).toEqual(['a', 'group:g1', 'd']);
    expect(scrolling[1].memberCount).toBe(2);
  });

  it('counts only the visible members of a group', () => {
    const { scrolling } = buildRowLayout(workspace({
      hiddenDocIds: new Set(['c']),
      groups: [{ id: 'g1', name: 'Isolates', docIds: ['b', 'c'], collapsed: true }],
    }));
    expect(scrolling[1].memberCount).toBe(1);
  });

  it('lets pinning win over grouping, so a pinned member leaves its group', () => {
    const { frozen, scrolling } = buildRowLayout(workspace({
      pinnedDocIds: new Set(['b']),
      groups: [{ id: 'g1', name: 'Isolates', docIds: ['b', 'c'], collapsed: false }],
    }));
    expect(keys(frozen)).toEqual(['b']);
    expect(keys(scrolling)).toEqual(['a', 'group:g1', 'c', 'd']);
  });
});

describe('visibleDocuments', () => {
  it('is every drawn sequence, frozen band first', () => {
    const docs = visibleDocuments(workspace({
      pinnedDocIds: new Set(['d']),
      hiddenDocIds: new Set(['a']),
    }));
    expect(docs.map(d => d.id)).toEqual(['d', 'b', 'c']);
  });

  it('leaves group headers out — they are not sequences', () => {
    const docs = visibleDocuments(workspace({
      groups: [{ id: 'g1', name: 'Isolates', docIds: ['b'], collapsed: false }],
    }));
    expect(docs.map(d => d.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
