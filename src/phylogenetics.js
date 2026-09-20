// Distance-based tree building: UPGMA and Neighbour-Joining.
//
// Both take the pairwise distances the distance matrix already computes and
// return the same node shape, so the renderer never has to know which algorithm
// produced the tree it is drawing:
//
//   Node = { name?: string, children?: Node[], length: number }
//
// `length` is the branch from the node to its parent (0 at the root). Leaves
// carry a name, internal nodes carry children.

export const TREE_METHODS = [
  { id: 'upgma', label: 'UPGMA' },
  { id: 'nj', label: 'Neighbour-Joining' },
];

/** Fewer than this and there is no topology worth drawing. */
export const MIN_TREE_SEQUENCES = 3;

/**
 * Percent identity (what the distance matrix reports) as a distance.
 * @param {number[][]} identity - N×N, 0–100
 * @returns {number[][]} N×N divergence, 0–100
 */
export function identityToDistance(identity) {
  return identity.map(row => row.map(value => 100 - value));
}

/** A working copy of the matrix, so callers keep theirs. */
function copyMatrix(matrix) {
  return matrix.map(row => [...row]);
}

/**
 * Average-linkage clustering. Produces an ultrametric tree: every leaf ends up
 * the same distance from the root, which reads as "assume a constant rate" —
 * the assumption UPGMA makes and Neighbour-Joining does not.
 *
 * @param {string[]} names
 * @param {number[][]} distances - N×N, symmetric, zero diagonal
 * @returns {object|null} the root node, or null for fewer than two sequences
 */
export function buildUpgmaTree(names, distances) {
  const n = names.length;
  if (n < 2) return null;

  const d = copyMatrix(distances);
  // One cluster per sequence: its node, how many leaves it holds, and the height
  // at which it was formed (half the distance of the join that made it).
  const clusters = names.map((name, i) => ({
    index: i,
    node: { name, length: 0 },
    size: 1,
    height: 0,
  }));

  while (clusters.length > 1) {
    let best = { a: 0, b: 1, distance: Infinity };
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const distance = d[clusters[a].index][clusters[b].index];
        if (distance < best.distance) best = { a, b, distance };
      }
    }

    const left = clusters[best.a];
    const right = clusters[best.b];
    const height = best.distance / 2;

    left.node.length = Math.max(0, height - left.height);
    right.node.length = Math.max(0, height - right.height);
    const merged = {
      index: left.index, // the merged cluster reuses the left row of the matrix
      node: { children: [left.node, right.node], length: 0 },
      size: left.size + right.size,
      height,
    };

    // Average linkage: the new distance is the mean over the member pairs, which
    // is the size-weighted mean of the two clusters' distances.
    for (const other of clusters) {
      if (other === left || other === right) continue;
      const averaged = (
        d[left.index][other.index] * left.size + d[right.index][other.index] * right.size
      ) / merged.size;
      d[merged.index][other.index] = averaged;
      d[other.index][merged.index] = averaged;
    }

    clusters.splice(Math.max(best.a, best.b), 1);
    clusters.splice(Math.min(best.a, best.b), 1, merged);
  }

  return clusters[0].node;
}

/**
 * Neighbour-Joining. Makes no molecular-clock assumption, so branch lengths vary
 * and the tree it produces is unrooted; for display it is rooted at the midpoint
 * of the final branch, which is a convention, not an inference about the root.
 *
 * Negative branch lengths can fall out of the arithmetic when the distances are
 * not additive; they are clamped to zero, as is standard.
 *
 * @param {string[]} names
 * @param {number[][]} distances - N×N, symmetric, zero diagonal
 * @returns {object|null} the root node, or null for fewer than two sequences
 */
export function buildNeighborJoiningTree(names, distances) {
  const n = names.length;
  if (n < 2) return null;

  const d = copyMatrix(distances);
  const nodes = names.map((name, i) => ({ index: i, node: { name, length: 0 } }));

  while (nodes.length > 2) {
    const count = nodes.length;
    // Net divergence of each node from all the others.
    const divergence = nodes.map(
      (node, i) => nodes.reduce((sum, other, j) => (i === j ? sum : sum + d[node.index][other.index]), 0)
    );

    // Q corrects the raw distance for how far each of the pair sits from
    // everything else, which is what stops NJ from joining two long branches
    // just because they are both long.
    let best = { a: 0, b: 1, q: Infinity };
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        const q = (count - 2) * d[nodes[a].index][nodes[b].index] - divergence[a] - divergence[b];
        if (q < best.q) best = { a, b, q };
      }
    }

    const left = nodes[best.a];
    const right = nodes[best.b];
    const pairDistance = d[left.index][right.index];
    const delta = (divergence[best.a] - divergence[best.b]) / (count - 2);

    left.node.length = Math.max(0, (pairDistance + delta) / 2);
    right.node.length = Math.max(0, (pairDistance - delta) / 2);

    const merged = {
      index: left.index,
      node: { children: [left.node, right.node], length: 0 },
    };

    for (const other of nodes) {
      if (other === left || other === right) continue;
      const updated = (
        d[left.index][other.index] + d[right.index][other.index] - pairDistance
      ) / 2;
      d[merged.index][other.index] = updated;
      d[other.index][merged.index] = updated;
    }

    nodes.splice(Math.max(best.a, best.b), 1);
    nodes.splice(Math.min(best.a, best.b), 1, merged);
  }

  // Two nodes are left, joined by one branch. Rooting halfway along it gives the
  // drawing somewhere to start.
  const [left, right] = nodes;
  const half = Math.max(0, d[left.index][right.index] / 2);
  left.node.length = half;
  right.node.length = half;
  return { children: [left.node, right.node], length: 0 };
}

/** @param {'upgma'|'nj'} method */
export function buildTree(method, names, distances) {
  return method === 'nj'
    ? buildNeighborJoiningTree(names, distances)
    : buildUpgmaTree(names, distances);
}

/** Leaves in drawing order, top to bottom. */
export function treeLeaves(node, out = []) {
  if (!node) return out;
  if (!node.children) {
    out.push(node);
    return out;
  }
  for (const child of node.children) treeLeaves(child, out);
  return out;
}

/** Deepest root-to-leaf path, which sets the horizontal scale of a phylogram. */
export function treeDepth(node, from = 0) {
  if (!node) return 0;
  const depth = from + node.length;
  if (!node.children) return depth;
  return node.children.reduce((max, child) => Math.max(max, treeDepth(child, depth)), depth);
}

/**
 * Position every node for a rectangular dendrogram.
 * `x` is the distance from the root along the branches; `y` is the leaf's row,
 * or for an internal node the midpoint of the children it spans.
 *
 * @param {object} root
 * @returns {{nodes: Array<{node, x, y, parentX}>, leafCount: number, depth: number}}
 */
export function layoutTree(root) {
  const nodes = [];
  let leafIndex = 0;

  function place(node, parentX) {
    const x = parentX + node.length;
    if (!node.children) {
      const y = leafIndex++;
      nodes.push({ node, x, y, parentX });
      return y;
    }
    const childYs = node.children.map(child => place(child, x));
    const y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
    nodes.push({ node, x, y, parentX });
    return y;
  }

  if (root) place(root, 0);
  return { nodes, leafCount: leafIndex, depth: treeDepth(root) };
}
