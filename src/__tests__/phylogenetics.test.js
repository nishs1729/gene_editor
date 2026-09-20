import { describe, it, expect } from 'vitest';
import {
  buildUpgmaTree, buildNeighborJoiningTree, buildTree, identityToDistance,
  treeLeaves, treeDepth, layoutTree, TREE_METHODS, MIN_TREE_SEQUENCES,
} from '../phylogenetics.js';

/** The clade a node spans, as a sorted name list — topology without the shape. */
function clade(node) {
  return treeLeaves(node).map(leaf => leaf.name).sort();
}

/** Any internal node spanning exactly these leaves, wherever it sits. */
function findClade(node, names) {
  const wanted = [...names].sort().join('');
  if (clade(node).join('') === wanted) return node;
  for (const child of node.children ?? []) {
    const found = findClade(child, names);
    if (found) return found;
  }
  return null;
}

/** Root-to-leaf distance, for checking a UPGMA tree is ultrametric. */
function leafDepth(node, name, from = 0) {
  const depth = from + node.length;
  if (!node.children) return node.name === name ? depth : null;
  for (const child of node.children) {
    const found = leafDepth(child, name, depth);
    if (found !== null) return found;
  }
  return null;
}

describe('identityToDistance', () => {
  it('turns percent identity into percent divergence', () => {
    expect(identityToDistance([[100, 75], [75, 100]])).toEqual([[0, 25], [25, 0]]);
  });
});

describe('buildUpgmaTree', () => {
  // a and b are close, c is the outgroup.
  const names = ['a', 'b', 'c'];
  const distances = [
    [0, 2, 6],
    [2, 0, 6],
    [6, 6, 0],
  ];

  it('joins the closest pair first', () => {
    const tree = buildUpgmaTree(names, distances);
    const [first, second] = tree.children;
    const inner = first.children ? first : second;
    expect(clade(inner)).toEqual(['a', 'b']);
  });

  it('puts every leaf in the tree exactly once', () => {
    expect(clade(buildUpgmaTree(names, distances))).toEqual(['a', 'b', 'c']);
  });

  it('halves the joining distance into the branch lengths', () => {
    const tree = buildUpgmaTree(names, distances);
    const ab = tree.children.find(child => child.children);
    // a and b join at distance 2, so each sits 1 above the join.
    expect(ab.children[0].length).toBeCloseTo(1);
    expect(ab.children[1].length).toBeCloseTo(1);
  });

  it('is ultrametric — every leaf ends up the same distance from the root', () => {
    const tree = buildUpgmaTree(names, distances);
    const depths = names.map(name => leafDepth(tree, name));
    for (const depth of depths) expect(depth).toBeCloseTo(depths[0]);
    expect(depths[0]).toBeCloseTo(3); // half of the 6 separating c from the rest
  });

  it('averages over cluster members when it merges', () => {
    // d is nearer to the (a,b) cluster than c is, so it joins before c does.
    const tree = buildUpgmaTree(['a', 'b', 'c', 'd'], [
      [0, 2, 9, 4],
      [2, 0, 9, 4],
      [9, 9, 0, 9],
      [4, 4, 9, 0],
    ]);
    const outer = tree.children.find(child => child.children);
    expect(clade(outer)).toEqual(['a', 'b', 'd']);
  });

  it('needs at least two sequences', () => {
    expect(buildUpgmaTree(['a'], [[0]])).toBeNull();
    expect(buildUpgmaTree([], [])).toBeNull();
  });
});

