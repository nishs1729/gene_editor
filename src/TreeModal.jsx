// Phylogenetic tree: a dendrogram built from the same pairwise distances the
// distance matrix reports.

import { useEffect, useMemo, useRef, useState } from 'react';
import useStore from './store.js';
import { distanceMatrix } from './conservation.js';
import {
  buildTree, identityToDistance, layoutTree, TREE_METHODS, MIN_TREE_SEQUENCES,
} from './phylogenetics.js';
import { downloadText } from './exporters.js';

const ROW_HEIGHT = 22;
const LABEL_WIDTH = 190;
const PADDING = 14;
const BRANCH_WIDTH = 360; // px the deepest root-to-leaf path is drawn across

export default function TreeModal() {
  const open = useStore(s => s.dialog === 'tree');
  const documents = useStore(s => s.workspace.documents);
  const closeDialog = useStore(s => s.closeDialog);
  const [method, setMethod] = useState('nj');
  const svgRef = useRef(null);

  const tree = useMemo(() => {
    if (!open || documents.length < 2) return null;
    const { names, identity } = distanceMatrix(documents);
    return buildTree(method, names, identityToDistance(identity));
  }, [open, documents, method]);

  const layout = useMemo(() => (tree ? layoutTree(tree) : null), [tree]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDialog();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, closeDialog]);

  if (!open) return null;

  function exportSvg() {
    if (!svgRef.current) return;
    // Serialising the element that is already on screen keeps the figure and the
    // view in step without a second layout pass.
    downloadText(`tree-${method}.svg`, new XMLSerializer().serializeToString(svgRef.current), 'image/svg+xml');
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeDialog}>
      <div
        className="modal modal-lg"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Phylogenetic tree"
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Phylogenetic tree</h2>
            <p className="modal-subtitle">
              Built from pairwise divergence, measured over the columns where both sequences have a base.
            </p>
          </div>
          <button className="modal-close" onClick={closeDialog} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div className="form-row" style={{ marginBottom: 12 }}>
            <select
              className="toolbar-select"
              value={method}
              onChange={e => setMethod(e.target.value)}
              aria-label="Tree method"
              title="UPGMA assumes a constant rate of change; Neighbour-Joining does not"
            >
              {TREE_METHODS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <button className="toolbar-btn" onClick={exportSvg} disabled={!layout}>
              Export SVG
            </button>
            <span className="tree-note">
              {method === 'upgma'
                ? 'Ultrametric: every leaf sits the same distance from the root.'
                : 'Unrooted; drawn rooted at the midpoint of the last branch.'}
            </span>
          </div>

          {documents.length < MIN_TREE_SEQUENCES ? (
            <p>Load at least {MIN_TREE_SEQUENCES} sequences to build a tree.</p>
          ) : (
            <div className="tree-scroll">
              <Dendrogram layout={layout} svgRef={svgRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A rectangular dendrogram: horizontal branches, vertical connectors. */
function Dendrogram({ layout, svgRef }) {
  if (!layout || layout.leafCount === 0) return null;
  const { nodes, leafCount, depth } = layout;

  // A tree of identical sequences has no depth at all; drawing it as a cladogram
  // (equal branch lengths) is better than dividing by zero.
  const scale = depth > 0 ? BRANCH_WIDTH / depth : 0;
  const xOf = x => PADDING + x * scale;
  const yOf = y => PADDING + y * ROW_HEIGHT + ROW_HEIGHT / 2;
  const width = PADDING * 2 + BRANCH_WIDTH + LABEL_WIDTH;
  const height = PADDING * 2 + leafCount * ROW_HEIGHT;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="tree-svg"
    >
      <rect width={width} height={height} fill="var(--bg-panel)" />
      {nodes.map((entry, i) => {
        const x = xOf(entry.x);
        const y = yOf(entry.y);
        const parentX = xOf(entry.parentX);
        const childYs = entry.node.children
          ? entry.node.children.map(child => {
            const found = nodes.find(n => n.node === child);
            return found ? yOf(found.y) : y;
          })
          : null;

        return (
          <g key={i}>
            {/* The branch from the parent to this node. */}
            <line x1={parentX} y1={y} x2={x} y2={y} stroke="var(--text-secondary)" strokeWidth="1.5" />
            {/* The connector spanning this node's children. */}
            {childYs && (
              <line
                x1={x}
                y1={Math.min(...childYs)}
                x2={x}
                y2={Math.max(...childYs)}
                stroke="var(--text-secondary)"
                strokeWidth="1.5"
              />
            )}
            {!entry.node.children && (
              <text
                x={x + 6}
                y={y + 4}
                fontSize="11"
                fill="var(--text-primary)"
                fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
              >
                {entry.node.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
