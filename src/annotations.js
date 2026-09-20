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

/** A one-line summary for the hover tooltip. */
export function describeFeature(feature) {
  const length = feature.end - feature.start;
  const strand = feature.strand === -1 ? '−' : '+';
  return `${feature.label} · ${feature.type} · ${feature.start + 1}–${feature.end} (${length} bp, ${strand})`;
}
