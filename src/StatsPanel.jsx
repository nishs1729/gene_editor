// StatsPanel: composition for the active sequence, or a summary of the selection.
//
// One sequence is described by what it is made of — length, GC, base counts.
// Several are described by how they relate: how alike they are, how ragged their
// ends, how much of the alignment they agree on. So the panel shows one or the
// other depending on how many rows are selected.

import { useMemo } from 'react';
import useStore, { getActiveDoc } from './store.js';
import { summarizeGroup } from './conservation.js';

function Stat({ label, value, className = '', title }) {
  return (
    <span className="stat-item" title={title}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${className}`}>{value}</span>
    </span>
  );
}

const Divider = () => <span className="stat-divider">|</span>;

export default function StatsPanel() {
  const stats = useStore(s => s.stats);
  const activeName = useStore(s => getActiveDoc(s)?.name ?? '');
  const fileName = useStore(s => s.workspace.fileName);
  const documents = useStore(s => s.workspace.documents);
  const selectedDocIds = useStore(s => s.workspace.selectedDocIds);

  const selected = useMemo(
    () => documents.filter(d => selectedDocIds.has(d.id)),
    [documents, selectedDocIds]
  );
  // Comparing every pair is the expensive part, so it is held until the selection
  // or the sequences themselves change.
  const group = useMemo(
    () => (selected.length > 1 ? summarizeGroup(selected) : null),
    [selected]
  );

  if (documents.length === 0 || (stats.length === 0 && !group)) {
    return (
      <div className="stats-panel">
        <span className="stats-empty">No sequence loaded</span>
      </div>
    );
  }

  if (group) return <GroupStats group={group} total={documents.length} />;

  const { length, ungappedLength, gaps, gcPercent, counts } = stats;
  // Ambiguity codes: anything that isn't a canonical base or a gap.
  const canonical = (counts['A'] || 0) + (counts['T'] || 0) + (counts['G'] || 0) + (counts['C'] || 0);
  const ambiguous = length - canonical - gaps;

  return (
    <div className="stats-panel">
      {/* The file, not the sequence: which of several open files you are looking
          at is the thing that is easy to lose track of. The active sequence's
          name is already on its own row in the gutter. */}
      {(fileName || documents.length > 1) && (
        <>
          <span className="stat-item">
            <span className="stat-value stat-active-name" title={fileName ? 'Loaded file' : 'Active sequence'}>
              {fileName || activeName || 'Unnamed'}
            </span>
          </span>
          <Divider />
        </>
      )}
      <Stat label="Length" value={`${length.toLocaleString()} bp`} />
      <Divider />
      <Stat label="GC" value={`${gcPercent}%`} title="Computed over ungapped length" />
      <Divider />
      <Stat label="A" value={counts['A'] || 0} className="stat-a" />
      <Stat label="T" value={counts['T'] || 0} className="stat-t" />
      <Stat label="G" value={counts['G'] || 0} className="stat-g" />
      <Stat label="C" value={counts['C'] || 0} className="stat-c" />
      {ambiguous > 0 && (
        <>
          <Divider />
          <Stat label="Ambiguous" value={ambiguous} className="stat-n" />
        </>
      )}
      {gaps > 0 && (
        <>
          <Divider />
          <Stat label="Gaps" value={gaps} className="stat-gap" />
          <Stat label="Ungapped" value={`${ungappedLength.toLocaleString()} bp`} />
        </>
      )}
    </div>
  );
}

/** What is worth knowing about several sequences at once. */
function GroupStats({ group, total }) {
  const {
    count, minLength, maxLength, equalLengths, gcPercent, gaps,
    meanIdentity, conservedColumns, comparedColumns, conservedPercent,
  } = group;

  return (
    <div className="stats-panel">
      <span className="stat-item">
        <span className="stat-value stat-active-name">
          {count} of {total} sequences selected
        </span>
      </span>
      <Divider />

      <Stat
        label="Length"
        value={equalLengths
          ? `${maxLength.toLocaleString()} bp`
          : `${minLength.toLocaleString()}–${maxLength.toLocaleString()} bp`}
        title={equalLengths
          ? 'Every selected sequence is the same length'
          : 'Shortest to longest — unequal lengths mean the rows are not padded to a common alignment width'}
      />
      <Divider />

      <Stat label="GC" value={`${gcPercent}%`} title="Over the pooled ungapped bases of the selection" />
      <Divider />

      <Stat
        label="Mean identity"
        value={meanIdentity === null ? '—' : `${meanIdentity.toFixed(1)}%`}
        title={meanIdentity === null
          ? 'Too many sequences selected to compare every pair'
          : 'Average percent identity over every pair, counting only columns where both sequences have a base'}
      />
      <Divider />

      <Stat
        label="Conserved"
        value={conservedColumns === null
          ? '—'
          : `${conservedColumns.toLocaleString()} / ${comparedColumns.toLocaleString()} cols (${conservedPercent.toFixed(0)}%)`}
        title={conservedColumns === null
          ? 'Too many sequences selected to score every column'
          : 'Columns where at least 90% of the selected sequences agree, out of the columns that have any base at all'}
      />

      {gaps > 0 && (
        <>
          <Divider />
          <Stat label="Gaps" value={gaps.toLocaleString()} className="stat-gap" title="Total across the selection" />
        </>
      )}
    </div>
  );
}