describe('buildNeighborJoiningTree', () => {
  // The standard worked example: a and b pair off, c and d are the other side.
  const names = ['a', 'b', 'c', 'd'];
  const distances = [
    [0, 5, 9, 9],
    [5, 0, 10, 10],
    [9, 10, 0, 8],
    [9, 10, 8, 0],
  ];

  it('recovers the expected topology: a and b are neighbours', () => {
    // The method is unrooted, so where the root lands is a drawing convention
    // and not a claim — what it actually asserts is which leaves are neighbours.
    const tree = buildNeighborJoiningTree(names, distances);
    expect(findClade(tree, ['a', 'b'])).not.toBeNull();
    expect(findClade(tree, ['a', 'c'])).toBeNull();
    expect(findClade(tree, ['a', 'd'])).toBeNull();
  });

  it('gives the joined pair the branch lengths the method derives', () => {
    const tree = buildNeighborJoiningTree(names, distances);
    const ab = findClade(tree, ['a', 'b']);
    const lengths = ab.children.map(child => child.length).sort((x, y) => x - y);
    expect(lengths[0]).toBeCloseTo(2); // a
    expect(lengths[1]).toBeCloseTo(3); // b
  });

  it('keeps every leaf', () => {
    expect(clade(buildNeighborJoiningTree(names, distances))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not assume a clock, so leaves may differ in depth', () => {
    const tree = buildNeighborJoiningTree(names, distances);
    expect(leafDepth(tree, 'a')).not.toBeCloseTo(leafDepth(tree, 'b'));
  });

  it('never reports a negative branch length', () => {
    // Distances that are not additive, which is what produces negative branches.
    const tree = buildNeighborJoiningTree(['a', 'b', 'c', 'd'], [
      [0, 1, 20, 20],
      [1, 0, 2, 20],
      [20, 2, 0, 1],
      [20, 20, 1, 0],
    ]);
    const lengths = [];
    (function walk(node) {
      lengths.push(node.length);
      node.children?.forEach(walk);
    })(tree);
    for (const length of lengths) expect(length).toBeGreaterThanOrEqual(0);
  });

  it('handles the two-sequence case by rooting halfway between them', () => {
    const tree = buildNeighborJoiningTree(['a', 'b'], [[0, 6], [6, 0]]);
    expect(tree.children.map(child => child.length)).toEqual([3, 3]);
  });

  it('needs at least two sequences', () => {
    expect(buildNeighborJoiningTree(['a'], [[0]])).toBeNull();
  });
});

describe('buildTree', () => {
  const names = ['a', 'b', 'c'];
  const distances = [[0, 2, 6], [2, 0, 6], [6, 6, 0]];

  it('dispatches to the named method', () => {
    expect(clade(buildTree('upgma', names, distances))).toEqual(['a', 'b', 'c']);
    expect(clade(buildTree('nj', names, distances))).toEqual(['a', 'b', 'c']);
  });

  it('offers both methods to the UI, and wants three sequences to be worth drawing', () => {
    expect(TREE_METHODS.map(m => m.id)).toEqual(['upgma', 'nj']);
    expect(MIN_TREE_SEQUENCES).toBe(3);
  });
});

describe('layoutTree', () => {
  const tree = buildUpgmaTree(['a', 'b', 'c'], [[0, 2, 6], [2, 0, 6], [6, 6, 0]]);

  it('places one row per leaf, in drawing order', () => {
    const { nodes, leafCount } = layoutTree(tree);
    expect(leafCount).toBe(3);
    const leaves = nodes.filter(entry => !entry.node.children);
    expect(leaves.map(entry => entry.y).sort()).toEqual([0, 1, 2]);
  });

  it('centres an internal node on the leaves it spans', () => {
    const { nodes } = layoutTree(tree);
    const ab = nodes.find(entry => entry.node.children && clade(entry.node).join('') === 'ab');
    expect(ab.y).toBeCloseTo(0.5);
  });

  it('measures x along the branches from the root', () => {
    const { nodes, depth } = layoutTree(tree);
    expect(depth).toBeCloseTo(3);
    for (const entry of nodes) {
      expect(entry.x).toBeCloseTo(entry.parentX + entry.node.length);
    }
  });

  it('survives an empty tree', () => {
    expect(layoutTree(null)).toEqual({ nodes: [], leafCount: 0, depth: 0 });
  });
});

describe('treeDepth', () => {
  it('is the longest root-to-leaf path', () => {
    const tree = { children: [{ name: 'a', length: 1 }, { name: 'b', length: 4 }], length: 0 };
    expect(treeDepth(tree)).toBe(4);
  });
});
