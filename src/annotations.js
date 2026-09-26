// Feature annotations: the labelled spans drawn under a sequence.
// The model is deliberately small — a feature is a span with a name, a type and
// a colour — and every field is normalised here so the renderer and the store
// never have to defend against a half-built one.

export const FEATURE_TYPES = [
  { id: 'CDS', label: 'CDS', color: '#4285F5' },
  { id: 'Promoter', label: 'Promoter', color: '#48BB78' },
  { id: 'Binding Site', label: 'Binding Site', color: '#ED8936' },
  { id: 'Primer', label: 'Primer', color: '#9F7AEA' },
  { id: 'Variant', label: 'Variant', color: '#F56565' },
  { id: 'Custom', label: 'Custom', color: '#718096' },
];

export const DEFAULT_FEATURE_TYPE = 'CDS';

/** The colour a type is drawn in unless the feature overrides it. */
export function colorForType(type) {
  return FEATURE_TYPES.find(t => t.id === type)?.color ?? '#718096';
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `feature-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

/**
 * Build a valid feature, or null when the span is not one.
 * Coordinates are 0-based and half-open, matching selections and search hits.
 * @param {object} input - { id, label, type, start, end, color, strand, notes }
 * @returns {object|null}
 */
export function createFeature(input = {}) {
  const start = Math.max(0, Math.floor(Number(input.start) || 0));
  const end = Math.floor(Number(input.end) || 0);
  if (!(end > start)) return null;

  const type = FEATURE_TYPES.some(t => t.id === input.type) ? input.type : DEFAULT_FEATURE_TYPE;
  return {
    id: input.id ?? newId(),
    label: (input.label ?? '').trim() || type,
    type,
    start,
    end,
    color: input.color || colorForType(type),
    strand: input.strand === -1 ? -1 : 1,
    notes: input.notes ?? '',
  };
}

/** Add or replace a feature in a list, keeping it sorted by position. */
export function upsertFeature(features = [], feature) {
  const without = features.filter(f => f.id !== feature.id);
  return [...without, feature].sort((a, b) => a.start - b.start || a.end - b.end);
}

export function removeFeature(features = [], featureId) {
  return features.filter(f => f.id !== featureId);
}

/** The feature covering `column`, latest-drawn first so it matches what is on top. */
export function featureAt(features = [], column) {
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (column >= f.start && column < f.end) return f;
  }
  return null;
}

/**
 * Move features through an edit that replaced `removed` bases at `position`
 * with `inserted` of them. Features keep the bases they annotate: they shift
 * when the sequence in front of them grows or shrinks, clip when an edit eats
 * one end, and drop out when it eats all of them.
 *
 * Returns the original array when nothing moved, so callers can tell whether an
 * edit disturbed the features at all.
 */
export function featuresAfterSplice(features = [], position, removed, inserted) {
  if (features.length === 0) return features;

  // A replace rewrites min(removed, inserted) bases where they stand — those
  // columns keep their coordinates and only the surplus at the far end moves.
  // Without this a same-length edit, like a substitution or a transform, would
  // drag every boundary inside it to the edge of the change.
  const common = Math.min(removed, inserted);
  const cutStart = position + common;
  const cutEnd = cutStart + removed - common;
  const delta = inserted - removed;
  if (cutStart === cutEnd && delta === 0) return features;

  // Coordinates on the cut boundary resolve outwards, so bases inserted at a
  // feature's edge land outside it rather than silently joining it.
  const mapStart = p => (p < cutStart ? p : p >= cutEnd ? p + delta : cutStart);
  const mapEnd = p => (p <= cutStart ? p : p >= cutEnd ? p + delta : cutStart);

  let changed = false;
  const next = [];
  for (const f of features) {
    const start = mapStart(f.start);
    const end = mapEnd(f.end);
    if (end <= start) { changed = true; continue; } // the edit swallowed it whole
    if (start === f.start && end === f.end) next.push(f);
    else { next.push({ ...f, start, end }); changed = true; }
  }
  return changed ? next : features;
}

/** Flip features onto the opposite strand of a reverse-complemented sequence. */
export function featuresAfterReverseComplement(features = [], length) {
  if (features.length === 0) return features;
  return features
    .map(f => ({
      ...f,
      start: length - f.end,
      end: length - f.start,
      strand: f.strand === -1 ? 1 : -1,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Move features through a drag of the bases in [start, end) to `dest`.
 * A feature wholly inside the moved span travels with it; the rest follow the
 * sequence closing up behind the span and reopening where it lands.
 */
export function featuresAfterMove(features = [], start, end, dest) {
  if (features.length === 0) return features;
  const span = end - start;
  const adjustedDest = dest > end ? dest - span : dest;

  const travelling = features.filter(f => f.start >= start && f.end <= end);
  const staying = features.filter(f => !(f.start >= start && f.end <= end));

  const closed = featuresAfterSplice(staying, start, span, 0);
  const reopened = featuresAfterSplice(closed, adjustedDest, 0, span);
  const moved = travelling.map(f => ({
    ...f,
    start: f.start - start + adjustedDest,
    end: f.end - start + adjustedDest,
  }));

  return [...reopened, ...moved].sort((a, b) => a.start - b.start || a.end - b.end);
}

const EMPTY_LANES = [];
const laneCache = new WeakMap();

/**
 * Sort features into non-overlapping lanes, so an exon inside a gene is drawn
 * under it rather than on top of it. Longer features take the upper lanes,
 * which puts the enclosing feature above the ones it contains.
 *
 * Memoised on the feature array, which only changes when the features do.
 * @returns {Array<Array<object>>} one array of disjoint features per lane
 */
export function packFeatures(features) {
  if (!features || features.length === 0) return EMPTY_LANES;
  const cached = laneCache.get(features);
  if (cached) return cached;

  const lanes = [];
  const sorted = [...features].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const f of sorted) {
    const lane = lanes.find(l => l[l.length - 1].end <= f.start);
    if (lane) lane.push(f);
    else lanes.push([f]);
  }

  laneCache.set(features, lanes);
  return lanes;
}

/** A one-line summary for the hover tooltip. */
export function describeFeature(feature) {
  const length = feature.end - feature.start;
  const strand = feature.strand === -1 ? '−' : '+';
  return `${feature.label} · ${feature.type} · ${feature.start + 1}–${feature.end} (${length} bp, ${strand})`;
}
