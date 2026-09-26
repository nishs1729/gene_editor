# DNA Sequence Editor

A fast, browser-based viewer and editor for DNA/RNA sequences, styled after Geneious. Open FASTA files, view single sequences or full alignments, and edit them directly — no install, no account, nothing leaves your browser.

**[Open the app →](https://nishs1729.github.io/gene_editor/)**

## What it does

- **Work with several files at once** — open (or drag in) more than one FASTA file and switch between them from the files panel on the left; each keeps its own view, selection, zoom, and undo history exactly as you left it.
- **View any FASTA file** — a single sequence wraps across the screen; multiple sequences show as a stacked alignment, one row each, with a shared ruler and name column.
- **Colour-coded bases** — every base and IUPAC ambiguity code (A, T, G, C, and the rest) gets its own colour, so patterns and mismatches are easy to spot at a glance.
- **Edit sequences** — sequences open read-only; click **Allow Editing** to type, paste, cut, copy, delete, and undo/redo changes.
- **Consensus and comparison** — with multiple sequences loaded, see a live consensus row (with an adjustable agreement threshold), and highlight only the bases that *disagree* with the consensus or with a chosen reference sequence.
- **Reference sequences** — pick any one sequence as the reference for comparison; it's marked in the name column so you always know which one it is.
- **Zoom and resize** — Ctrl + scroll to zoom the sequence view in and out; drag the edge of the name column to make room for longer names.
- **Rename, select, delete** — press F2 (or double-click a name) to rename a sequence; select one or more rows to export just those, or press Delete to delete them.
- **Projects you can carry anywhere** — **Export → Project (.gene)** packs up everything that's open (every file, your edits, recent undo history, and view settings) into one file. Open it on any machine to carry on exactly where you left off.
- **Export FASTA** — the file on screen, just the selected sequences, or every open file at once as a `.zip`. Exported files keep their original names with `_modified` added, so they never overwrite your originals.
- **Reverse complement and complement strand** — flip a sequence, or show its complementary strand right underneath it.
- **Stats at a glance** — length, %GC, per-base counts, gaps, and ambiguous bases for whatever sequence is active.
- **Light and dark themes**, and a distraction-free fullscreen mode.
- **Autosaves nothing you don't ask for** — your work stays in the browser; click **Save** to keep every open file (with its undo history) in this browser for next time, and **Export** whenever you want a copy on disk or on another machine.

## Basic usage

1. Click **Open** (or drag files onto the window) and pick one or more `.fasta`, `.fa`, `.fna`, `.fas`, `.aln`, or `.txt` files — or a `.gene` project. One record opens as a single sequence; several open as an alignment. Each file appears in the files panel on the left — click one to switch to it, or the `«`/`»` button to collapse the panel out of the way.
2. Click a sequence to select it, click and drag to select a range of bases, or click a name to select a whole row.
3. Click **Allow Editing** before making any changes — this is a safety catch so you don't edit a sequence by accident.
4. Use the toolbar to toggle the complement strand, the consensus row, disagreement highlighting, or a reference sequence.
5. When you're done, **Save** to keep your work in this browser, or **Export** it:
   - **Project (.gene)** — everything, to reopen later or on another machine. Opening a project while other files are open asks whether to add it alongside them or replace them.
   - **This file** / **Selected sequences** / **All files (.zip)** — FASTA copies of your sequences.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Click / Shift+click / drag | Move cursor, extend or make a selection |
| Double-click / Triple-click a sequence | Select a word / the whole sequence |
| Ctrl/Cmd+click a name, or double-click it | Select that whole sequence (for export/reference/delete) |
| F2 | Rename the selected (or focused) sequence |
| Delete (with sequences selected by name) | Delete those sequences — undo brings them back |
| Ctrl/Cmd + scroll | Zoom the sequence view in and out |
| Ctrl/Cmd+C / X / V | Copy / cut / paste |
| Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z | Undo / redo |
| Ctrl/Cmd+S | Save (every open file, in this browser) |
| Alt + a base letter | Substitute in place, without shifting the rest of the sequence |
| Alt + Backspace/Delete | Delete in place, leaving a gap instead of closing it up |
| Space or **-** | Insert a gap |
| Esc | Exit fullscreen, or cancel a rename or an open-project prompt |
