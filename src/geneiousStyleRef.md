# Geneious-Style Visual Reference

## Themes

Base cell colors (the table below) are **theme-independent** — they read correctly on
both the dark and light canvas, as they do in Geneious itself. Only the chrome around
them changes. Canvas-side values live in `theme.js`; the CSS equivalents live in the
`:root[data-theme=...]` blocks in `index.css`. Keep the two in sync.

| Element | Dark | Light |
|---|---|---|
| App background | `#1A1A2E` | `#FFFFFF` |
| Panel background | `#16213E` | `#F7F8FA` |
| Toolbar background | `#0F3460` | `#FFFFFF` |
| Canvas background | `#0A0E17` | `#FFFFFF` |
| Border | `#1A3A5C` | `#E1E4E8` |
| Primary text | `#E2E8F0` | `#1F2933` |
| Secondary text | `#8892B0` | `#6B7684` |
| Muted text | `#4A5568` | `#A3ABB8` |
| Accent | `#4285F5` | `#2D7FF9` |
| Ruler text | `#8892B0` | `#8A94A6` |
| Ruler ticks | `#4A5568` | `#C3C9D4` |
| Selection overlay | `rgba(66,135,245,0.35)` | `rgba(45,127,249,0.18)` |
| Cursor | `#FFFFFF` | `#1F2933` |
| Gap cell background | `#161B26` | `#EDEFF3` |
| Gap dash | `#4A5568` | `#A3ABB8` |
| Name gutter background | `#0F1524` | `#F7F8FA` |
| Active row highlight | `rgba(66,135,245,0.12)` | `rgba(45,127,249,0.08)` |
| Drop marker (drag-to-move) | `#4285F5` | `#2D7FF9` |
| Unsaved marker | `#E67E22` | `#D97706` |
| Reference name background | `rgba(72,187,120,0.25)` | `rgba(39,174,96,0.18)` |

The light theme is pinned to `temp_screenshot_geneious.png` (Geneious Alignment View).

The stats readout is the one place a base color is overridden per theme: `G`'s
`#F1C40F` gold is unreadable as text on white, so light mode uses `#B7950B` for that
label only. The canvas keeps the bright fill in both themes.

## Font
- **Family**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
  (system sans-serif — zero network latency, native look on every OS). Used
  everywhere, base letters included. Sans-serif is proportional, so the base grid
  can't size its columns off one glyph's measurement the way a monospace font
  could — `cellWidth` is sized to the *widest* character across every IUPAC code
  and the gap dash, so no letter ever overflows the fixed-width cell next to it.
- **Size**: 14px, fixed. Ctrl+wheel zoom is **horizontal only** (0.2×–4×, anchored
  on the base under the pointer): it scales the column width and nothing else, so
  row heights, the name gutter and the ruler never move vertically. Letters shrink
  to fit a narrowed column and are dropped below 7px, leaving colour bars; they
  never grow past 14px, which would be vertical zoom.
- **Weight**: normal (400)
- **Text color on base cells**: `#FFFFFF` (white)
- **Ruler text color**: `#8892B0`
- **Ruler tick color**: `#4A5568`

## Base Colors (Background)

| Code | Meaning     | Hex       | RGB             |
|------|-------------|-----------|-----------------|
| A    | Adenine     | `#27AE60` | (39, 174, 96)   |
| T    | Thymine     | `#E74C3C` | (231, 76, 60)   |
| G    | Guanine     | `#F1C40F` | (241, 196, 15)  |
| C    | Cytosine    | `#3498DB` | (52, 152, 219)  |
| R    | A/G         | `#1ABC9C` | (26, 188, 156)  |
| Y    | C/T         | `#9B59B6` | (155, 89, 182)  |
| S    | G/C         | `#2980B9` | (41, 128, 185)  |
| W    | A/T         | `#E67E22` | (230, 126, 34)  |
| K    | G/T         | `#8D9440` | (141, 148, 64)  |
| M    | A/C         | `#C0392B` | (192, 57, 43)   |
| B    | C/G/T       | `#7F8C8D` | (127, 140, 141) |
| D    | A/G/T       | `#6C7A44` | (108, 122, 68)  |
| H    | A/C/T       | `#A06070` | (160, 96, 112)  |
| V    | A/C/G       | `#508080` | (80, 128, 128)  |
| N    | Any         | `#575757` | (87, 87, 87)    |
| `-`  | Gap         | theme     | flat background + muted dash, not a base color |

## Guanine Text Color Exception
- G uses `#2C3E50` (dark) text instead of white, because `#F1C40F` yellow background has poor contrast with white text.

## Layout Dimensions
- **Cell width**: measured dynamically as the widest of every IUPAC code and the
  gap dash (see Font, above), scaled by zoom and ceiled to integer
- **Cell height**: fontSize + 6px padding (i.e., 20px at 14px font)
- **Row gap**: 2px between sequence rows (or sequence+complement pairs)
- **Ruler height**: 24px
- **Ruler tick interval**: labels every 10 bases at zoom 1, stepping up through
  20/50/100/… as columns narrow so labels stay ≥55px apart; minor ticks at half
  the label interval, dropped below 20px spacing
- **Left margin (ruler number gutter)**: 60px (enough for 6-digit position numbers)

## Complement Row
- Same base colors but at **50% opacity** (drawn with `globalAlpha = 0.5`)
- Slightly smaller font: 12px

## Selection Highlight
- **Color**: `rgba(66, 135, 245, 0.35)` — semi-transparent blue
- Drawn as overlay rectangles on top of base cells

## Cursor
- **Color**: `#FFFFFF` (white)
- **Width**: 2px vertical line
- **Blink interval**: 530ms on / 530ms off

## Background
- **Row alternating**: none (single background color); the active row instead gets a
  translucent accent wash

## Stacked (alignment-view) Layout
Used whenever more than one record is loaded; a single record keeps the wrapped view.
- **Name gutter**: sized to the longest name, clamped to 90–220px, 10px padding,
  ellipsis-truncated; 1px right border. Dragging that border resizes the column
  (40–600px) and pins the width until it is cleared; the grab zone is 4px either
  side of the border and runs the full height, ruler included.
- **Shared ruler**: 24px, pinned to the top of the canvas, driven by horizontal scroll
- **Row height**: same as the wrapped view's sequence row (cell height + 2px gap,
  plus the complement row when shown)
- **Unsaved marker**: 3px dot to the left of the name
- **Reference row**: its name cell gets a green wash. A selected row's blue wins
  while the row is selected, which it no longer is once a reference is set.
- Rows are unwrapped and virtualized in both axes
