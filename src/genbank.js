// GenBank format parser and exporter. The one common format that carries
// sequence and features together, so opening one populates the same
// annotation lane a hand-drawn feature would.
//
// Parses what NCBI, SnapGene, Benchling and ApE actually write: the LOCUS
// line, a FEATURES table with wrapped locations and quoted qualifiers, and an
// ORIGIN block of numbered ten-base groups. Circular/linear topology is read
// but not kept — nothing downstream of import understands a circular
// sequence yet, so round-tripping one back out just calls it linear.

import { isValidChar } from './iupac.js';
import { createFeature, FEATURE_TYPES } from './annotations.js';

const GENBANK_TYPE_OF = {
  CDS: 'Custom', promoter: 'Promoter', protein_bind: 'Binding Site',
  primer_bind: 'Primer', variation: 'Variant', mutation: 'Variant',
};
// CDS is far too common to lump under Custom; give it its own mapping so the
// object above can still be read as "GenBank key → our type" for the rest.
GENBANK_TYPE_OF.CDS = 'CDS';

const TYPE_TO_GENBANK = {
  CDS: 'CDS', Promoter: 'promoter', 'Binding Site': 'protein_bind',
  Primer: 'primer_bind', Variant: 'variation', Custom: 'misc_feature',
};

function typeFromGenBank(key) {
  return FEATURE_TYPES.some(t => t.id === GENBANK_TYPE_OF[key]) ? GENBANK_TYPE_OF[key] : 'Custom';
}

/**
 * The span and strand a location expression covers.
 * Handles `123..456`, `complement(...)`, `join(...)`/`order(...)`, a bare
 * position, and the `<`/`>` partial-boundary markers — by taking the outer
 * bounds of every sub-range, since a single-lane feature can't represent the
 * individual exons of a join anyway.
 * @returns {{start: number, end: number, strand: 1|-1}|null} 0-based, half-open
 */
function parseLocation(raw) {
  let s = raw.trim();
  let strand = 1;

  const complement = s.match(/^complement\((.*)\)$/s);
  if (complement) { strand = -1; s = complement[1]; }

  const grouped = s.match(/^(?:join|order)\((.*)\)$/s);
  const parts = (grouped ? grouped[1] : s).split(',');

  let start = Infinity;
  let end = -Infinity;
  for (const part of parts) {
    const m = part.replace(/[<>]/g, '').trim().match(/^(\d+)(?:\.\.(\d+))?/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    start = Math.min(start, a);
    end = Math.max(end, b);
  }
  if (!isFinite(start) || !isFinite(end) || end < start) return null;
  return { start: start - 1, end, strand };
}

/** Parse the FEATURES table starting at `lines[i]` (the "FEATURES" header itself). */
function parseFeatures(lines, i, seqLength) {
  const features = [];
  let current = null; // { key, locationParts, qualifiers, openQualifier }

  function flush() {
    if (!current) return;
    const span = parseLocation(current.locationParts.join(''));
    if (span) {
      const start = Math.max(0, span.start);
      const end = Math.min(seqLength, span.end);
      if (end > start) {
        const q = current.qualifiers;
        const label = q.label || q.gene || q.product || q.note || current.key;
        const type = typeFromGenBank(current.key);
        const notes = [
          type === 'Custom' && current.key !== 'misc_feature' ? `GenBank type: ${current.key}` : null,
          ...Object.entries(q)
            .filter(([k]) => k !== 'label')
            .map(([k, v]) => `${k}: ${v}`),
        ].filter(Boolean).join(' | ');
        features.push(createFeature({ label, type, start, end, strand: span.strand, notes }));
      }
    }
    current = null;
  }

  i++; // past the "FEATURES" header
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' ) continue;
    if (!/^\s/.test(line)) break; // an unindented line starts the next section

    const featureStart = line.match(/^ {5}(\S+)\s+(.*)$/);
    const qualifierStart = line.match(/^ {21}\/([\w-]+)(?:=(.*))?$/);

    if (featureStart) {
      flush();
      current = { key: featureStart[1], locationParts: [featureStart[2].trim()], qualifiers: {}, openKey: null };
    } else if (current && qualifierStart) {
      current.openKey = qualifierStart[1];
      let value = qualifierStart[2];
      if (value === undefined) {
        current.qualifiers[current.openKey] = true;
        current.openKey = null;
      } else if (value.startsWith('"') && !value.endsWith('"')) {
        current.qualifiers[current.openKey] = value.slice(1); // closed by a later continuation line
      } else {
        current.qualifiers[current.openKey] = value.replace(/^"|"$/g, '');
        current.openKey = null;
      }
    } else if (current && current.openKey) {
      // Continuation of a quoted qualifier value.
      const text = line.trim();
      const closes = text.endsWith('"');
      current.qualifiers[current.openKey] += ' ' + (closes ? text.slice(0, -1) : text);
      if (closes) current.openKey = null;
    } else if (current) {
      // Continuation of a wrapped location.
      current.locationParts.push(line.trim());
    }
  }
  flush();
  return { features, next: i };
}

