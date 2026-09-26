import { describe, it, expect } from 'vitest';
import {
  serializeProject, deserializeProject, encodeProject, decodeProject, isProjectFile,
  PROJECT_FORMAT, PROJECT_VERSION, MAX_UNDO_STEPS, MAX_UNDO_CHARS,
} from '../project.js';
import { createDocument, substitute, setRaw, undo } from '../sequenceModel.js';

/** A file entry shaped like the store's, with its workspace undo stack filled in. */
function fileWith(documents, overrides = {}) {
  return {
    id: 'file-1',
    name: 'sample.fasta',
    documents,
    activeDocId: documents[0]?.id ?? null,
    editingEnabled: true,
    hiddenDocIds: new Set(),
    pinnedDocIds: new Set(),
    selectedDocIds: new Set(),
    lastSelectionClickId: null,
    groups: [],
    columnCursor: null,
    columnSelection: null,
    workspaceHistory: [],
    workspaceFuture: [],
    viewSettings: { zoom: 2, referenceDocId: null, fullscreen: true, showConsensus: true },
    ...overrides,
  };
}

/** Apply `count` single-base edits to a document, recording each as the store does. */
function editRepeatedly(doc, count) {
  let d = doc;
  const commands = [];
  for (let i = 0; i < count; i++) {
    d = substitute(d, i % d.raw.length, d.raw[i % d.raw.length] === 'A' ? 'C' : 'A');
    commands.push({ type: 'docEdit', docId: d.id });
  }
  return { doc: d, commands };
}

const roundTrip = project => deserializeProject(JSON.parse(JSON.stringify(project)));

describe('project round trip', () => {
  it('brings back every file, sequence, name and annotation', () => {
    const a = { ...createDocument('alpha', 'ACGT'), features: [{ id: 'f1', label: 'exon', start: 0, end: 2 }] };
    const b = createDocument('beta', 'GGCC');
    const project = serializeProject([fileWith([a, b]), fileWith([createDocument('solo', 'TTTT')], { name: 'two.fa' })], 1);
    const { files, activeIndex } = roundTrip(project);

    expect(activeIndex).toBe(1);
    expect(files.map(f => f.name)).toEqual(['sample.fasta', 'two.fa']);
    expect(files[0].documents.map(d => [d.name, d.raw])).toEqual([['alpha', 'ACGT'], ['beta', 'GGCC']]);
    expect(files[0].documents[0].features[0].label).toBe('exon');
  });

  it('keeps view settings, but not fullscreen', () => {
    const { files } = roundTrip(serializeProject([fileWith([createDocument('a', 'ACGT')])], 0));
    expect(files[0].viewSettings.zoom).toBe(2);
    expect(files[0].viewSettings.fullscreen).toBe(false);
  });

  it('gives sequences new ids, and moves every reference to them along', () => {
    const a = createDocument('a', 'ACGT');
    const b = createDocument('b', 'ACGA');
    const file = fileWith([a, b], {
      activeDocId: b.id,
      hiddenDocIds: new Set([a.id]),
      selectedDocIds: new Set([b.id]),
      groups: [{ id: 'g1', name: 'pair', docIds: [a.id, b.id], collapsed: false }],
      viewSettings: { referenceDocId: a.id },
    });
    const { files } = roundTrip(serializeProject([file], 0));
    const [na, nb] = files[0].documents;

    expect(na.id).not.toBe(a.id);
    expect(files[0].activeDocId).toBe(nb.id);
    expect([...files[0].hiddenDocIds]).toEqual([na.id]);
    expect([...files[0].selectedDocIds]).toEqual([nb.id]);
    expect(files[0].groups[0].docIds).toEqual([na.id, nb.id]);
    expect(files[0].viewSettings.referenceDocId).toBe(na.id);
  });

  it('carries undo history across, pointed at the new ids', () => {
    const { doc, commands } = editRepeatedly(createDocument('a', 'ACGTACGT'), 3);
    const { files } = roundTrip(serializeProject([fileWith([doc], { workspaceHistory: commands })], 0));
    const opened = files[0].documents[0];

    expect(files[0].workspaceHistory).toHaveLength(3);
    expect(files[0].workspaceHistory.every(c => c.docId === opened.id)).toBe(true);
    expect(undo(undo(undo(opened))).raw).toBe('ACGTACGT');
  });

  it('restores a deleted sequence held in the undo stack, as a Set-bearing command', () => {
    const a = createDocument('a', 'ACGT');
    const gone = createDocument('gone', 'TTTT');
    const deletion = {
      type: 'deleteDocuments',
      deletedDocs: [gone],
      deletedIndices: [1],
      previousActiveDocId: gone.id,
      previousSelectedDocIds: new Set([gone.id]),
      previousReferenceDocId: null,
    };
    const { files } = roundTrip(serializeProject([fileWith([a], { workspaceHistory: [deletion] })], 0));
    const cmd = files[0].workspaceHistory[0];

    expect(cmd.deletedDocs[0].raw).toBe('TTTT');
    expect(cmd.previousSelectedDocIds).toBeInstanceOf(Set);
    expect([...cmd.previousSelectedDocIds]).toEqual([cmd.deletedDocs[0].id]);
    expect(cmd.previousActiveDocId).toBe(cmd.deletedDocs[0].id);
  });

  it('can leave the history out altogether', () => {
    const { doc, commands } = editRepeatedly(createDocument('a', 'ACGT'), 3);
    const project = serializeProject([fileWith([doc], { workspaceHistory: commands })], 0, { includeHistory: false });
    expect(project.files[0].workspaceHistory).toEqual([]);
    expect(project.files[0].documents[0].history).toEqual([]);
    expect(project.files[0].documents[0].raw).toBe(doc.raw);
  });
});

