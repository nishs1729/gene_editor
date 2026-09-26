// Opening files picked with the Open button or dropped on the window: FASTA
// opens as a new file, a .gene project as the session it holds.

import useStore from './store.js';
import { parseFasta } from './fasta.js';
import { isProjectFile, decodeProject, deserializeProject } from './project.js';

export const OPEN_ACCEPT = '.gene,.fasta,.fa,.fna,.fas,.aln,.txt';

async function openProjectFile(file) {
  const store = useStore.getState();
  try {
    const project = deserializeProject(await decodeProject(await file.arrayBuffer()));
    store.requestOpenProject(project, file.name);
  } catch (err) {
    store.showToast(`Could not open "${file.name}": ${err.message}`, 'error');
  }
}

async function openFastaFile(file) {
  const store = useStore.getState();
  const records = parseFasta(await file.text()).filter(r => r.sequence.length > 0);
  if (records.length === 0) {
    store.showToast(`No valid sequences found in "${file.name}"`, 'error');
    return;
  }
  store.loadWorkspace(records, file.name);
  store.showToast(
    records.length === 1
      ? `Loaded "${records[0].name}" (${records[0].sequence.length.toLocaleString()} bp)`
      : `Loaded ${records.length} sequences from "${file.name}"`,
    'info'
  );
}

/**
 * Open each file in turn, in the order given, so they land in the files panel
 * in that order too.
 * @param {Iterable<File>} files
 */
export async function openFiles(files) {
  for (const file of files) {
    await (isProjectFile(file.name) ? openProjectFile(file) : openFastaFile(file));
  }
}
