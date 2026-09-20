// Pairwise identity between every loaded sequence, as a colour-washed matrix.

import { useEffect, useMemo, useState } from 'react';
import useStore from './store.js';
import { distanceMatrix } from './conservation.js';
import { downloadText } from './exporters.js';

/** Green for identical, red for divergent, with the midpoint at 50%. */
function cellColor(identity) {
  const hue = (identity / 100) * 130; // 0 = red, 130 = green
  return `hsl(${hue} 62% 45% / 0.28)`;
}

export default function DistanceMatrixModal() {
  const open = useStore(s => s.dialog === 'distance');
  const documents = useStore(s => s.workspace.documents);
  const closeDialog = useStore(s => s.closeDialog);
  const [metric, setMetric] = useState('identity');

  const matrix = useMemo(
    () => (open ? distanceMatrix(documents) : null),
    [open, documents]
  );

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

  if (!open || !matrix) return null;

  const values = metric === 'identity' ? matrix.identity : matrix.differences;

  function exportCsv() {
    const header = ['', ...matrix.names].join(',');
    const rows = matrix.names.map((name, i) => [
      `"${name.replace(/"/g, '""')}"`,
      ...values[i].map(v => (metric === 'identity' ? v.toFixed(2) : v)),
    ].join(','));
    downloadText(`${metric === 'identity' ? 'identity' : 'differences'}-matrix.csv`, [header, ...rows].join('\n'));
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeDialog}>
      <div
        className="modal modal-lg"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Sequence distance matrix"
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Sequence distance matrix</h2>
            <p className="modal-subtitle">
              Compared over the columns where both sequences have a base — gaps carry no evidence.
            </p>
          </div>
          <button className="modal-close" onClick={closeDialog} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div className="form-row" style={{ marginBottom: 12 }}>
            <select
              className="toolbar-select"
              value={metric}
              onChange={e => setMetric(e.target.value)}
              aria-label="Matrix metric"
            >
              <option value="identity">Percent identity</option>
              <option value="differences">Substitutions</option>
            </select>
            <button className="toolbar-btn" onClick={exportCsv}>Export CSV</button>
          </div>

          <div className="matrix-scroll">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th />
                  {matrix.names.map((name, i) => (
                    <th key={i} title={name}>{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.names.map((name, i) => (
                  <tr key={i}>
                    <th title={name}>{i + 1}. {name}</th>
                    {values[i].map((value, j) => (
                      <td
                        key={j}
                        style={{
                          background: metric === 'identity' && i !== j ? cellColor(value) : undefined,
                        }}
                      >
                        {i === j ? '—' : metric === 'identity' ? value.toFixed(1) : value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
