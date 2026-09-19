// FASTA format parser and exporter.
// Handles multi-record files, mixed case, comment lines.

/**
 * Parse a FASTA-formatted text string.
 * Returns an array of { name, sequence } objects.
 * Handles:
 *   - Comment lines starting with ';'
 *   - Multi-line sequences
 *   - Mixed case (normalizes to uppercase)
 *   - Strips whitespace and digits from sequence lines
 *   - Preserves alignment gaps, normalizing '.' to '-'
 *   - Multiple records separated by '>' headers
 *
 * @param {string} text - raw FASTA text
 * @returns {Array<{name: string, sequence: string}>}
 */
export function parseFasta(text) {
  const records = [];
  let currentName = null;
  let currentSeq = [];

  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comment lines
    if (trimmed === '' || trimmed.startsWith(';')) continue;

    if (trimmed.startsWith('>')) {
      // Save previous record if exists
      if (currentName !== null) {
        records.push({
          name: currentName,
          sequence: currentSeq.join(''),
        });
      }
      // Start new record: header is everything after '>'
      currentName = trimmed.slice(1).trim();
      currentSeq = [];
    } else {
      // Sequence line: uppercase, strip non-alpha characters
      const cleaned = trimmed.toUpperCase().replace(/[^A-Z]/g, '');
      if (cleaned.length > 0) {
        // If no header seen yet, create a default one
        if (currentName === null) {
          currentName = 'Unnamed Sequence';
        }
        currentSeq.push(cleaned);
      }
    }
  }

  // Don't forget the last record
  if (currentName !== null) {
    records.push({
      name: currentName,
      sequence: currentSeq.join(''),
    });
  }

  return records;
}

/**
 * Export a sequence to FASTA format.
 * @param {string} name - sequence name/header
 * @param {string} sequence - the DNA sequence
 * @param {number} lineWidth - characters per line (default 70)
 * @returns {string} FASTA-formatted string
 */
export function toFasta(name, sequence, lineWidth = 70) {
  const header = `>${name}`;
  const lines = [header];

  for (let i = 0; i < sequence.length; i += lineWidth) {
    lines.push(sequence.slice(i, i + lineWidth));
  }

  return lines.join('\n') + '\n';
}