/**
 * Parse GenBank-formatted text (one or more concatenated records, `LOCUS` to
 * `//` each) into the same shape `parseFasta` returns, plus `features`.
 * @param {string} text
 * @returns {Array<{name: string, sequence: string, features: object[]}>}
 */
export function parseGenBank(text) {
  const lines = text.split(/\r?\n/);
  const records = [];

  let i = 0;
  while (i < lines.length) {
    const locus = lines[i]?.match(/^LOCUS\s+(\S+)/);
    if (!locus) { i++; continue; }
    const name = locus[1];

    let features = [];
    const seqLines = [];
    i++;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('//')) { i++; break; }
      if (line.startsWith('FEATURES')) {
        const parsed = parseFeatures(lines, i, Infinity);
        features = parsed.features;
        i = parsed.next - 1;
      } else if (line.startsWith('ORIGIN')) {
        for (i++; i < lines.length && !lines[i].startsWith('//'); i++) {
          seqLines.push(lines[i].replace(/^\s*\d+\s*/, ''));
        }
        i--; // let the outer loop consume the "//" itself
      }
    }

    const sequence = [...seqLines.join('').toUpperCase().replace(/\./g, '-')].filter(isValidChar).join('');
    // Locations were parsed against an unbounded length above; clip them to
    // the sequence now that it's known.
    const clipped = features
      .map(f => ({ ...f, end: Math.min(f.end, sequence.length) }))
      .filter(f => f.end > f.start);
    records.push({ name, sequence, features: clipped });
  }

  return records;
}

/** @param {string} fileName */
export function isGenBankFile(fileName) {
  return /\.(gb|gbk|genbank)$/i.test(fileName ?? '');
}

const LOCATION_WIDTH = 58; // GenBank wraps qualifier/location text to stay near column 79

/** Wrap `text` (already including the leading slash-key) onto 21-space-indented lines. */
function wrapQualifier(text) {
  const words = text.split(' ');
  const lines = [];
  let line = words.shift() ?? '';
  for (const word of words) {
    if (line.length + 1 + word.length > LOCATION_WIDTH) {
      lines.push(line);
      line = word;
    } else {
      line += ' ' + word;
    }
  }
  lines.push(line);
  return lines.map(l => ' '.repeat(21) + l).join('\n');
}

function locationOf(feature) {
  const loc = `${feature.start + 1}..${feature.end}`;
  return feature.strand === -1 ? `complement(${loc})` : loc;
}

function encodeFeature(feature) {
  const key = TYPE_TO_GENBANK[feature.type] ?? 'misc_feature';
  const lines = [`     ${key.padEnd(16)}${locationOf(feature)}`];
  if (feature.label) lines.push(wrapQualifier(`/label="${feature.label}"`));
  if (feature.notes) lines.push(wrapQualifier(`/note="${feature.notes}"`));
  return lines.join('\n');
}

function encodeOrigin(raw) {
  const lines = ['ORIGIN'];
  for (let i = 0; i < raw.length; i += 60) {
    const chunk = raw.slice(i, i + 60).toLowerCase();
    const groups = [];
    for (let j = 0; j < chunk.length; j += 10) groups.push(chunk.slice(j, j + 10));
    lines.push(`${String(i + 1).padStart(9)} ${groups.join(' ')}`);
  }
  lines.push('//');
  return lines.join('\n');
}

/** GenBank locus names are one unbroken token; anything else becomes an underscore. */
function locusName(name) {
  return (name || 'sequence').trim().replace(/\s+/g, '_').slice(0, 20) || 'sequence';
}

/**
 * Encode one document as a single GenBank record.
 * @param {{name: string, raw: string, features?: object[]}} doc
 */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function locusDate(d = new Date()) {
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

export function encodeGenBankRecord(doc) {
  const header = `LOCUS       ${locusName(doc.name).padEnd(24)}${String(doc.raw.length).padStart(6)} bp    DNA     linear   UNK ${locusDate()}`;
  const definition = `DEFINITION  ${doc.name || 'Unnamed sequence'}.`;

  const parts = [header, definition];
  if (doc.features?.length) {
    parts.push('FEATURES             Location/Qualifiers');
    for (const f of [...doc.features].sort((a, b) => a.start - b.start)) parts.push(encodeFeature(f));
  }
  parts.push(encodeOrigin(doc.raw));
  return parts.join('\n') + '\n';
}

/** GenBank for every sequence in `documents` that has any bases, as one multi-record file. */
export function genBankFor(documents) {
  return documents.filter(d => d.raw.length > 0).map(encodeGenBankRecord).join('');
}
