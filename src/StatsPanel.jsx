// StatsPanel: displays sequence length, GC%, and per-base composition.

import useStore from './store.js';

export default function StatsPanel() {
  const stats = useStore(s => s.stats);
  const { length, gcPercent, counts } = stats;

  if (length === 0) {
    return (
      <div className="stats-panel">
        <span className="stats-empty">No sequence loaded</span>
      </div>
    );
  }

  // Count ambiguous bases (anything that isn't A, T, G, or C)
  const canonical = (counts['A'] || 0) + (counts['T'] || 0) + (counts['G'] || 0) + (counts['C'] || 0);
  const ambiguous = length - canonical;

  return (
    <div className="stats-panel">
      <span className="stat-item">
        <span className="stat-label">Length</span>
        <span className="stat-value">{length.toLocaleString()} bp</span>
      </span>
      <span className="stat-divider">|</span>
      <span className="stat-item">
        <span className="stat-label">GC</span>
        <span className="stat-value">{gcPercent}%</span>
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
    </div>
  );
}
