import { describe, it, expect } from 'vitest';
import { parseFasta, toFasta } from '../fasta.js';

describe('parseFasta', () => {
  it('parses a single-record FASTA', () => {
    const text = '>TestSeq\nATGCATGC\nGGCCTTAA\n';
    const records = parseFasta(text);
    expect(records.length).toBe(1);
    expect(records[0].name).toBe('TestSeq');
    expect(records[0].sequence).toBe('ATGCATGCGGCCTTAA');
  });

  it('normalizes mixed-case to uppercase', () => {
    const text = '>test\natgcATGC\n';
    const records = parseFasta(text);
    expect(records[0].sequence).toBe('ATGCATGC');
  });

  it('parses multi-record FASTA', () => {
    const text = '>Seq1\nATGC\n>Seq2\nGGCC\n>Seq3\nTTAA\n';
    const records = parseFasta(text);
    expect(records.length).toBe(3);
    expect(records[0].name).toBe('Seq1');
    expect(records[0].sequence).toBe('ATGC');
    expect(records[1].name).toBe('Seq2');
    expect(records[1].sequence).toBe('GGCC');
    expect(records[2].name).toBe('Seq3');
    expect(records[2].sequence).toBe('TTAA');
  });

  it('strips whitespace and digits from sequences', () => {
    const text = '>test\n  AT GC 123\n  GG CC  \n';
    const records = parseFasta(text);
    expect(records[0].sequence).toBe('ATGCGGCC');
  });

  it('skips comment lines starting with ;', () => {
    const text = '; This is a comment\n>test\nATGC\n; Another comment\nGGCC\n';
    const records = parseFasta(text);
    expect(records.length).toBe(1);
    expect(records[0].sequence).toBe('ATGCGGCC');
  });

  it('handles FASTA with no header (assigns default name)', () => {
    const text = 'ATGCGGCC\n';
    const records = parseFasta(text);
    expect(records.length).toBe(1);
    expect(records[0].name).toBe('Unnamed Sequence');
    expect(records[0].sequence).toBe('ATGCGGCC');
  });

  it('handles empty input', () => {
    expect(parseFasta('')).toEqual([]);
    expect(parseFasta('   \n  \n')).toEqual([]);
  });

  it('handles trailing newlines', () => {
    const text = '>test\nATGC\n\n\n';
    const records = parseFasta(text);
    expect(records.length).toBe(1);
    expect(records[0].sequence).toBe('ATGC');
  });

  it('handles Windows-style line endings (\\r\\n)', () => {
    const text = '>test\r\nATGC\r\nGGCC\r\n';
    const records = parseFasta(text);
    expect(records[0].sequence).toBe('ATGCGGCC');
  });

  it('preserves all IUPAC ambiguity codes', () => {
    const text = '>test\nATGCRYSWKMBDHVN\n';
    const records = parseFasta(text);
    expect(records[0].sequence).toBe('ATGCRYSWKMBDHVN');
  });
});

describe('toFasta', () => {
  it('exports a simple sequence', () => {
    const result = toFasta('TestSeq', 'ATGC');
    expect(result).toBe('>TestSeq\nATGC\n');
  });

  it('wraps sequence at specified line width', () => {
    const seq = 'ATGCATGCATGC';
    const result = toFasta('test', seq, 4);
    expect(result).toBe('>test\nATGC\nATGC\nATGC\n');
  });

  it('wraps at default line width 70', () => {
    const seq = 'A'.repeat(140);
    const result = toFasta('test', seq);
    const lines = result.split('\n').filter(l => l.length > 0);
    expect(lines[0]).toBe('>test');
    expect(lines[1]).toBe('A'.repeat(70));
    expect(lines[2]).toBe('A'.repeat(70));
  });

  it('handles empty sequence', () => {
    const result = toFasta('empty', '');
    expect(result).toBe('>empty\n');
  });
});

describe('round-trip', () => {
  it('parse → export → re-parse produces identical sequence', () => {
    const original = 'ATGCRYSWKMBDHVNATGCGGCCTTAA';
    const exported = toFasta('roundtrip', original);
    const reparsed = parseFasta(exported);
    expect(reparsed.length).toBe(1);
    expect(reparsed[0].name).toBe('roundtrip');
    expect(reparsed[0].sequence).toBe(original);
  });

  it('round-trips a long multi-line sequence', () => {
    const original = 'ATGC'.repeat(100); // 400 bases
    const exported = toFasta('long', original, 70);
    const reparsed = parseFasta(exported);
    expect(reparsed[0].sequence).toBe(original);
  });
});
