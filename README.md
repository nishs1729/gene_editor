# Gene Editor

A fast, browser-based viewer and editor for DNA/RNA sequences and multiple sequence alignments, styled after Geneious. Open FASTA files, read them as a single wrapped sequence or a stacked alignment, edit them, compare them, and take the result away as FASTA, SVG or CSV — no install, no account, and nothing ever leaves your browser.

**[Open the app →](https://nishs1729.github.io/gene_editor/)**

Everything runs client-side on an HTML canvas, so alignments of hundreds of sequences and hundreds of thousands of columns stay responsive: only the rows and columns actually on screen are drawn, and zooming far enough out switches to a compressed overview where each pixel summarises the bases behind it.

## Contents

- [What it's for](#what-its-for)
- [Features](#features)
- [Getting started](#getting-started)
- [Working with alignments](#working-with-alignments)
- [Editing](#editing)
- [Analysis](#analysis)
- [Saving, exporting and projects](#saving-exporting-and-projects)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Development](#development)

## What it's for

Reading and hand-curating sequence data: checking a Sanger read against a reference, cleaning the ragged ends off an alignment, fixing a miscalled base, seeing which columns actually vary, and getting a quick tree or identity matrix out of a set of sequences — the everyday jobs that usually mean opening a desktop package. It is a viewer and an editor, not an aligner: it will not compute an alignment for you, but it will show and edit one faithfully.

## Features

**Viewing**

- **Two layouts, chosen for you** — one sequence wraps across the window, each line under its own ruler; several sequences stack as an alignment, one unwrapped row each, with names in a left gutter under a shared ruler.
- **Colour-coded bases** — every base and IUPAC ambiguity code gets its own colour. Four palettes (classic, colourblind-safe, high-contrast neon, grayscale) under **View ▾**, independent of the light/dark theme.
- **Zoom from base letters to whole genome** — Ctrl+scroll or the status-bar slider. Zoom out far enough and the view compresses to a per-pixel overview of the whole alignment; zooming out stops exactly where everything fits the window, and that limit follows the window when you resize it.
- **Tracks and guides** — minimap strip under the ruler, conservation histogram, complement strand, feature annotations, and faint column guides every ten positions. All toggled under **View ▾**.
- **Light and dark themes**, plus a distraction-free fullscreen mode that keeps the status bar.

**Alignment work**

- **Consensus row** with an adjustable agreement threshold (50–100%); columns below it are called `N`.
- **Reference sequence** — nominate any sequence; it pins to the top and the rest can be compared against it.
- **Disagreement highlighting** — grey out every base that agrees with the consensus (or the reference) so only the differences keep their colour.
- **Organise the rows** — drag to reorder, sort by name, length or similarity to the reference, collect sequences into collapsible groups, hide tracks with the eye icon or pin them to the top with the pin icon.
- **Cleanup tools** — strip all-gap columns, trim ragged 5′/3′ ends below a coverage threshold, pad short sequences to a common length. Each is a single undo step.

**Editing**

- **Locked by default** — click **Allow Editing** first, so a stray keystroke can't change data you only meant to read.
- **Insert or substitute** — typing pushes the row right; Alt+base substitutes in place and keeps the columns in register.
- **Column editing** — click the ruler for a column cursor and type into every sequence at once; drag along the ruler to select a column range and replace, delete or copy the whole block.
- **Drag a selected span** left or right to slide bases through the gaps, as one undoable step.
- **Transforms** — reverse, complement, reverse-complement, transcribe and reverse-transcribe, applied to the active sequence, every selected sequence, or just the selected span.
- **Find and replace** — exact, IUPAC-aware (degenerate codes match the bases they stand for) or regex, with up to three mismatches, optional reverse-strand matching, across one sequence or all of them.
- **Annotations** — label a span as a feature with a type, strand, colour and notes; features draw in a lane under their sequence.
- **Undo/redo everything**, including whole-workspace operations like deleting or reordering sequences.

**Analysis**

- **Composition at a glance** — the info panel shows the loaded file's name, length, %GC, per-base counts, gaps and ambiguous bases; select several sequences and it switches to a group summary (length range, mean pairwise identity, conserved columns).
- **Distance matrix** — pairwise percent identity between every sequence, exportable as CSV.
- **Phylogenetic trees** — UPGMA or Neighbour-Joining dendrograms built from those distances, exportable as SVG.
- **Conservation track** — per-column identity or Shannon entropy.

**Files**

- **Several files at once** — each keeps its own sequences, selection, zoom and undo history; switch between them in the files panel.
- **Projects** — pack everything open into one `.gene` file and reopen it on any machine.
- **Saves to your browser** on demand, never automatically.

## Getting started

1. **Open some sequences.** Click **Open**, or drop files anywhere on the window. `.fasta`, `.fa`, `.fna`, `.fas`, `.aln` and `.txt` open as sequence files; a `.gene` file opens the project it holds. Lower-case bases are uppercased and `.` gaps become `-` on the way in.
2. **Find your way around.** One record opens wrapped; several open as a stacked alignment. Each file appears in the files panel on the left — click one to switch to it, or `«`/`»` to collapse the panel. Drag the divider at the right of the name gutter to give names more or less room.
3. **Move and select.** Click to place the cursor, drag to select a range of bases, click a name in the gutter to select a whole sequence. Ctrl+scroll zooms about the pointer; the slider and **Fit** button at the bottom right do the same job with the mouse.
4. **Edit, if you want to.** Click **Allow Editing** — until you do, the editor is read-only and the status bar says so.
5. **Keep your work.** **Save** stores every open file (with its undo history) in this browser; **Export ▾** writes a copy to disk.

Press <kbd>?</kbd> at any time for the in-app guide, which covers the same ground with the shortcuts alongside.

## Working with alignments

With more than one sequence loaded, the alignment-specific controls appear in the toolbar:

- **Consensus** toggles the consensus row under the ruler, and the percentage beside it sets how much agreement a column needs before it is called rather than left as `N`.
- **Highlighting** greys out agreements with the consensus or with the reference, leaving only disagreements coloured — the fastest way to see where sequences actually differ.
- **Add as Reference** promotes the one selected sequence to reference; it pins to the top and is marked in the gutter. **Remove Reference** puts it back.
- **Organise ▾** sorts (name, length, similarity to reference), groups the selection under a collapsible header, and restores hidden tracks.
- **Tools ▾** cleans up: strip all-gap columns, pad to equal length, trim ragged ends below a coverage you choose.

Rows themselves respond directly: drag a name to reorder, double-click it (or <kbd>F2</kbd>) to rename, use the eye icon to hide a track and the pin icon to freeze it at the top while the rest scroll.

## Editing

Sequences open locked. After **Allow Editing**:

| You want to | Do this |
|---|---|
| Insert bases | Type — the rest of the row shifts right |
| Substitute without shifting | Hold <kbd>Alt</kbd> and type the base |
| Insert a gap | <kbd>Space</kbd> or <kbd>-</kbd> |
| Delete but keep columns aligned | <kbd>Alt</kbd>+<kbd>Backspace</kbd> — leaves a gap |
| Edit every sequence at one position | Click the ruler for a column cursor, then type |
| Edit a block across all sequences | Drag along the ruler, then type, delete or copy |
| Slide bases through gaps | Select a span and drag it left or right |
| Rewrite a motif everywhere | <kbd>Ctrl</kbd>+<kbd>F</kbd>, then **Replace all** |

Degenerate IUPAC codes (R Y S W K M B D H V N) and `U` are accepted anywhere a base is. Every operation, including bulk ones like replace-all and the cleanup tools, is a single undo step.

## Analysis

- **Distances** — the pairwise percent identity matrix over every sequence, counting only columns where both sequences have a base. Export as CSV.
- **Tree** — a dendrogram from those distances, by UPGMA (assumes a molecular clock, gives a rooted ultrametric tree) or Neighbour-Joining (no clock assumption; the root position is a drawing convention, not a claim). Export as SVG. Needs at least three sequences.
- **Conservation histogram** (**View ▾**) — a per-column bar: green above 90% agreement, amber from 50%, red below.
- **Group summary** — select several sequences and the info panel reports the length range, pooled %GC, mean pairwise identity and the share of columns that are conserved.

## Saving, exporting and projects

**Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) keeps every open file, with its recent undo history, in this browser for next time. Nothing is saved until you ask.

**Export ▾** writes files you can take elsewhere:

- **Project (.gene)** — everything open: all files, your edits, recent undo history and view settings, in one file. Reopen it anywhere to carry on exactly where you left off. Opening a project while other files are open asks whether to add it alongside them or replace them.
- **This file** / **Selected sequences** / **All files (.zip)** — FASTA copies. Exported names keep the original with `_modified` added, so they never overwrite your source data.

The distance matrix and the tree export separately, as CSV and SVG, from their own windows.

## Keyboard shortcuts

**Navigation**

| Key | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> | Move the cursor one base |
| <kbd>↑</kbd> <kbd>↓</kbd> | Previous / next sequence (stacked) or line (wrapped) |
| <kbd>Home</kbd> <kbd>End</kbd> | Jump to the start or end of the sequence |
| <kbd>Ctrl</kbd>+<kbd>G</kbd> | Jump to a base position |

**Selection**

| Key | Action |
|---|---|
| Click / drag | Place the cursor / select a range of bases |
| <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> | Extend the selection |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> | Select the whole sequence |
| Click a name | Select that sequence |
| <kbd>Ctrl</kbd>+click / <kbd>Shift</kbd>+click a name | Add one / take the range in between |
| Drag on the ruler | Select a column range across every sequence |
| <kbd>Esc</kbd> | Clear the column cursor or column selection |

**Editing**

| Key | Action |
|---|---|
| <kbd>A</kbd> <kbd>C</kbd> <kbd>G</kbd> <kbd>T</kbd> … | Type a base; IUPAC codes and <kbd>U</kbd> are accepted |
| <kbd>Space</kbd> or <kbd>-</kbd> | Insert an alignment gap |
| <kbd>Alt</kbd>+base | Substitute in place, keeping the columns aligned |
| <kbd>Backspace</kbd> / <kbd>Delete</kbd> | Delete backwards / forwards |
| <kbd>Alt</kbd>+<kbd>Backspace</kbd> | Replace with a gap instead of closing the column up |
| <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> | Copy, cut, paste |
| <kbd>F2</kbd> or double-click a name | Rename the sequence |
| <kbd>Delete</kbd> (with names selected) | Delete those sequences — undo brings them back |

**History, view and dialogs**

| Key | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo / redo |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save every open file in this browser |
| <kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd> / <kbd>Ctrl</kbd>+<kbd>0</kbd> | Zoom in / out / reset |
| <kbd>Ctrl</kbd>+scroll | Zoom about the pointer |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> | Find and replace |
| <kbd>?</kbd> or <kbd>F1</kbd> | Open the in-app guide |
| <kbd>Esc</kbd> | Close a dialog, or leave fullscreen |

## Development

React 19 + Vite 6, Zustand for state, and a hand-written canvas renderer. No UI framework, no plotting library, no backend.

```bash
npm install
npm run dev       # dev server with hot reload
npm test          # Vitest — unit tests, no browser needed
npm run lint      # oxlint
npm run build     # production bundle into dist/
```

A tour of `src/`:

| Area | Files |
|---|---|
| State | `store.js` (single Zustand store), `sequenceModel.js`, `selection.js`, `editing.js` |
| Rendering | `canvasRenderer.js` (the hot path), `SequenceCanvas.jsx`, `rowLayout.js`, `palettes.js`, `theme.js` |
| Bioinformatics | `iupac.js`, `conservation.js`, `alignmentTools.js`, `phylogenetics.js`, `search.js`, `annotations.js` |
| Files | `fasta.js`, `project.js`, `openFiles.js`, `exporters.js`, `zip.js` |
| UI | `Toolbar.jsx`, `StatsPanel.jsx`, `SelectionReadout.jsx`, `FilesPanel.jsx`, and the dialogs |

The renderer is the part worth understanding first: it virtualizes both axes, measures its own font metrics, and switches to pixel-column aggregation when a base is narrower than a pixel. Tests live in `src/__tests__/` and run in plain Node — there is no jsdom, so component logic is tested through the store rather than through the DOM.
