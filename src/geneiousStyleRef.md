# Geneious-Style Visual Reference

## Font
- **Family**: `"Courier New", "Consolas", "Liberation Mono", monospace` (system monospace — zero network latency)
- **Size**: 14px
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

## Guanine Text Color Exception
- G uses `#2C3E50` (dark) text instead of white, because `#F1C40F` yellow background has poor contrast with white text.

## Layout Dimensions
- **Cell width**: measured dynamically via `ctx.measureText('A').width`, ceiled to integer
- **Cell height**: fontSize + 6px padding (i.e., 20px at 14px font)
- **Row gap**: 2px between sequence rows (or sequence+complement pairs)
- **Ruler height**: 24px
- **Ruler tick interval**: every 10 bases (small tick), label every 10 bases
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
- **Canvas background**: `#0A0E17` (very dark navy)
- **Row alternating**: none (single background color)
- **App background**: `#1A1A2E` (dark purple-navy)
- **Panel background**: `#16213E` (dark blue)
