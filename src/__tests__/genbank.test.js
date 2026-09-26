import { describe, it, expect } from 'vitest';
import {
  parseGenBank, encodeGenBankRecord, genBankFor, isGenBankFile,
} from '../genbank.js';

const SAMPLE = `LOCUS       pTest                     60 bp    DNA     circular UNK 01-JAN-2020
DEFINITION  A tiny test plasmid.
FEATURES             Location/Qualifiers
     source          1..60
                     /organism="synthetic construct"
     CDS             1..30
                     /gene="lacZ"
                     /product="beta-galactosidase alpha
                     fragment"
     misc_feature    complement(40..50)
                     /label="tag"
                     /note="a note"
     promoter        join(1..5,55..60)
ORIGIN
        1 atgaccatga ttacgccaag cttgcatgcc tgcaggtcga ctctagagga tccccgggta
//
LOCUS       pSecond                   20 bp    DNA     linear   UNK 01-JAN-2020
ORIGIN
        1 acgtacgtac gtacgtacgt
//
`;

describe('parseGenBank', () => {
  it('parses multiple records from one file', () => {
    const records = parseGenBank(SAMPLE);
    expect(records).toHaveLength(2);
    expect(records[0].name).toBe('pTest');
    expect(records[0].sequence).toBe('ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTA');
    expect(records[1].name).toBe('pSecond');
    expect(records[1].sequence).toBe('ACGTACGTACGTACGTACGT');
  });

  it('maps a plain range to a forward-strand feature', () => {
    const [record] = parseGenBank(SAMPLE);
    const cds = record.features.find(f => f.type === 'CDS');
    expect(cds).toMatchObject({ start: 0, end: 30, strand: 1, label: 'lacZ' });
  });

  it('joins a wrapped qualifier value across continuation lines', () => {
    const [record] = parseGenBank(SAMPLE);
    const cds = record.features.find(f => f.type === 'CDS');
    expect(cds.notes).toContain('beta-galactosidase alpha fragment');
  });

  it('reads a complement() location as reverse strand', () => {
    const [record] = parseGenBank(SAMPLE);
    const tag = record.features.find(f => f.label === 'tag');
    expect(tag).toMatchObject({ start: 39, end: 50, strand: -1 });
  });

  it('takes the outer bounds of a join()', () => {
    const [record] = parseGenBank(SAMPLE);
    const promoter = record.features.find(f => f.type === 'Promoter');
    expect(promoter).toMatchObject({ start: 0, end: 60 });
  });

  it('does not carry source qualifiers as a feature outside the type list', () => {
    const [record] = parseGenBank(SAMPLE);
    const source = record.features.find(f => f.label === 'synthetic construct' || f.notes?.includes('organism'));
    expect(source.type).toBe('Custom');
  });

  it('returns no records for text with no LOCUS line', () => {
    expect(parseGenBank('not a genbank file\njust some text\n')).toEqual([]);
  });
});

describe('isGenBankFile', () => {
  it('recognises .gb, .gbk and .genbank, case-insensitively', () => {
    expect(isGenBankFile('plasmid.gb')).toBe(true);
    expect(isGenBankFile('plasmid.GBK')).toBe(true);
    expect(isGenBankFile('plasmid.genbank')).toBe(true);
    expect(isGenBankFile('plasmid.fasta')).toBe(false);
  });
});

describe('encodeGenBankRecord / round trip', () => {
  const doc = {
    name: 'roundtrip seq',
    raw: 'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT',
    features: [
      { id: '1', label: 'fwd', type: 'CDS', start: 0, end: 10, strand: 1, notes: 'a CDS' },
      { id: '2', label: 'rev', type: 'Primer', start: 15, end: 25, strand: -1, notes: '' },
    ],
  };

  it('produces a record parseGenBank reads back with the same span and strand', () => {
    const [parsed] = parseGenBank(encodeGenBankRecord(doc));
    expect(parsed.sequence).toBe(doc.raw);
    expect(parsed.features).toHaveLength(2);
    const fwd = parsed.features.find(f => f.label === 'fwd');
    const rev = parsed.features.find(f => f.label === 'rev');
    expect(fwd).toMatchObject({ start: 0, end: 10, strand: 1, type: 'CDS' });
    expect(rev).toMatchObject({ start: 15, end: 25, strand: -1, type: 'Primer' });
  });

  it('replaces spaces in the sequence name with underscores in the LOCUS line', () => {
    expect(encodeGenBankRecord(doc)).toMatch(/^LOCUS\s+roundtrip_seq\s/);
  });

  it('concatenates several documents into one multi-record file', () => {
    const text = genBankFor([doc, { ...doc, name: 'second', raw: 'GGGGCCCCAAAATTTT', features: [] }]);
    expect(parseGenBank(text)).toHaveLength(2);
  });

  it('skips documents with no bases', () => {
    expect(genBankFor([{ ...doc, raw: '' }])).toBe('');
  });
});
