# Whimsical selection toolbar: measurements (2026-10-08)

Measured live on whimsical.com (dark theme, 100% zoom, a selected rectangle).
Sizes are CSS px. Colours are the dark theme's unless noted.

## Bar
- One row, 40 px tall, `padding: 6px`, `border-radius: 10px`, sits **39 px above** the selection.
- Background `oklch(0.33 0.03 248)` (dark slate, not black), a 1 px inset ring `oklch(0.6 0.03 248 / 0.3)`,
  and a stacked soft shadow: `0 1px 2px -.5px rgba(15,18,21,.04), 0 2px 3px -1px rgba(15,18,21,.08),
  0 3px 4px -1px rgba(15,18,21,.08), 0 6px 8px -1.5px rgba(15,18,21,.12)`.
- Buttons are 30×28 (segmented ones 32–33×28), `border-radius: 6px`, icons 20 px in a 28 px box, white.
- Separators: 1 px wide × 20 px tall, `oklch(0.6 0.03 248 / 0.3)`, about 12 px of space each side.
- A button that opens a popover carries a **small purple triangle in its bottom-right corner**. There's no caret or "▾".
- Selected state: purple fill `oklch(0.58 0.23 301)` (~#8D4BF6) on the segment or button.
- Segmented groups (fill style, alignment, size) share one rounded slightly-lighter track, and the
  segments butt together (radius only on the outer corners).

## Shape toolbar, left to right
`Text` | `Change shape ◢` | `Color ◢` | [`Fill` `Outline` `Dash`] `Transparent` | `Add icon ◢` | `Rotate` | `Duplicate` | `Add comment` | `… (overflow)`

- **Text** doesn't open a popover. The bar **swaps in place** to a text bar and the label opens for typing:
  `‹ Finish editing` | [`−` `M` `+`] text size (M opens a vertical XS/S/M/L/XL/XXL list) | [`B` `I` `⋮`] | [`• list` `⋮`] | `link` | `@` | [left centre right] | [top middle bottom].
- **Fill style** is three segments (Fill / Outline / Dash) plus a separate Transparent toggle.
- **Overflow (…)**: a 272 px menu with 30 px rows at 14 px, keyboard shortcuts as small key chips on the right:
  Copy, Copy as… ▸, Cut, Delete · Add comment · Paste style, Save as default style · Arrange ▸, Align ▸, Lock,
  Wrap in section, Snap to grid, Set as board thumbnail.

## Colour picker
- A 126×126 popover, 9 px above the bar, centred on the colour button, with a little arrow. Same bg, radius and shadow as the bar.
- A **4×4 grid of 28 px cells**, each holding a **20 px circle** (1 px ring `oklch(0.6 0.03 248 / 0.3)`).
  15 colours + a "+" (custom colour) in the last cell:
  White, Smoke, Gray, Slate / Blue, Indigo, Purple, Pink / Mint, Green, Brown, Crimson / Red, Orange, Yellow, +.
- Selected: the cell becomes a purple 6 px-radius tile behind the circle. Hover: a faint 1 px outlined tile.
- **Tooltip**: the colour's name appears **above the whole popover**, never on a neighbouring swatch.
- One choice per hue. Whimsical derives fill / border / text tints from it, so there are no tiers to pick between.
- Dark-theme circle fills (for reference): Blue rgb(0,89,166), Indigo rgb(66,36,191), Purple rgb(75,0,145),
  Pink rgb(141,0,161), Mint rgb(0,128,115), Green rgb(0,78,69), Brown rgb(93,79,54), Crimson rgb(117,61,62),
  Red rgb(160,5,50), Orange rgb(181,86,0), Yellow rgb(190,149,0).

## Change-shape picker
Same popover style, a 4-column grid of 28 px cells: rectangle, rounded, circle, diamond / parallelogram,
trapezoid ×2, triangle / hexagon, cylinder, brace, cloud(?) / star. The current shape sits on a purple tile.

## Light theme
- **The bar and every popover stay dark slate in light mode** (same `oklch(0.33 0.03 248)`, same shadow).
  Segment track `oklch(0.4 0.033 248)`, radius 6 px. The dark chrome is deliberate in both themes.
- Picker circle fills (light), which are also the **shape fills**:
  White #FFFFFF (2 px white ring), Smoke #C4CFDA, Gray #798897, Slate #4D5D6C,
  Blue #2987D7, Indigo #655BF3, Purple #730FC3, Pink #BE36D3, Mint #26AFA0, Green #007A6F,
  Brown #897A5F, Crimson #A46767, Red #D5475B, Orange #E8843C, Yellow #F0C54F.
- Hover tile: `box-shadow: inset 0 0 0 1px oklch(0.6 0.03 248 / 0.3)`. No per-swatch tooltip appeared on hover in light mode.
- Board background #F3F5F8.

## How one colour becomes a shape (read off the canvas, Blue)
- **Fill**: the colour itself (#2987D7), no border, ~4 px corners, soft resting shadow.
- **Outline**: border in the colour (#2987D7, 1 px at 100%), and the inside is **the colour at 20% over white**
  (#D4E7F7 = mix(#2987D7, white, 0.8)), not white. Dark text.
- **Dash**: the outline look with a dashed border. **Transparent**: no fill at all.
- So one pick gives three looks. There's no tier to choose; Fill / Outline / Dash / Transparent is the second axis.

## Still to measure
- Connector toolbar (a synthetic drag didn't create a connector).