describe('undo history limits', () => {
  it(`keeps only the latest ${MAX_UNDO_STEPS} steps, and the matching sequence entries`, () => {
    const { doc, commands } = editRepeatedly(createDocument('a', 'ACGTACGT'), MAX_UNDO_STEPS + 20);
    const saved = serializeProject([fileWith([doc], { workspaceHistory: commands })], 0).files[0];

    expect(saved.workspaceHistory).toHaveLength(MAX_UNDO_STEPS);
    expect(saved.documents[0].history).toHaveLength(MAX_UNDO_STEPS);
    // The newest entries are the ones kept.
    expect(saved.documents[0].history.at(-1)).toEqual(doc.history.at(-1));
  });

  it('stops at the size budget, so whole-sequence rewrites cannot balloon the file', () => {
    const long = 'A'.repeat(MAX_UNDO_CHARS / 4);
    let doc = createDocument('a', long);
    const commands = [];
    for (let i = 0; i < 5; i++) {
      doc = setRaw(doc, i % 2 ? long : 'C'.repeat(long.length)); // before + after = half the budget
      commands.push({ type: 'docEdit', docId: doc.id });
    }
    const saved = serializeProject([fileWith([doc], { workspaceHistory: commands })], 0).files[0];
    expect(saved.workspaceHistory).toHaveLength(2);
    expect(saved.documents[0].history).toHaveLength(2);
  });

  it('keeps nothing of a deleted sequence\'s own stacks, which cannot be paired safely', () => {
    const { doc: gone } = editRepeatedly(createDocument('gone', 'ACGT'), 2);
    const deletion = {
      type: 'deleteDocuments', deletedDocs: [gone], deletedIndices: [0],
      previousActiveDocId: gone.id, previousSelectedDocIds: new Set(), previousReferenceDocId: null,
    };
    const saved = serializeProject([fileWith([createDocument('a', 'ACGT')], { workspaceHistory: [deletion] })], 0);
    expect(saved.files[0].workspaceHistory[0].deletedDocs[0].history).toEqual([]);
  });
});

describe('reading a project', () => {
  it('rejects anything that is not a project', () => {
    expect(() => deserializeProject({ documents: [] })).toThrow(/Not a project/);
  });

  it('refuses a project from a newer version rather than half-reading it', () => {
    expect(() => deserializeProject({ format: PROJECT_FORMAT, version: PROJECT_VERSION + 1, files: [] }))
      .toThrow(/newer version/);
  });

  it('fills in an active sequence that is missing', () => {
    const project = serializeProject([fileWith([createDocument('a', 'ACGT')], { activeDocId: 'nope' })], 0);
    const { files } = roundTrip(project);
    expect(files[0].activeDocId).toBe(files[0].documents[0].id);
  });

  it('writes a gzip file and reads it back', async () => {
    const project = serializeProject([fileWith([createDocument('a', 'ACGT'.repeat(1000))])], 0);
    const blob = await encodeProject(project);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1F, 0x8B]);
    expect(bytes.length).toBeLessThan(JSON.stringify(project).length / 4);
    expect((await decodeProject(bytes)).files[0].documents[0].raw).toBe('ACGT'.repeat(1000));
  });

  it('also reads a project that has been unpacked to plain JSON', async () => {
    const project = serializeProject([fileWith([createDocument('a', 'ACGT')])], 0);
    const bytes = new TextEncoder().encode(JSON.stringify(project));
    expect((await decodeProject(bytes)).format).toBe(PROJECT_FORMAT);
  });

  it('says so when the bytes are not a project at all', async () => {
    await expect(decodeProject(new TextEncoder().encode('>seq\nACGT\n'))).rejects.toThrow(/Not a project/);
  });

  it('recognises project files by extension', () => {
    expect(isProjectFile('work.gene')).toBe(true);
    expect(isProjectFile('WORK.GENE')).toBe(true);
    expect(isProjectFile('work.fasta')).toBe(false);
  });
});
