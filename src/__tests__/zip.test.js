import { describe, it, expect } from 'vitest';
import { createZip, crc32, uniqueNames } from '../zip.js';

/** Just enough of a ZIP reader to check what createZip wrote. */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054B50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014B50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));

    expect(view.getUint32(localAt, true)).toBe(0x04034B50);
    const localNameLen = view.getUint16(localAt + 26, true);
    const dataAt = localAt + 30 + localNameLen;
    const data = bytes.subarray(dataAt, dataAt + size);
    entries.push({ name, crc, text: new TextDecoder().decode(data), crcOk: crc32(data) === crc });
    at += 46 + nameLen;
  }
  return entries;
}

describe('createZip', () => {
  it('stores each file under its name, byte for byte', () => {
    const entries = readZip(createZip([
      { name: 'alpha_modified.fasta', data: '>a\nACGT\n' },
      { name: 'beta_modified.fa', data: '>b\nGGCC\n' },
    ]));
    expect(entries.map(e => [e.name, e.text])).toEqual([
      ['alpha_modified.fasta', '>a\nACGT\n'],
      ['beta_modified.fa', '>b\nGGCC\n'],
    ]);
    expect(entries.every(e => e.crcOk)).toBe(true);
  });

  it('keeps non-ASCII names intact', () => {
    expect(readZip(createZip([{ name: 'séquence.fasta', data: 'x' }]))[0].name).toBe('séquence.fasta');
  });

  it('writes a valid, empty archive when given nothing', () => {
    expect(readZip(createZip([]))).toEqual([]);
  });

  it('renames a clashing file rather than letting it overwrite another', () => {
    const entries = readZip(createZip([
      { name: 'sample_modified.fasta', data: '1' },
      { name: 'sample_modified.fasta', data: '2' },
    ]));
    expect(entries.map(e => e.name)).toEqual(['sample_modified.fasta', 'sample_modified (2).fasta']);
  });
});

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });
});

describe('uniqueNames', () => {
  it('numbers repeats and skips numbers already taken', () => {
    expect(uniqueNames(['a.fa', 'a.fa', 'a (2).fa', 'a.fa'])).toEqual(['a.fa', 'a (2).fa', 'a (2) (2).fa', 'a (3).fa']);
  });
});
