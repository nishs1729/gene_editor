// StatsPanel: length, GC%, and per-base composition for the active sequence.

import useStore, { getActiveDoc } from './store.js';

export default function StatsPanel() {
  const stats = useStore(s => s.stats);
  const activeName = useStore(s => getActiveDoc(s)?.name ?? '');
  const docCount = useStore(s => s.workspace.documents.length);
  const { length, ungappedLength, gaps, gcPercent, counts } = stats;

  if (length === 0) {
    return (
      <div className="stats-panel">
        <span className="stats-empty">No sequence loaded</span>
      </div>
    );
  }

  // Ambiguity codes: anything that isn't a canonical base or a gap.
  const canonical = (counts['A'] || 0) + (counts['T'] || 0) + (counts['G'] || 0) + (counts['C'] || 0);
  const ambiguous = length - canonical - gaps;

  return (
    <div className="stats-panel">
      {docCount > 1 && (
        <>
          <span className="stat-item">
            <span className="stat-value stat-active-name">{activeName || 'Unnamed'}</span>
          </span>
          <span className="stat-divider">|</span>
        </>
      )}
      <span className="stat-item">
        <span className="stat-label">Length</span>
        <span className="stat-value">{length.toLocaleString()} bp</span>
      </span>
      <span className="stat-divider">|</span>
      <span className="stat-item">
        <span className="stat-label">GC</span>
        <span className="stat-value" title="Computed over ungapped length">{gcPercent}%</span>
      </span>
      <span className="stat-divider">|</span>
      <span className="stat-item">
        <span className="stat-label">A</span>
        <span className="stat-value stat-a">{counts['A'] || 0}</span>
      </span>
      <span className="stat-item">
        <span className="stat-label">T</span>
        <span className="stat-value stat-t">{counts['T'] || 0}</span>
      </span>
      <span className="stat-item">
        <span className="stat-label">G</span>
        <span className="stat-value stat-g">{counts['G'] || 0}</span>
      </span>
      <span className="stat-item">
        <span className="stat-label">C</span>
        <span className="stat-value stat-c">{counts['C'] || 0}</span>
      </span>
      {ambiguous > 0 && (
        <>
          <span className="stat-divider">|</span>
          <span className="stat-item">
            <span className="stat-label">Ambiguous</span>
            <span className="stat-value stat-n">{ambiguous}</span>
          </span>
        </>
      )}
      {gaps > 0 && (
        <>
          <span className="stat-divider">|</span>
          <span className="stat-item">
            <span className="stat-label">Gaps</span>
            <span className="stat-value stat-gap">{gaps}</span>
          </span>
          <span className="stat-item">
            <span className="stat-label">Ungapped</span>
            <span className="stat-value">{ungappedLength.toLocaleString()} bp</span>
          </span>
        </>
      )}
    </div>
  );
}
