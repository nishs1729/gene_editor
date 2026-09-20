// Which rows the alignment view actually draws, and in what order.
//
// The document list is the data; this is the view of it. Hiding a track drops it,
// pinning one lifts it into a frozen band under the ruler that does not scroll,
// and a group replaces its members with a header row when collapsed. Everything
// that needs to map a row index to a document — rendering, hit testing, scroll
// extent — goes through here, so the three never disagree.

const EMPTY_SET = new Set();

/**
 * @typedef {object} Row
 * @property {'sequence'|'group'} kind
 * @property {string} key
 * @property {object} [doc] - the SequenceDocument, for a sequence row
 * @property {object} [group] - the group, for a group header row
 * @property {number} [memberCount] - visible members, for a group header row
 * @property {number} depth - 0, or 1 for a sequence inside a group
 */

/**
 * @param {object} workspace - { documents, hiddenDocIds, pinnedDocIds, groups }
 * @returns {{frozen: Row[], scrolling: Row[]}}
 */
export function buildRowLayout(workspace) {
  const documents = workspace.documents ?? [];
  const hidden = workspace.hiddenDocIds ?? EMPTY_SET;
  const pinned = workspace.pinnedDocIds ?? EMPTY_SET;
  const groups = workspace.groups ?? [];

  const groupOf = new Map();
  for (const group of groups) {
    for (const id of group.docIds) groupOf.set(id, group);
  }

  const frozen = [];
  const scrolling = [];
  const consumed = new Set();

  for (const doc of documents) {
    if (hidden.has(doc.id) || consumed.has(doc.id)) continue;

    if (pinned.has(doc.id)) {
      frozen.push({ kind: 'sequence', key: doc.id, doc, depth: 0 });
      continue;
    }

    const group = groupOf.get(doc.id);
    if (!group) {
      scrolling.push({ kind: 'sequence', key: doc.id, doc, depth: 0 });
      continue;
    }

    // A group is drawn where its first visible member falls, and takes the rest
    // of its members with it however scattered they are in the document list.
    const members = documents.filter(
      d => group.docIds.includes(d.id) && !hidden.has(d.id) && !pinned.has(d.id)
    );
    scrolling.push({
      kind: 'group',
      key: `group:${group.id}`,
      group,
      memberCount: members.length,
      depth: 0,
    });
    if (!group.collapsed) {
      for (const member of members) {
        scrolling.push({ kind: 'sequence', key: member.id, doc: member, group, depth: 1 });
      }
    }
    for (const member of members) consumed.add(member.id);
  }

  return { frozen, scrolling };
}

/** The sequence rows in draw order, frozen band first. */
export function visibleDocuments(workspace) {
  const { frozen, scrolling } = buildRowLayout(workspace);
  return [...frozen, ...scrolling].filter(r => r.kind === 'sequence').map(r => r.doc);
}
