# Selection toolbar, colour picker and theme control: redesign spec

Status: ready to build · 2026-10-08 · Target: `docs/whimsical-toolbar-measurements.md` (measured live today)

This spec covers the selection toolbar, the colour picker, the text bar, the overflow menu and a visible theme control. Values marked **measured** come from the measurements doc. Values marked **derived** were not measured and follow the same system. Nothing here needs a diagram migration or a format version bump (§1.4).

---

## 0. Decisions at a glance

| # | Decision | Rationale |
|---|---|---|
| D1 | The palette is 15 named colours plus "+" (custom). The 48-swatch tier grid goes. | One choice per hue, as in Whimsical. Fill / Outline / Dash / Transparent is the second axis, not a tier. |
| D2 | Each swatch stores `fill = stroke = the colour`. White is the exception (`#FFFFFF` / `#CBD5E1`). | The Fill look paints the colour and the Outline look borders in it. White needs a visible border. |
| D3 | `FillStyle` gains `'tinted'` and `'dashed'`. A new optional boolean `ShapeData.transparent` is added. `'outline'` keeps its old meaning (white inside). | Every stored shape renders exactly as it does today. Only the new values produce the new looks. |
| D4 | The Outline and Dash looks paint `mix(fill, #FFF, 0.8)` inside, computed in `shapePaint` and never stored. | This reproduces Whimsical's "colour at 20 % over white" (Blue gives `#D4E7F7`, which matches the measured value) without a third stored colour. |
| D5 | Sticky notes are painted `fill = mix(colour, #FFF, 0.75)`, `stroke = colour`. The default sticky becomes Yellow's pair. | Saturated stickies would read as shapes. Yellow at 75 % is `#FBF1D3`, about the current `#FBF3D0`. |
| D6 | Gray is `#788896`, not the measured `#798897`. | It is one unit off, and it makes the default connector colour (`DEFAULT_EDGE_STROKE`) match Gray, so Gray shows as active. |
| D7 | A swatch is shown active only on an exact pair match. Shapes painted from the old 48 show no active swatch. | No guessing. Old colours keep rendering. Picking any swatch normalises the shape. |
| D8 | The picker shows the hovered or focused colour's name in a label **above the whole popover**. There is no per-swatch `Tooltip`. | Measured. It also removes the "tooltip covers the next swatch" bug class for good. |
| D9 | The bar is rebuilt on fixed dark-slate chrome tokens in both themes, with 30×28 buttons, segmented tracks and a purple corner triangle. Carets go. | Measured. |
| D10 | Pressing **Text** swaps the bar in place into a text bar. For one unlocked node it also opens the label. `TextFormatBar` merges into the toolbar shell. | Measured. One bar, one position, one set of controls. |
| D11 | The overflow menu (…) is generated from the command registry. Arrange, Align, Lock, Delete, Copy and Save as default move into it. | Measured layout. Shortcut chips come from `src/commands` only. |
| D12 | "Add icon" and "Rotate" slots: Rotate is omitted. Our **Style** popover (corner radius, opacity, shadow) takes the "Add icon" slot. | We have neither icons nor rotation. Style is our only remaining "how it's drawn" control. |
| D13 | The connector bar is **derived** (not measured) from the same system. | The connector bar was not measured. |
| D14 | The theme gets a labelled **System / Light / Dark** segmented control in a new **account menu** (avatar button) on the dashboard header and the canvas top bar. The bottom-bar cycling button stays only on the public share page. | Whimsical keeps appearance in the account menu. The current icon-only cycler in the canvas bottom-right corner (it does exist; the brief's "⌘K only" is not quite right) is undiscoverable, and the dashboard has none. |
| D15 | Rich-text list (•) and @mention slots in the text bar are omitted. | The label editor is uncontrolled while open (`EditableLabel`), so rewriting line prefixes under the caret needs an editor API. Typing `- ` already makes a list. We have no mentions. |

---

## 1. Palette model

### 1.1 The table (`src/lib/palette.ts`)

Order is the grid order, row by row: White, Smoke, Gray, Slate / Blue, Indigo, Purple, Pink / Mint, Green, Brown, Crimson / Red, Orange, Yellow, then "+".

| id | name (aria-label) | `fill` | `stroke` | tint (Outline/Dash inside, computed) | `sticky` fill | Fill-look label | stroke as CSS |
|---|---|---|---|---|---|---|---|
| `white` | White | `#FFFFFF` | `#CBD5E1` | `#FFFFFF` | `#FFFFFF` | dark | rgb(203, 213, 225) |
| `smoke` | Smoke | `#C4CFDA` | `#C4CFDA` | `#F3F5F8` | `#F0F3F6` | dark | rgb(196, 207, 218) |
| `gray` | Gray | `#788896` | `#788896` | `#E4E7EA` | `#DDE1E5` | dark | rgb(120, 136, 150) |
| `slate` | Slate | `#4D5D6C` | `#4D5D6C` | `#DBDFE2` | `#D3D7DA` | white | rgb(77, 93, 108) |
| `blue` | Blue | `#2987D7` | `#2987D7` | `#D4E7F7` | `#CAE1F5` | white | rgb(41, 135, 215) |
| `indigo` | Indigo | `#655BF3` | `#655BF3` | `#E0DEFD` | `#D9D6FC` | white | rgb(101, 91, 243) |
| `purple` | Purple | `#730FC3` | `#730FC3` | `#E3CFF3` | `#DCC3F0` | white | rgb(115, 15, 195) |
| `pink` | Pink | `#BE36D3` | `#BE36D3` | `#F2D7F6` | `#EFCDF4` | white | rgb(190, 54, 211) |
| `mint` | Mint | `#26AFA0` | `#26AFA0` | `#D4EFEC` | `#C9EBE7` | dark | rgb(38, 175, 160) |
| `green` | Green | `#007A6F` | `#007A6F` | `#CCE4E2` | `#BFDEDB` | white | rgb(0, 122, 111) |
| `brown` | Brown | `#897A5F` | `#897A5F` | `#E7E4DF` | `#E2DED7` | white | rgb(137, 122, 95) |
| `crimson` | Crimson | `#A46767` | `#A46767` | `#EDE1E1` | `#E8D9D9` | white | rgb(164, 103, 103) |
| `red` | Red | `#D5475B` | `#D5475B` | `#F7DADE` | `#F5D1D6` | white | rgb(213, 71, 91) |
| `orange` | Orange | `#E8843C` | `#E8843C` | `#FAE6D8` | `#F9E0CE` | dark | rgb(232, 132, 60) |
| `yellow` | Yellow | `#F0C54F` | `#F0C54F` | `#FCF3DC` | `#FBF1D3` | dark | rgb(240, 197, 79) |

New exports in `palette.ts` (replacing `PALETTE`, `COLS`, `DEFAULT_SWATCH`, `HUES`, `TIERS`, `NEUTRALS`):

```ts
export interface SwatchColor { id: string; name: string; fill: string; stroke: string; sticky: string }  // types.ts: add name, sticky
export const PALETTE: readonly SwatchColor[];          // the 15 above, in order
export const GRID_COLUMNS = 4;
export const DEFAULT_SWATCH: SwatchColor;              // PALETTE[0] (white), unchanged fill/stroke
export const TINT_AMOUNT = 0.8;                        // Outline/Dash inside: mix(fill, #FFF, 0.8)
export const STICKY_TINT = 0.75;
export function mix(hex, towards, amount): string;     // unchanged
export function isHex6(value: string): boolean;        // /^#[0-9a-f]{6}$/i
export function swatchFromHex(hex: string): SwatchColor;  // custom: {id:'custom', name: hex.toUpperCase(), fill=stroke=HEX, sticky: mix(HEX,#FFF,0.75)}
export type ColourTarget = 'shape' | 'sticky' | 'edge';
export function swatchPair(s: SwatchColor, target: 'shape' | 'sticky'): { fill: string; stroke: string }; // sticky → {fill: s.sticky, stroke: s.stroke}
export function matchSwatch(colour: { fill?: string; stroke?: string }, target: ColourTarget): SwatchColor | null; // case-insensitive exact; edge compares stroke only
export function isDarkFill(fill: string): boolean;     // unchanged, threshold unchanged
```

`sticky` is precomputed at module load with `mix(fill, '#FFFFFF', STICKY_TINT)`. White is `#FFFFFF`.

### 1.2 Fill style: values and rendering (`src/types.ts`, `src/lib/shapeStyle.ts`)

```ts
export type FillStyle = 'filled' | 'outline' | 'tinted' | 'dashed';
// ShapeData:
transparent?: boolean;   // "Transparent" toggle. Absent/false = painted inside as the look says.
```

Meaning of each stored value. The bold rows are the ones the UI now writes.

| stored `fillStyle` | look button lit | inside | border | written by |
|---|---|---|---|---|
| absent / `'filled'` / anything unknown | **Fill** | `fill` | none | **Fill** |
| `'outline'` (legacy) | Outline | `#FFFFFF` (`OUTLINE_FILL`) | `stroke`, solid | nothing new (old diagrams, old board defaults) |
| `'tinted'` | **Outline** | `mix(fill, #FFF, 0.8)` | `stroke`, solid | **Outline** |
| `'dashed'` | **Dash** | `mix(fill, #FFF, 0.8)` | `stroke`, dashed | **Dash** |

`transparent === true` overrides the inside to `'transparent'` and leaves the border alone, so Outline plus Transparent is a bare border (Dash likewise). **Confirmed live in Whimsical (2026-10-08):** Transparent is a toggle that combines with Outline and Dash (both buttons stay lit), and **choosing Fill turns Transparent off**. So writing `fillStyle: 'filled'` also writes `transparent: false` in the same patch, and turning Transparent on while the look is Fill switches the look to Outline (`'tinted'`) in the same patch, because Fill + Transparent is never a state Whimsical shows. `shapePaint` still renders a stored Fill + `transparent: true` (from hand-edited JSON) as label only, without failing.

New and changed exports:

```ts
export type FillLook = 'fill' | 'outline' | 'dash';
export function resolveFillLook(d: Pick<ShapeData,'fillStyle'>): FillLook;  // filled/absent/unknown→fill; outline|tinted→outline; dashed→dash
export function resolveFillStyle(...)  // KEEP for callers; now returns FillStyle with unknown → 'filled'
export interface ShapePaint { fill: string; stroke: string | null; dashed: boolean }
export function shapePaint(data: Pick<ShapeData,'shape'|'fill'|'stroke'|'fillStyle'|'transparent'>): ShapePaint;
export const DASH_ARRAY = '5 4';  // SVG silhouettes; CSS boxes use border-style: dashed
```

`shapePaint` order of precedence. The first two rows are unchanged.

1. `isAnchorNode`: `{ fill: 'transparent', stroke: null, dashed: false }`.
2. `shape === 'text' | 'image'`: `{ fill: data.fill, stroke: null, dashed: false }`. Text and image ignore looks, as today.
3. The inside comes from the look in the table above. If `fill` is not `isHex6` (for example `transparent`), the tinted inside falls back to `OUTLINE_FILL`.
4. If `transparent === true`, the inside becomes `'transparent'`.

`ShapeNode.tsx` changes:
- Box: `borderStyle: paint.dashed ? 'dashed' : 'solid'`. The width stays `paint.stroke ? 1.5 : 0`. 1.5 px is kept rather than the measured 1 px so that existing outline shapes do not change; this is deliberate.
- Clip-shape `<path>` and the cylinder's body path: `strokeDasharray={paint.dashed ? DASH_ARRAY : undefined}`. The cylinder cap ellipse stays solid.
- Label contrast stays `isDarkFill(paint.fill)`. The tinted inside is always light, so Outline and Dash always get dark text. A transparent inside gets `text-shape-ink`, which is the rule a text shape already follows.

### 1.3 No migration, old diagrams unchanged

- Every shape stores its own `fill` and `stroke`. Nothing reads `PALETTE` to render. So a board painted from the old 48 renders byte-for-byte the same.
- Absent `fillStyle` still means Fill, `'outline'` still means a white inside, and absent `transparent` means painted. No existing JSON changes meaning.
- `diagramMigrations.ts` header: add `'tinted'`, `'dashed'` and `transparent` to the list of optional fields that need no step (next to `fillStyle`, `mindMap` and `ink`). There is no `CURRENT_DIAGRAM_VERSION` bump.
- Rollout caveat (put it in the release notes): a tab still running the old build reads `'tinted'` and `'dashed'` as Fill until it reloads. It does not crash and it does not write anything back.

### 1.4 Active swatch detection

- Shapes and frames, tables, wireframes and ink: `matchSwatch({fill, stroke}, 'shape')`. Stickies: `matchSwatch({fill, stroke}, 'sticky')`. Connectors: `matchSwatch({stroke}, 'edge')`. Comparison is exact and case-insensitive.
- Multi-selection: a swatch is active only if every colourable selected element matches the **same** swatch. Otherwise none is.
- Shapes painted from the old 48, and custom colours: **no swatch is active, and that is acceptable**. The "+" cell is never shown as active.

### 1.5 Custom colour ("+")

- The 16th cell is a `button` with `aria-label="Custom colour"` and a `Plus` icon of 14 px, white at 80 %. It holds a visually hidden `<input type="color" data-testid="custom-colour-input">`. Its value is the current colour if that is `isHex6`, otherwise `#2987D7`.
- Clicking "+" calls `input.showPicker?.() ?? input.click()`.
- The commit happens on the input's `change` event only, not on `input`. That is one history entry and no transient preview, and it keeps the Yjs binding to one write.
- Derivation: `swatchFromHex(hex)` gives fill = stroke = `HEX` (uppercase), and a sticky gets `mix(HEX, #FFF, 0.75)`. Connectors get stroke = `HEX`. Contrast follows from `isDarkFill`.
- The popover stays open after a custom pick. A preset pick closes it (as Whimsical does).

### 1.6 Everything else that reads the palette

| Consumer | Change |
|---|---|
| `ColorPalette.tsx` | Deleted. Replaced by `toolbar/ColorPicker.tsx` (§2). |
| `FloatingToolbar.tsx` swatch apply | Calls the new store action `updateSelectedNodesColour(swatch)` for nodes and `updateSelectedEdgesStyle({ stroke: swatch.stroke })` for connectors. |
| `useDiagramStore.ts` | **New** `updateSelectedNodesColour(swatch: SwatchColor)`. It calls `pushHistory` once, then one `set`. For each selected node it writes `swatchPair(swatch, data.shape==='sticky' ? 'sticky' : 'shape')`, skips images and groups as today, and updates `lastStyle` per kind through `pickShapeStyle` exactly as `updateSelectedNodesStyle` does. `updateSelectedNodesStyle` stays because other callers use it. `STICKY_FILL`/`STICKY_STROKE` become `swatchPair(yellow,'sticky')`, so new stickies only. `newShapeData` keeps `DEFAULT_SWATCH` (unchanged hexes). |
| Connectors (`defaults.ts`) | `DEFAULT_EDGE_STROKE` stays `#788896`, which now equals Gray. Any swatch writes its `stroke` (White gives a `#CBD5E1` line). |
| Frames (`FrameNode.tsx`) | No code change. They take the `shape` pair. The 28 % / 55 % `color-mix` now mixes the pure colour, which is the intended toned-down section look. |
| Tables | No code change. The header tint mixes `fill`. |
| Ink (`InkNode.tsx`) | No code change. It draws `data.stroke`. |
| Wireframes (`wireTint`) | No code change. A picked colour mixes into the fixed palette at 30 % / 40 %. |
| `TextFormatControls` `TEXT_COLORS` | Removed. Text colour uses the same `ColorGrid` (15 + "+") plus an **Auto** row (§3.4). Black is still reachable through "+". |
| `defaultStyle.ts` | Add `'transparent'` to `SHAPE_STYLE_KEYS`. `sanitizeDefaults` needs nothing more because `shapePaint` treats anything but `true` as false. |
| `style.copy` (`commands.ts`) | Capture `pickShapeStyle(selected.data)` instead of its hand-picked seven keys, so Paste style carries the look and `transparent` (it silently dropped `fillStyle` before). |
| `style.paste` | Add `when: (ctx) => ctx.styleClipboard.get() !== null`, so the overflow menu does not offer a no-op. |
| `palette.test.ts`, `shapeStyle.test.ts` | Rewritten (§6). |
| e2e `blue-3`, `mint-3`, `mint-4` | Rewritten (§6.2). |

---

## 2. Colour picker

### 2.1 Structure

`src/components/toolbar/ColorGrid.tsx` is presentational and reused by the shape colour picker, the connector colour picker and text colour:

```ts
interface ColorGridProps {
  label: string;                                   // aria-label of the grid, e.g. "Colors"
  swatches: readonly SwatchColor[];                // PALETTE
  activeId: string | null;                         // from matchSwatch
  onPick: (swatch: SwatchColor) => void;
  onCustom?: (hex: string) => void;                // renders the "+" cell when present
  customValue?: string;                            // seeds <input type=color>
  onHoverName?: (name: string | null) => void;     // drives the label above the popover
}
export function gridMove(index: number, key: string, count: number, cols = GRID_COLUMNS): number; // pure, exported for tests
```

`src/components/toolbar/ColorPicker.tsx` replaces `ColorPalette.tsx`:

```ts
interface ColorPickerProps {
  target: 'shape' | 'edge' | 'text';
  activeId: string | null;
  triggerColour: string | null;         // the circle on the trigger; null = mixed
  onPick: (s: SwatchColor) => void;
  onCustom: (hex: string) => void;
  keepEditorFocus?: boolean;            // true inside the text bar (§3.4)
  extra?: ReactNode;                    // text colour's "Auto" row
}
```

### 2.2 Metrics (measured)

| Element | Value |
|---|---|
| Popover | 126×126 (4×28 + 2×7 padding). `side="top"`, `sideOffset={9}`, `align="center"`. Background `var(--color-chrome)`, radius 10 px, `box-shadow: var(--shadow-chrome), inset 0 0 0 1px var(--color-chrome-ring)`. `Popover.Arrow` 12×6, fill `var(--color-chrome)`. |
| Grid | `display:grid; grid-template-columns: repeat(4, 28px); grid-auto-rows: 28px; gap: 0` |
| Cell | 28×28, `border-radius: 6px`, centres a 20 px circle |
| Circle | 20×20, `border-radius: 50%`, background = `swatch.fill` (connectors: `swatch.stroke`), `box-shadow: inset 0 0 0 1px var(--color-chrome-ring)`. White: `inset 0 0 0 2px #FFFFFF` (measured "2 px white ring"). |
| Hover / focus-visible cell | `box-shadow: inset 0 0 0 1px var(--color-chrome-ring)` |
| Selected cell | `background: var(--color-chrome-selected)` (purple tile behind the circle). `aria-pressed="true"`. |
| Name label | Absolutely positioned **above the popover** (`bottom: calc(100% + 6px)`, centred). `pointer-events:none`, `aria-hidden="true"`, class `swatch-name`. 11 px/500 white text on `var(--color-chrome)`, padding `3px 8px`, radius 6 px, same shadow. It shows the hovered cell's name, falling back to the focused cell's, and is hidden when there is none. "+" shows "Custom colour". |

### 2.3 Accessibility and keyboard

- The grid has `role="group" aria-label="Colors"`. Each cell is a `<button>` with `aria-label={swatch.name}` (for example "Blue") and `aria-pressed` for the active one. Buttons are kept (not radios) so that e2e selectors stay `getByRole('button', { name })`.
- Focus uses a roving `tabIndex`: the active cell (or the first) is 0 and the rest are -1. On open, `onOpenAutoFocus` is prevented and that cell is focused.
- `ArrowLeft/Right/Up/Down` move within the 4×4 and clamp at the edges (no wrap). `Home`/`End` go to the start or end of the row. `Enter`/`Space` pick (native button). Movement is `gridMove`.
- `Escape`: `Popover.Content onEscapeKeyDown={(e) => e.stopPropagation()}`. It closes the popover and returns focus to the trigger without reaching `Canvas`'s keyboard handler, which would otherwise clear the selection.
- The existing `Tooltip` component is **not** used per swatch. It is still used on the **Color** trigger (`label="Color"`, `side="top"`). The trigger's tooltip is suppressed while the popover is open (Radix does this when the trigger is `data-state=open`. Verify it, or pass `open={false}` while open).

---

## 3. Toolbar

### 3.1 Chrome tokens (`src/index.css`, the plain `@theme` block, beside `--color-ink-950`)

```css
/* Selection toolbar and its popovers: dark slate in BOTH themes (measured). */
--color-chrome: oklch(0.33 0.03 248);
--color-chrome-track: oklch(0.4 0.033 248);      /* segmented group track */
--color-chrome-ring: oklch(0.6 0.03 248 / 0.3);  /* 1px inset ring, separators, swatch rings, hover tile */
--color-chrome-hover: oklch(1 0 0 / 0.1);        /* button hover wash (derived) */
--color-chrome-selected: oklch(0.58 0.23 301);   /* ~#8D4BF6: selected segment / tile / popover triangle */
--color-chrome-text: #ffffff;
--color-chrome-text-muted: oklch(1 0 0 / 0.6);   /* shortcut chips, secondary text (derived) */
--shadow-chrome: 0 1px 2px -0.5px rgba(15,18,21,.04), 0 2px 3px -1px rgba(15,18,21,.08),
                 0 3px 4px -1px rgba(15,18,21,.08), 0 6px 8px -1.5px rgba(15,18,21,.12);
--radius-chrome: 10px;
```

These are fixed constants and are not redefined in either dark block. Update the "What deliberately does not move" comment to list `--color-chrome*`. `--color-ink-950` stays for the rail, tooltips and context menu, which are out of scope.

Component classes in `index.css` (written by hand so that state selectors stay readable):

```css
.chrome-bar { height: 40px; padding: 6px; gap: 2px; display: flex; align-items: center;
  background: var(--color-chrome); border-radius: var(--radius-chrome);
  box-shadow: var(--shadow-chrome), inset 0 0 0 1px var(--color-chrome-ring); color: var(--color-chrome-text); }
.chrome-btn { position: relative; width: 30px; height: 28px; border-radius: 6px; display: grid; place-items: center; color: #fff; }
.chrome-btn:hover { background: var(--color-chrome-hover); }
.chrome-btn:disabled { opacity: .3; pointer-events: none; }
.chrome-btn[aria-pressed="true"], .chrome-btn[data-active] { background: var(--color-chrome-selected); }
.chrome-btn[data-popover]::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 5px; height: 5px;
  background: var(--color-chrome-selected); clip-path: polygon(100% 0, 100% 100%, 0 100%); }
.chrome-btn[data-popover][aria-pressed="true"]::after { background: #fff; }   /* triangle stays visible on purple */
.chrome-sep { width: 1px; height: 20px; margin: 0 6px; background: var(--color-chrome-ring); flex: none; }  /* ≈12px icon-to-line */
.chrome-track { display: flex; background: var(--color-chrome-track); border-radius: 6px; }
.chrome-track > .chrome-btn { width: 32px; border-radius: 0; }
.chrome-track > .chrome-btn:first-child { border-radius: 6px 0 0 6px; }
.chrome-track > .chrome-btn:last-child  { border-radius: 0 6px 6px 0; }
.chrome-pop { background: var(--color-chrome); border-radius: var(--radius-chrome); padding: 7px;
  box-shadow: var(--shadow-chrome), inset 0 0 0 1px var(--color-chrome-ring); color: #fff; }
```

Icons are lucide at `size={20}` with `strokeWidth={1.75}` inside the 28 px box. Hand-drawn SVG icons (fill style, line, arrowheads) are redrawn at 20×20.

### 3.2 Primitives (`src/components/toolbar/chrome.tsx`, new)

```ts
export function ToolButton(p: { label: string; shortcut?: string; active?: boolean; popover?: boolean;
  disabled?: boolean; onClick?: () => void; children: ReactNode } & ButtonHTMLAttributes): JSX.Element;
  // aria-label=label, aria-pressed=active (only when `active` is passed), data-popover when popover,
  // wrapped in <Tooltip label shortcut side="top">. forwardRef so it can be a Radix trigger (asChild).
export function Segmented(p: { label: string; children: ReactNode }): JSX.Element;   // role="group" aria-label, .chrome-track
export function Separator(): JSX.Element;                                         // .chrome-sep, aria-hidden
export function ChromePopover(p: { label: string; side?: 'top'|'bottom'; sideOffset?: number /*9*/;
  keepEditorFocus?: boolean; width?: number; children: ReactNode }): JSX.Element;
  // Popover.Portal + Content.chrome-pop + Arrow; keepEditorFocus adds the onMouseDown
  // preventDefault + suppressNextBlurCommit that TextColorPicker does today.
```

`BUTTON_CLASS` and `ACTIVE_BUTTON_CLASS` are removed from `FloatingToolbar`, `TextFormatControls` and `ArrangeMenu`.

### 3.3 Shape bar: slot mapping

Whimsical: `Text | Change shape ◢ | Color ◢ | [Fill Outline Dash] Transparent | Add icon ◢ | Rotate | Duplicate | Comment | …`

FlowSketch, left to right. A slot whose condition fails is not rendered, and a separator is only drawn between two rendered groups.

| Slot | Control (aria-label) | Shown when | Action |
|---|---|---|---|
| 1 | **Text** (`Type`), tooltip shortcut `↵` | `textableNodes.length > 0` | Enter text mode (§3.4) |
| 2 | **Change shape** ◢ (current kind's icon) | `swappableNodes.length > 0` | Popover "Shape picker": 4-col grid of 28 px cells in a `.chrome-pop`, current kind = purple tile, `side="top"` |
| 3 | **Color** ◢ (20 px circle of the current colour) | `colourableNodes.length > 0` | §2 |
| 3t | *table only*: `Segmented "Table"` [**Add row**, **Remove row**, **Add column**, **Remove column**] + **Header row** (toggle, `aria-pressed`) | exactly one table | unchanged handlers |
| 4 | `Segmented "Fill style"` [**Fill**, **Outline**, **Dash**] + **Transparent** (toggle) | `styleableNodes.length > 0` | writes `fillStyle: 'filled' \| 'tinted' \| 'dashed'` / `transparent: !allTransparent` through `updateSelectedNodesData`. The lit segment is `resolveFillLook` when the whole selection agrees, otherwise none. Transparent is lit when every styleable node is transparent. |
| 5 ("Add icon" slot) | **Style** ◢ (`SlidersHorizontal`) | `styleableNodes.length > 0` | Corner radius (when all can round), Opacity, Drop shadow, restyled in `.chrome-pop` at 208 px. "Save as default style" **moves to the overflow menu**. |
| — ("Rotate") | omitted | | |
| 6 | **Filter selection** ◢ (existing `FilterSelectionMenu`, restyled trigger) | `selectedNodes.length > 1` | unchanged |
| 7 | **Duplicate** (`Copy` icon), shortcut from `edit.duplicate` | any node | `runCommand('edit.duplicate')` |
| 8 | **Add comment** (`MessageSquarePlus`) | exactly one node and `comment.addToSelection` `when` true | `runCommand('comment.addToSelection')` |
| 9 | **More actions** ◢ (`MoreHorizontal`) | always | Overflow menu (§3.5) |

What the existing selection types get. Every capability that was on the bar before is still reachable:

| Selection | Bar |
|---|---|
| One rectangle-like shape | Text · Change shape · Color · [Fill Outline Dash] Transparent · Style · Duplicate · Add comment · … |
| Sticky / text shape | same as above (text shape: swatch paints its background, as today) |
| Wireframe with a label | Text · Color · Duplicate · Add comment · … (no fill style or Style: fixed palette) |
| Wireframe with no label | Color · Duplicate · Add comment · … |
| Table | Color · [table ops] Header row · Duplicate · Add comment · … |
| Ink stroke | Color · Duplicate · Add comment · … |
| Frame | Color · Duplicate · Add comment · … (title edited by double-click, as today) |
| Group | Duplicate · Add comment · … (Ungroup is in … › Arrange) |
| Image only | Duplicate · Add comment · … |
| Multi-selection | Text · Change shape · Color · fill style · Style · Filter selection · Duplicate · … (no Add comment: a thread anchors one node) |
| Connector(s) only | §4 |

Where every previous bar control went:

| Previous control | Now |
|---|---|
| Text ▾ popover (typography) | Text → text bar |
| Arrange ▾ popover (z-order, group/ungroup, lock, align, distribute, match size, lay out) | … › Arrange ▸, … › Align ▸, … › Lock |
| Style › Save as default style | … › Save as default style |
| Add link | … › Add link (`edit.link`, K), and the **Link** button in the text bar |
| Delete | … › Delete |
| Filled / Outline | Fill / Outline segments (+ Dash, Transparent new) |

Positioning (`FloatingToolbar`): `transform: translate(-50%, calc(-100% - 39px))` (measured 39 px; was 20). Clamping and the `connectorDragging` fade are unchanged. The wrapper (`.pointer-events-none absolute z-30`) stays the toolbar's direct parent, because `connector-polish.spec.ts` reads its opacity through `locator('..')`. Remove `panel-in` blur and `backdrop-blur`, since the bar is opaque.

`role="toolbar" aria-label="Selection toolbar"` stays in both modes. In text mode the label becomes `"Text toolbar"` on an inner `role="group"`, and the outer name does not change, so selectors keep working.

### 3.4 Text mode (replaces `TextFormatBar` and `TextPopover`)

Entering text mode:
- Text button with one node, not locked: `setEditingNodeId(id)`. The label opens, and the bar renders text mode because `editingNodeId` is set.
- Text button with several nodes, or one locked node: local `textMode` state in `FloatingToolbar`. No editor opens, and patches go through `updateSelectedNodesData`, as the old Text popover did. `textMode` resets when the selected-id set changes.
- Double-click or Enter on a label (existing paths) also shows text mode, because it keys off `editingNodeId`/`editingEdgeId`. The early `return null` when editing in `FloatingToolbar` goes away.
- A table cell sets `editingNodeId`, but a table is excluded (unchanged rule), so the bar is hidden while a cell is open.

Layout, left to right:

| Slot | Control (aria-label) | Shape label | Connector label | Multi / locked |
|---|---|---|---|---|
| 1 | **Finish editing** (`ChevronLeft`) | yes | yes | yes (exits `textMode`) |
| sep | | | | |
| 2 | `Segmented "Text size"` [**Decrease size** `−`, **Text size** ◢ (shows `M` etc.), **Increase size** `+`] | XS–XXL list | S/M/L list | yes |
| sep | | | | |
| 3 | `Segmented "Text style"` [**Bold**, **Italic**, **More text styles** ◢ `⋮`] | yes | B, I only (no ⋮) | yes |
| 4 | **Link** (`Link2`, `aria-pressed` when set) | single node only | no | no |
| sep | | | | |
| 5 | `Segmented "Horizontal align"` [**Left**, **Center**, **Right**] | yes | no | yes |
| 6 | `Segmented "Vertical align"` [**Top**, **Middle**, **Bottom**] | yes | no | yes |

- **Text size** popover (`ChromePopover`, 120 px wide, rows 28 px, label left and px right in muted text). Shapes: `FONT_SIZE_PRESETS = [['XS',10],['S',12],['M',14],['L',18],['XL',24],['XXL',32]]` (new in `src/lib/text.ts`, together with `fontSizeLabel(px): string`, which returns the preset name on an exact match and otherwise `String(px)`). Connector: S/M/L map to `'small'|'medium'|'large'`. The current entry gets a purple row. `−` and `+` keep `nextFontSize` (2 px steps, `FONT_SIZE_MIN`/`MAX`), so `style.fontSizeUp/Down` and the buttons agree.
- **More text styles** popover: **Underline**, **Strikethrough** (toggle rows 28 px with icon and label), then a `Text colour` heading, then `ColorGrid` (15 + "+") and an **Auto** row (`aria-pressed` when `textColor` is undefined). Picking a swatch writes `textColor: swatch.fill`, and "+" writes `textColor: HEX`.
- **Link**: opens the existing link input (restyled §3.6). In editing mode it uses `keepEditorFocus`, but the input itself must take focus, so the label commits on blur first. This is acceptable because it is what K does today.
- **Finish editing**: `onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}`. The stopPropagation keeps the bar's own `suppressNextBlurCommit` from firing. `onClick`: if editing, `(document.activeElement as HTMLElement | null)?.blur()`, and `EditableLabel` commits and the caller closes it. Otherwise `setTextMode(false)`.
- Every popover in text mode passes `keepEditorFocus`. The bar root keeps `onMouseDown={(e) => { e.preventDefault(); suppressNextBlurCommit(); }}` from `TextFormatBar`.
- Anchor: when editing an edge, use `absolutePosition` for both ends (fixes `TextFormatBar`'s use of raw `position`, which was wrong for children of frames) and the same 39 px offset.

`TextFormatControls.tsx` stays the presentational component, now rendering slots 2–6:

```ts
export interface TextFormatControlsProps {
  value: TextFormatValue;                          // unchanged shape
  onChange: (patch: Partial<TextFormatValue>) => void;
  target: 'shape' | 'connectorLabel';              // now required
  keepEditorFocus: boolean;
  link: { active: boolean; onOpen: () => void } | null;
}
```

`TextFormatBar.tsx` is **deleted**, and `Canvas.tsx` stops mounting it. Its edge `label*` patch translation moves to a pure helper, `toConnectorLabelPatch(patch): Partial<ConnectorData>`, in `src/lib/text.ts`, and its value derivation moves to `textFormatValueOf(node | edge)` in the same file.

### 3.5 Overflow menu (…)

New dependency: `@radix-ui/react-dropdown-menu`, same family as Popover/Tooltip and MIT. It brings submenus, typeahead and arrow-key navigation. Install with `npm install --legacy-peer-deps`.

Pure model, `src/lib/overflowMenu.ts`:

```ts
export type OverflowEntry = { id: string } | { submenu: string; ids: (string | '-')[] };
export const NODE_OVERFLOW: OverflowEntry[][];   // sections
export const EDGE_OVERFLOW: OverflowEntry[][];
export interface ResolvedItem { kind: 'item'; id: string; title: string; chips: string[]; enabled: boolean; checked?: boolean }
export interface ResolvedSubmenu { kind: 'submenu'; title: string; items: (ResolvedItem | { kind: 'sep' })[] }
export function resolveOverflow(sections: OverflowEntry[][], reg: Registry, ctx: CommandContext, platform: Platform): (ResolvedItem | ResolvedSubmenu)[][];
```

Rules for `resolveOverflow`:
- A top-level item whose `when` is false is **dropped**.
- A submenu item whose `when` is false is **disabled**, following ArrangeMenu's "greyed, not vanishing" rule. A submenu with no enabled item is dropped.
- Empty sections are dropped. A `'-'` at either end of a submenu, or doubled, is collapsed.

`NODE_OVERFLOW` (measured order, mapped to our command ids):

1. `clipboard.copy`, `clipboard.copyAsImage` ("Copy as image", a flat item rather than a "Copy as ▸" submenu with one entry), `clipboard.cut`, `edit.delete`
2. `comment.addToSelection`
3. `style.copy`, `style.paste`, `style.saveDefault`
4. Arrange ▸ [`arrange.bringToFront`, `arrange.bringForward`, `arrange.sendBackward`, `arrange.sendToBack`, `-`, `arrange.group`, `arrange.ungroup`] · Align ▸ [`arrange.alignLeft`, `arrange.alignCenterX`, `arrange.alignRight`, `arrange.alignTop`, `arrange.alignCenterY`, `arrange.alignBottom`, `-`, `arrange.distributeX`, `arrange.distributeY`, `-`, `arrange.matchWidth`, `arrange.matchHeight`, `arrange.matchSize`, `-`, `arrange.layoutVertical`, `arrange.layoutHorizontal`] · `arrange.toggleLock` (checked = any selected locked) · `arrange.wrapInFrame` · `edit.link` · `view.toggleGridSnap` (checked = `gridSnap`) · `view.setThumbnail` · `view.clearThumbnail` · `view.presentFromFrame`

`EDGE_OVERFLOW`: [`edit.delete`] · [`style.saveDefault`] · [`view.toggleGridSnap`]

Registry changes (`src/commands/`):

| Change | Detail |
|---|---|
| `Command.checked?: (ctx) => boolean` (types.ts) | Optional. Read by the overflow menu (it renders `DropdownMenu.CheckboxItem`) and ignored elsewhere. Set on `arrange.toggleLock` and `view.toggleGridSnap`. |
| New `arrange.matchWidth` / `arrange.matchHeight` / `arrange.matchSize` | Titles "Match width" / "Match height" / "Match width and height". Group `arrange`, no keystroke, `contextMenu: 'node'`, `when` ≥ 2 selected nodes, run `matchSizeSelected('width'|'height'|'both')`. Today they exist only as ArrangeMenu buttons. |
| New `comment.addToSelection` | Title "Add comment", group `comments`, no keystroke, no `contextMenu`, `when`: exactly one selected node and `ctx.ui.startCommentOn` defined. Run: `ctx.ui.startCommentOn({ nodeId })`. Add it to `READ_ONLY_COMMAND_IDS` beside `comment.add`. |
| `CommandContext.ui.startCommentOn?: (anchor: CommentAnchor) => void` | Supplied by `Canvas` when `topBar`, as `(a) => useCommentStore.getState().beginCompose(a)`. |
| `style.copy` / `style.paste` | §1.6 |
| `shortcutChips(binding: Keybinding, platform): string[]` (registry.ts) | Mac: `['⌘','⇧','C']`. Other platforms: `['Ctrl','Shift','C']`. It uses the first binding of a command and is the only source of chip text. |

Component, `src/components/toolbar/OverflowMenu.tsx`: `{ ctx: CommandContext; target: 'node' | 'edge'; onRun: (id: string) => void }`. The `…` trigger is a `ToolButton popover label="More actions"`. Content: `side="bottom" align="start" sideOffset={9}`, collision-aware, closes on run.

Metrics (measured):

| Element | Value |
|---|---|
| Menu | width 272 px, `.chrome-pop` with padding 6 px |
| Row | height 30 px, padding `0 8px`, radius 6 px, font 14 px/400, white. Hover/highlight `var(--color-chrome-hover)`. Disabled: opacity .4 |
| Chips | right-aligned, gap 3 px. Each chip `min-width 20px; height 20px; padding 0 5px; border-radius 4px; background var(--color-chrome-track); color var(--color-chrome-text-muted); font 12px/500` |
| Section separator | 1 px `var(--color-chrome-ring)`, margin `4px 0` |
| Submenu row | trailing `ChevronRight` 16 px, muted. SubContent is the same `.chrome-pop` at 240 px, `sideOffset={4}` |
| Checked row | leading `Check` 16 px in a 20 px gutter (all rows reserve the gutter only when the section holds a checkable item) |

`FloatingToolbar` receives `commandContext` and `runCommand` as props from `Canvas` (`<FloatingToolbar ctx={commandContext} onRunCommand={runCommand} />`). The bar's own Duplicate and Add comment buttons run through `onRunCommand` too.

`ArrangeMenu.tsx` is **deleted**.

### 3.6 Link editor

The link editor's behaviour is unchanged. It is restyled: `.chrome-pop` below the bar (`mt-[9px]`), input `w-48 h-7 rounded-md bg-[var(--color-chrome-track)] px-2 text-[13px] text-white placeholder:text-white/40`, and a clear button as a `ToolButton label="Remove link"`.

---

## 4. Connector bar (**derived, not measured**)

It is built from the same primitives and order logic: content first, colour, kind, line, ends, then overflow.

| Slot | Control (aria-label) | Notes |
|---|---|---|
| 1 | **Text** (`Type`), shortcut `↵` | `setEditingEdgeId(first)` puts the bar into text mode for the connector label (§3.4). This replaces "Add label". |
| 2 | **Color** ◢ | §2, `target='edge'`: circles draw `swatch.stroke`, active by `matchSwatch(...,'edge')`, writes `{ stroke }` |
| sep | | |
| 3 | `Segmented "Line kind"` [**Straight line**, **Elbow line**, **Curved line**] | names unchanged |
| 4 | **Line** ◢ | Popover with two `Segmented` rows: [Solid, Dashed, Dotted] and [Thin line, Regular line, Bold line], 32×28 segments, popover padding 7 (width 110) |
| sep | | |
| 5 | **Start arrowhead** ◢, **End arrowhead** ◢ | Each opens a 4×2 grid of 28 px cells (8 styles) in a 126 px popover, current = purple tile, names unchanged ("Circle", …). The trigger no longer turns purple just for "not none". It shows the current head. |
| 6 | **Reset route** | only when a waypoint exists (unchanged rule) |
| 7 | **More actions** ◢ | `EDGE_OVERFLOW` |

There is no Duplicate (`duplicateSelection` copies nodes) and no Add comment (a thread anchors a node or a point, never an edge).

---

## 5. Theme control

| | |
|---|---|
| Where | A new **account menu** (`src/components/AccountMenu.tsx`). Its trigger is a 28 px circle with the user's initials (`initialsOf` from `src/lib/collab/presence.ts`), `aria-label="Account"`. It sits at the right end of the dashboard header, replacing the name text and the Sign out icon, and at the right end of the canvas `TopBar` after `ExportMenu`. |
| Why | Whimsical keeps appearance under the account menu, which is where people look for app-wide preferences. It is visible on both the dashboard and the board. The existing bottom-bar cycler is an unlabelled icon among the zoom controls. |
| Popover | Radix Popover on **themed** panel tokens (it is app chrome, not selection chrome): `bg-panel ring-1 ring-line shadow-lg rounded-xl p-2 w-60`. Content: name (13 px/600 `text-ink-900`) and email (12 px `text-ink-600`), a divider, an `Appearance` label (11 px/600 uppercase `text-ink-600`), `ThemeSwitch`, a divider, and a **Sign out** row (moved from the dashboard header). |
| `ThemeSwitch` (`src/components/ThemeSwitch.tsx`) | `role="radiogroup" aria-label="Theme"`, three `role="radio"` buttons with `aria-checked`: **System** (`Monitor`), **Light** (`Sun`), **Dark** (`Moon`), each icon 14 px plus label 12 px/500. Track `bg-field rounded-lg p-0.5`, segment `h-7 flex-1 rounded-md`, checked `bg-panel shadow-sm text-ink-900`, unchecked `text-ink-600`. Arrow keys move and select (roving tabindex). It calls `useViewPreferences.setTheme`. |
| States | `system`: no `data-theme` attribute, so the OS is followed live. `light` / `dark`: the attribute is stamped by `applyTheme`. This is existing behaviour, untouched. |
| Bottom bar | `BottomBar` takes `showTheme: boolean`. `Canvas` passes `!topBar`, so the cycler stays only on the public `/s/:token` page, which has no account. The ⌘K `view.toggleTheme` is unchanged. |

---

## 6. Test plan

### 6.1 Unit (Vitest)

| File | Cases |
|---|---|
| `src/lib/palette.test.ts` (rewrite) | 15 entries in the table's order; unique ids; `GRID_COLUMNS === 4`; exact `fill`/`stroke` for all 15 (table-driven from §1.1); `sticky === mix(fill,#FFF,.75)` except White; `DEFAULT_SWATCH` is White `#FFFFFF`/`#CBD5E1`; Gray equals `DEFAULT_EDGE_STROKE`; `swatchFromHex('#12abef')` → `#12ABEF` pair; `matchSwatch` shape / sticky / edge, case-insensitive, `null` for an old-48 pair (`#2C88D9`/`#236DAE`) and for a mixed pair; contrast table (`isDarkFill` white-text set = Slate, Blue, Indigo, Purple, Pink, Green, Brown, Crimson, Red); `isDarkFill` existing cases kept. |
| `src/lib/shapeStyle.test.ts` (extend) | Legacy `'outline'` still gives `{fill:'#FFFFFF', stroke}`; absent and `'filled'` unchanged; `'tinted'` with Blue gives `#D4E7F7` and a solid border; `'dashed'` sets `dashed:true` with the same inside; unknown value gives Fill; `transparent` × each look; tinted with a non-hex fill falls back to white; anchor/text/image ignore `fillStyle` and `transparent`; `resolveFillLook` mapping table. |
| `src/lib/defaultStyle.test.ts` | `pickShapeStyle` keeps `transparent` and the new `fillStyle` values; `sanitizeDefaults` passes them through. |
| `src/lib/text.test.ts` | `FONT_SIZE_PRESETS`; `fontSizeLabel(14)==='M'`, `fontSizeLabel(16)==='16'`; `toConnectorLabelPatch` (number fontSize dropped, names mapped); `textFormatValueOf` defaults (text shape left-aligned). |
| `src/lib/overflowMenu.test.ts` (new) | One shape: no Align submenu, Delete present, chips for Copy are `['⌘','C']` on mac and read from the registry (assert equality with `shortcutChips(registry.find('clipboard.copy').shortcut)`, never a literal); two shapes: Align present with Distribute disabled; three: enabled; `style.paste` dropped while clipboard empty; checked state for Lock and Snap to grid; empty sections dropped; `EDGE_OVERFLOW` for a connector. |
| `src/commands/registry.test.ts` | `shortcutChips` mac/other, multi-binding uses the first. |
| `src/commands/commands.test.ts` | The new commands exist; no keystroke collision (existing test covers it); `comment.addToSelection` false without `startCommentOn` or with 2 nodes; `arrange.match*` gated at 2; `style.copy` captures `fillStyle` and `transparent`. |
| `src/components/toolbar/ColorGrid.test.ts` | `gridMove` for all four arrows, edge clamping, Home/End, count 16. |
| `src/lib/toolbarModel.ts` + `.test.ts` (new) | Pure `shapeBarSlots(summary): Slot[]` used by `FloatingToolbar`. Table-driven over every row of §3.3's selection table, plus `connectorBarSlots` with and without waypoints and `textBarSlots(target, multi)`. |
| `src/store/useDiagramStore.test.ts` | `updateSelectedNodesColour`: rectangle gets the pair, sticky gets `sticky`/`stroke`, image and group untouched, one ⌘Z restores both, `lastStyle` per kind; new sticky default equals Yellow's sticky pair; Fill/Outline/Dash/Transparent via `updateSelectedNodesData` round-trip through undo (existing fillStyle tests extended to `'tinted'`/`'dashed'`). |
| `src/lib/collab/binding.test.ts` | One case: `fillStyle:'dashed', transparent:true` round-trips through the document. |
| `server/collab/render.test.ts` | `defaults.shape.transparent` survives `docToDiagramData`. |

### 6.2 e2e: selectors that must change

| File:line (today) | Old | New |
|---|---|---|
| `diagram.spec.ts:235,255` | `button 'Arrange'` → `'Align top'`, `'Distribute horizontally'`; toggle 'Arrange' to close | `toolbar.getByRole('button',{name:'More actions'})` → `menuitem 'Align'` → `menuitem 'Align top'`; reopen for Distribute; the menu closes itself on run |
| `diagram.spec.ts:260-261` | `toolbar 'Text'` → `dialog 'Text'` → `'Bold'` | `toolbar 'Text'` → `toolbar.getByRole('button',{name:'Bold'})` (multi-selection text mode, no dialog) |
| `diagram.spec.ts:325,334,816` | `button 'Delete'` | `'More actions'` → `menuitem 'Delete'` (816: assert `'More actions'` visible instead) |
| `diagram.spec.ts:817,823` | `button 'Color'` count 0 / visible | unchanged name |
| `diagram.spec.ts:839` | `button 'Shape', exact` | `button 'Change shape', exact`; `dialog 'Shape picker'` unchanged |
| `diagram.spec.ts:873-875` | `'Style'` → `dialog 'Style'` → `'Drop shadow'` | unchanged names |
| `diagram.spec.ts:906,917` | `'Outline'`, `'Filled'` | `'Outline'`, `'Fill'` (exact). Outline on White: border `rgb(203, 213, 225)` and background `rgb(255, 255, 255)` (White tints to white) |
| `diagram.spec.ts:934` | `button 'Underline'` | `button 'More text styles'` → `button 'Underline'` |
| `diagram.spec.ts:2033-2041` | `'blue-3'`; border `rgb(35, 109, 174)`; Style → Save as default | `'Blue'` (exact); border `rgb(41, 135, 215)` and background `rgb(212, 231, 247)`; the trigger toggles shut as before; `'More actions'` → `menuitem 'Save as default style'`; the later assertions use the same two colours |
| `diagram.spec.ts:2068-2091` (tooltip test) | Rewrite: **"the colour name sits above the picker and never covers a swatch"**. Hover `'Mint'` → `.swatch-name` has text `Mint` and its box bottom is ≤ the grid's box top; click `'Blue'` (directly above Mint) → border `rgb(41, 135, 215)` | |
| `diagram.spec.ts:1551,1555` | `'Switch to light theme'`, `'Switch to dark theme'` | `button 'Account'` → `radio 'Light'` / `radio 'Dark'`; assert `aria-checked` and `data-theme`. Add one assertion that `'Switch to light theme'` is still on `/s/:token` |
| `diagram.spec.ts:693,716` | `'End arrowhead'` | unchanged |
| `diagram.spec.ts:705` | `'Curved line'` | unchanged |
| `polish-select.spec.ts:69` | `toolbar 'Shape'` | `toolbar 'Change shape'` |
| `tables.spec.ts:85,114` | `'Add row'`, `'Header row'` | unchanged |
| `connector-polish.spec.ts:93` | toolbar parent opacity | unchanged (keep the wrapper structure) |

### 6.3 e2e: new tests (`e2e/toolbar.spec.ts`)

1. **Bar metrics**: select a rectangle. Toolbar height 40, `border-radius` 10px, `background-color` `oklch(0.33 0.03 248)` in light **and** after `setTheme('dark')`; a button box 30×28; the Color button has `data-popover`.
2. **Picker grid**: open Color. The `group 'Colors'` holds 16 buttons, the popover box is 126×126 (±1), the White cell is `aria-pressed=true` for a new shape, and ArrowRight×4 then Enter applies Blue (keyboard). Escape closes the popover and the shape stays selected.
3. **Custom colour**: `locator('[data-testid=custom-colour-input]').fill('#123456')` gives fill `rgb(18, 52, 86)`, no swatch pressed, and one ⌘Z restores White.
4. **Dash and Transparent**: Dash gives `border-top-style: dashed`; Transparent gives `background-color: rgba(0, 0, 0, 0)` with the border kept and both Outline and Transparent lit; clicking Fill then turns Transparent off (button unlit, solid background back); turning Transparent on from Fill lights Outline.
5. **Sticky colour**: a sticky picks Blue and gets `rgb(202, 225, 245)` (`#CAE1F5`).
6. **Text swaps the bar**: Text on one shape focuses the label, `button 'Finish editing'` is visible and `'Change shape'` is not; type, press Finish, and the label is committed and the bar is back in shape mode. Text size → `L` gives font-size 18px.
7. **Overflow from the registry**: `'More actions'`. The `menuitem 'Copy'` shows chip text matching `formatShortcut` for `clipboard.copy`; Lock toggles `aria-checked`.
8. **Connector bar**: a connector shows Text, Color, three kinds, Line, both arrowheads, More actions. The picker active cell is Gray for a default connector.
9. **Old diagram renders unchanged**: import via the API a diagram with old-48 colours and `fillStyle:'outline'` (`#236DAE` stroke). Its border is `rgb(35, 109, 174)` and background white, and the picker shows no pressed swatch.

Visual check before merge: screenshots of shape / multi / table / wire / ink / frame / connector / text-mode bars in both themes beside Whimsical's, attached to PR 2.

---

## 7. PR split

### PR 1: palette, picker, looks, theme control (`feat/palette-picker`)

1. `index.css`: chrome tokens + `.chrome-*` classes (the picker uses them).
2. `types.ts`: `FillStyle` values, `ShapeData.transparent`, `SwatchColor.name/sticky`.
3. `palette.ts` rewrite. `shapeStyle.ts` (`resolveFillLook`, `ShapePaint.dashed`, tint, transparent). `ShapeNode.tsx` dashed border and dasharray.
4. `defaultStyle.ts` key. `diagramMigrations.ts` header note. `useDiagramStore.ts` `updateSelectedNodesColour` and sticky defaults.
5. `toolbar/chrome.tsx` (only `ChromePopover` and `ToolButton` needed here), `toolbar/ColorGrid.tsx`, `toolbar/ColorPicker.tsx`. Delete `ColorPalette.tsx`.
6. `FloatingToolbar.tsx`: swap the picker in. Replace the Filled/Outline pair with Fill/Outline/Dash + Transparent (existing button styling is fine until PR 2).
7. `TextFormatControls.tsx`: text colour uses `ColorGrid` + Auto.
8. `commands.ts`: `style.copy` → `pickShapeStyle`, `style.paste` `when`.
9. `AccountMenu.tsx`, `ThemeSwitch.tsx`, dashboard header, `TopBar`, `BottomBar showTheme`.
10. Tests: §6.1 rows for palette, shapeStyle, defaultStyle, ColorGrid, store, binding, render, commands (style.*); §6.2 rows for colour, Outline/Fill, theme; §6.3 tests 2–5 and 9.
11. Docs: CLAUDE.md bullets (fillStyle/shapeStyle, palette/theming, default style), CHANGELOG.

### PR 2: toolbar, text bar, overflow (`feat/selection-toolbar`)

1. `npm install --legacy-peer-deps @radix-ui/react-dropdown-menu`.
2. `commands/types.ts` `checked`; `registry.ts` `shortcutChips`; new commands `arrange.match*`, `comment.addToSelection`; `CommandContext.ui.startCommentOn`; `Canvas` supplies it and passes `ctx` and `onRunCommand` to `FloatingToolbar`.
3. `src/lib/overflowMenu.ts`, `src/lib/toolbarModel.ts`, `text.ts` additions (`FONT_SIZE_PRESETS`, `fontSizeLabel`, `toConnectorLabelPatch`, `textFormatValueOf`).
4. Split `FloatingToolbar.tsx` into `toolbar/ShapeBar.tsx`, `toolbar/ConnectorBar.tsx`, `toolbar/TextBar.tsx` (shell + `TextFormatControls`), `toolbar/OverflowMenu.tsx`, `toolbar/StylePopover.tsx`, `toolbar/ShapePicker.tsx`, `toolbar/LinePopover.tsx`, `toolbar/ArrowStylePicker.tsx`. `FloatingToolbar.tsx` keeps selection derivation, anchor/positioning and mode.
5. Delete `TextFormatBar.tsx` and `ArrangeMenu.tsx`. `Canvas.tsx` stops mounting `TextFormatBar`.
6. Restyle `FilterSelectionMenu` trigger and the link editor.
7. Tests: the remaining §6.1 and §6.2 rows, §6.3 tests 1, 6, 7, 8, and the screenshot set.
8. Docs: CLAUDE.md FloatingToolbar / TextFormatControls / command-registry bullets (overflow is now a fifth generated surface), CHANGELOG.

`npm run check` and the full `npm run test:e2e` must pass on each PR.

---

## 8. Open questions for the product owner

1. ~~Transparent semantics~~: settled live, see D3 and the `transparent` paragraph (a toggle; Fill clears it; turning it on from Fill moves to Outline).
2. **Delete leaves the bar.** Whimsical's shape bar has no trash button, so Delete moves into the overflow menu (⌫ still works). Say if you want a visible Delete kept at the end of the bar.
