// Downloads, and the names exported files are saved under.

import { toFasta } from './fasta.js';

/** Hand `text` to the browser as a download. */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Firefox only follows a link that is in the document, and cancels the
  // download if the URL is revoked before it has started reading it.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sequence and file names are free text; a download filename is not. */
export function safeFileName(name, fallback = 'sequence') {
  const cleaned = (name || '').replace(/[^\w.-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
  return cleaned || fallback;
}

/** `alpha.fa` → `['alpha', '.fa']`; a name with no extension is taken as FASTA. */
function splitExtension(fileName) {
  const name = (fileName || '').trim();
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    return [name.slice(0, dot), name.slice(dot).replace(/[^\w.]+/g, '')];
  }
  return [name, '.fasta'];
}

const MODIFIED = '_modified';

/**
 * The name an edited file is exported under: `alpha.fa` → `alpha_modified.fa`.
 * Exporting an already-exported file again does not stack the suffix.
 */
export function modifiedFileName(fileName) {
  const [stem, ext] = splitExtension(fileName);
  const base = safeFileName(stem, 'untitled').replace(/(_modified)+$/, '');
  return `${base}${MODIFIED}${ext}`;
}

/** The name a set of selected sequences from `fileName` is exported under. */
export function selectionFileName(fileName, documents) {
  if (documents.length === 1) return `${safeFileName(documents[0].name)}.fasta`;
  const [stem] = splitExtension(fileName);
  return `${safeFileName(stem, 'untitled').replace(/(_modified)+$/, '')}_selected.fasta`;
}

/** The name a project is saved under: its only file's, or the date. */
export function projectFileName(fileNames, date = new Date()) {
  const named = fileNames.filter(Boolean);
  if (fileNames.length === 1 && named.length === 1) {
    return `${safeFileName(splitExtension(named[0])[0], 'project').replace(/(_modified)+$/, '')}.gene`;
  }
  return `project-${date.toISOString().slice(0, 10)}.gene`;
}

/** FASTA for every sequence in `documents` that has any bases. */
export function fastaFor(documents) {
  return documents
    .filter(d => d.raw.length > 0)
    .map(d => toFasta(d.name || 'sequence', d.raw))
    .join('');
}
