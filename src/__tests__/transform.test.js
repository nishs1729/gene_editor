import { describe, it, expect } from 'vitest';
import {
  reverseSeq, complementSeq, reverseComplement, transcribe, reverseTranscribe,
  transformSpan, TRANSFORMS, createDocument, setRaw, undo,
} from '../sequenceModel.js';

describe('reverseSeq', () => {
  it('reverses without complementing', () => {
    expect(reverseSeq('ACGT')).toBe('TGCA');
  });

  it('carries gaps along with the bases', () => {
    expect(reverseSeq('AC-T')).toBe('T-CA');
  });
});

describe('complementSeq', () => {
  it('complements in place, so alignment columns are preserved', () => {
    expect(complementSeq('ACGT')).toBe('TGCA');
    expect(complementSeq('AAAA')).toBe('TTTT');
  });

  it('complements degenerate codes and leaves gaps alone', () => {
    expect(complementSeq('RYSWKM')).toBe('YRSWMK');
    expect(complementSeq('A-G')).toBe('T-C');
  });
});

describe('reverseComplement', () => {
  it('is the reverse of the complement', () => {
    expect(reverseComplement('AAGG')).toBe('CCTT');
  });

  it('is its own inverse', () => {
    const seq = 'ACGTRYKM-N';
    expect(reverseComplement(reverseComplement(seq))).toBe(seq);
  });
});

describe('transcription', () => {
  it('turns T into U and back', () => {
    expect(transcribe('ACGT')).toBe('ACGU');
    expect(reverseTranscribe('ACGU')).toBe('ACGT');
  });

  it('round-trips', () => {
    expect(reverseTranscribe(transcribe('TTACGT'))).toBe('TTACGT');
  });

  it('leaves everything that is not a T or U alone', () => {
    expect(transcribe('ACG-RN')).toBe('ACG-RN');
  });
});

describe('transformSpan', () => {
  it('applies the transform to just the span', () => {
    expect(transformSpan('AAACGTAAA', 3, 6, reverseComplement)).toBe('AAAACGAAA');
  });

  it('leaves the sequence alone for an empty or invalid span', () => {
    expect(transformSpan('ACGT', 2, 2, reverseComplement)).toBe('ACGT');
    expect(transformSpan('ACGT', -1, 2, reverseComplement)).toBe('ACGT');
    expect(transformSpan('ACGT', 0, 9, reverseComplement)).toBe('ACGT');
  });
});

describe('TRANSFORMS', () => {
  it('exposes every transform the menu offers, each with a label', () => {
    expect(Object.keys(TRANSFORMS)).toEqual([
      'reverse', 'complement', 'reverseComplement', 'transcribe', 'reverseTranscribe',
    ]);
    for (const transform of Object.values(TRANSFORMS)) {
      expect(typeof transform.label).toBe('string');
      expect(typeof transform.apply).toBe('function');
    }
  });

  it('applies through the same functions the menu names', () => {
    expect(TRANSFORMS.reverse.apply('ACGT')).toBe('TGCA');
    expect(TRANSFORMS.transcribe.apply('ACGT')).toBe('ACGU');
  });
});

describe('setRaw', () => {
  it('rewrites a whole row as a single undoable command', () => {
    const doc = createDocument('one', 'ACGTACGT');
    const rewritten = setRaw(doc, 'TTTT');
    expect(rewritten.raw).toBe('TTTT');
    expect(rewritten.history).toHaveLength(1);
    expect(undo(rewritten).raw).toBe('ACGTACGT');
  });

  it('keeps RNA, now that U is a valid base', () => {
    const doc = createDocument('one', 'ACGT');
    expect(setRaw(doc, 'ACGU').raw).toBe('ACGU');
  });

  it('is a no-op when the text has not changed', () => {
    const doc = createDocument('one', 'ACGT');
    expect(setRaw(doc, 'ACGT')).toBe(doc);
  });
});
