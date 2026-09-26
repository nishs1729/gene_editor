import { describe, it, expect } from 'vitest';
import { modifiedFileName, selectionFileName, projectFileName, fastaFor, safeFileName } from '../exporters.js';

describe('modifiedFileName', () => {
  it('adds the suffix before the extension, keeping the extension', () => {
    expect(modifiedFileName('alpha.fasta')).toBe('alpha_modified.fasta');
    expect(modifiedFileName('alpha.fa')).toBe('alpha_modified.fa');
    expect(modifiedFileName('run.v2.aln')).toBe('run.v2_modified.aln');
  });

  it('does not stack the suffix on a file that was already exported', () => {
    expect(modifiedFileName('alpha_modified.fasta')).toBe('alpha_modified.fasta');
  });

  it('names a file that never had one', () => {
    expect(modifiedFileName('')).toBe('untitled_modified.fasta');
    expect(modifiedFileName('notes')).toBe('notes_modified.fasta');
  });

  it('makes a free-text name safe to save', () => {
    expect(modifiedFileName('my run/1.fasta')).toBe('my_run_1_modified.fasta');
  });
});

describe('selectionFileName', () => {
  it('uses the sequence name for a single sequence', () => {
    expect(selectionFileName('alpha.fasta', [{ name: 'COI gene' }])).toBe('COI_gene.fasta');
  });

  it('uses the file name for several', () => {
    expect(selectionFileName('alpha.fa', [{ name: 'a' }, { name: 'b' }])).toBe('alpha_selected.fasta');
  });
});

describe('projectFileName', () => {
  const date = new Date('2026-09-26T12:00:00Z');

  it('is named after the only open file', () => {
    expect(projectFileName(['alpha.fasta'], date)).toBe('alpha.gene');
  });

  it('is dated when several files are open, or the one open has no name', () => {
    expect(projectFileName(['a.fasta', 'b.fasta'], date)).toBe('project-2026-09-26.gene');
    expect(projectFileName([''], date)).toBe('project-2026-09-26.gene');
  });
});

describe('fastaFor', () => {
  it('writes every sequence with bases, and skips empty ones', () => {
    const text = fastaFor([{ name: 'a', raw: 'ACGT' }, { name: 'empty', raw: '' }, { name: '', raw: 'GG' }]);
    expect(text).toBe('>a\nACGT\n>sequence\nGG\n');
  });
});

describe('safeFileName', () => {
  it('falls back when nothing usable is left', () => {
    expect(safeFileName('///')).toBe('sequence');
    expect(safeFileName('', 'untitled')).toBe('untitled');
  });
});
