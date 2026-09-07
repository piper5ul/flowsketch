/**
 * Wireframe components — the structural half, pure and free of React.
 *
 * **There is one node type, `wire`, and fourteen components inside it.** A
 * button, a browser chrome and a toggle differ in what they *draw*, not in what
 * they are: each is a box on the board with a label, so fourteen React Flow
 * node types would be fourteen copies of the same resizer, the same handles and
 * the same label editor. `data.wire.component` says which one, `WireNode.tsx`
 * switches on it, and `type: 'wire'` is what tells a wireframe component from a
 * shape — never the data, for the reason every other node type is read that way
 * (see `nodeKinds.ts`): a wire node carries an ordinary `ShapeData` whose
 * `shape` is a rectangle nothing draws.
 *
 * **The palette is fixed on purpose.** Whimsical's note on its own wireframes —
 * "wireframe components use toned down, more transparent colors by design…
 * this helps keep wireframes semantic" — is the whole rule here: a wireframe
 * reads as layout, not as design, so a component is drawn in the greys below
 * rather than in whatever fill the board's default style happens to carry. A
 * colour the user picks is folded in at `WIRE_TINT`, which is why `wireTint`
 * takes the palette entry as its base: a component nobody has coloured is born
 * carrying that exact colour, and mixing a colour with itself is the identity —
 * so there is no "has this been tinted?" flag anywhere, and no branch for it.
 *
 * This module deliberately imports nothing. `src/types.ts` reads `WireComponent`
 * and `WireData` out of it, and that file is compiled by the server too — see
 * the `nodenext` note on `diagramMigrations.ts` in CLAUDE.md.
 */

/**
 * The fourteen components. Three of them — `browser`, `phone`, `card` — are
 * *frames* other components are laid inside, but they are **not containers** in
 * this build: nothing hangs off them through `parentId`, so dragging a browser
 * leaves the buttons drawn on it where they are. Making them real containers is
 * a follow-up; it means the frame machinery in `nodeTree.ts`, not a new field.
 */
export type WireComponent =
  | 'browser'
  | 'phone'
  | 'card'
  | 'button'
  | 'input'
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'avatar'
  | 'checkbox'
  | 'toggle'
  | 'dropdown'
  | 'divider'
  | 'link';

/**
 * What a `wire` node carries, and nothing else does.
 *
 * `props` is the component's own state where it has any — a checkbox's and a
 * toggle's `checked`, today. It is deliberately a loose bag rather than a union
 * per component: it comes out of a free-form JSON column and out of a document
 * another browser wrote, so every reader has to narrow it anyway, and a
 * component that grows a second knob does not cost a format change.
 */
export interface WireData {
  component: WireComponent;
  props?: Record<string, string | boolean | number>;
}

/** Every component, in the order the rail's picker lays them out. */
export const WIRE_COMPONENTS: WireComponent[] = [
  'browser',
  'phone',
  'card',
  'button',
  'input',
  'dropdown',
  'checkbox',
  'toggle',
  'heading',
  'paragraph',
  'link',
  'image',
  'avatar',
  'divider',
];

const COMPONENT_SET = new Set<string>(WIRE_COMPONENTS);

export const WIRE_LABELS: Record<WireComponent, string> = {
  browser: 'Browser',
  phone: 'Phone',
  card: 'Card',
  button: 'Button',
  input: 'Input',
  heading: 'Heading',
  paragraph: 'Paragraph',
  image: 'Image',
  avatar: 'Avatar',
  checkbox: 'Checkbox',
  toggle: 'Toggle',
  dropdown: 'Dropdown',
  divider: 'Divider',
  link: 'Link',
};

// ---- the palette ---------------------------------------------------------
//
// Hard-coded rather than themed: a wireframe is a drawing, and a drawing looks
// the same in both themes for the reason every shape's fill does (see the
// theming bullet in CLAUDE.md). These are also the exact values an export
// captures, since an export pins the light theme.

/** Every outline, and every rule inside a component. */
export const WIRE_STROKE = '#9EADBA';
/** The ground a filled part sits on — a button's body, an input's well. */
export const WIRE_FILL = '#EAEFF4';
/** The paler ground a *frame* sits on, so a button on a card still reads. */
export const WIRE_FILL_SOFT = '#F7F9FA';
/** Label and placeholder text. */
export const WIRE_TEXT = '#4B5C6B';
/** How thick every line in a wireframe is drawn, in px. */
export const WIRE_LINE_PX = 1.5;
/** How far every corner is rounded, in px. */
export const WIRE_RADIUS_PX = 4;

/**
 * How much of a user-picked colour survives into a component's fill, and into
 * its outline. Both are low by design: the point of the fixed palette is that a
 * wireframe reads as layout, and a fully saturated button would be a mockup.
 */
export const WIRE_TINT = 0.3;
export const WIRE_TINT_STROKE = 0.4;

/**
 * A colour mixed into one of the palette entries above, as CSS.
 *
 * The base is always the palette entry the part would have worn anyway, which
 * is what makes an untinted component free: a wire node is created carrying
 * `WIRE_FILL` in its `data.fill`, and `color-mix` of a colour with itself is
 * that colour. So the renderer mixes unconditionally and there is no flag
 * saying whether the user has picked anything.
 */
export function wireTint(colour: string, base: string, amount = WIRE_TINT): string {
  return `color-mix(in srgb, ${colour} ${Math.round(amount * 100)}%, ${base})`;
}

// ---- geometry ------------------------------------------------------------

export interface WireGeometry {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/**
 * The size each component is dropped at, and the size below which it stops
 * being drawable — a 20 px browser chrome is a grey smudge, and a divider
 * thinner than its own grab strip cannot be picked up at all.
 */
export const WIRE_DEFAULTS: Record<WireComponent, WireGeometry> = {
  browser: { width: 480, height: 320, minWidth: 220, minHeight: 140 },
  phone: { width: 220, height: 420, minWidth: 120, minHeight: 220 },
  card: { width: 240, height: 180, minWidth: 120, minHeight: 100 },
  button: { width: 120, height: 36, minWidth: 56, minHeight: 24 },
  input: { width: 220, height: 36, minWidth: 80, minHeight: 24 },
  heading: { width: 240, height: 40, minWidth: 80, minHeight: 24 },
  paragraph: { width: 260, height: 76, minWidth: 80, minHeight: 32 },
  image: { width: 200, height: 140, minWidth: 40, minHeight: 40 },
  avatar: { width: 48, height: 48, minWidth: 24, minHeight: 24 },
  checkbox: { width: 160, height: 24, minWidth: 60, minHeight: 18 },
  toggle: { width: 160, height: 24, minWidth: 68, minHeight: 18 },
  dropdown: { width: 220, height: 36, minWidth: 90, minHeight: 24 },
  divider: { width: 240, height: 12, minWidth: 40, minHeight: 8 },
  link: { width: 100, height: 24, minWidth: 40, minHeight: 16 },
};

/** The box a freshly placed component gets. */
export function defaultSizeOf(component: WireComponent): { width: number; height: number } {
  const { width, height } = WIRE_DEFAULTS[component];
  return { width, height };
}

/** What the resizer will not drag this component below. */
export function minSizeOf(component: WireComponent): { minWidth: number; minHeight: number } {
  const { minWidth, minHeight } = WIRE_DEFAULTS[component];
  return { minWidth, minHeight };
}

/**
 * The words a component is born with — a button that says "Button" is a button,
 * where an empty one is a grey box. Empty for the components with no label at
 * all, which is what `hasLabel` reads.
 */
const LABEL_PLACEHOLDERS: Record<WireComponent, string> = {
  browser: '',
  phone: '',
  card: '',
  image: '',
  avatar: '',
  divider: '',
  button: 'Button',
  input: 'Placeholder',
  heading: 'Heading',
  paragraph: 'Body text goes here.',
  checkbox: 'Checkbox',
  toggle: 'Toggle',
  dropdown: 'Select…',
  link: 'Link',
};

export function labelPlaceholder(component: WireComponent): string {
  return LABEL_PLACEHOLDERS[component];
}

/**
 * Which components say something.
 *
 * A component's words are `data.label`, the same field every shape's label
 * lives in — which is what makes canvas search, the typography controls, the
 * export and the collaborative document work on a wireframe with no special
 * case. The frames and the placeholders have none: a browser chrome is chrome,
 * and an avatar is a face nobody has drawn yet.
 */
export function hasLabel(component: WireComponent): boolean {
  return LABEL_PLACEHOLDERS[component] !== '';
}

/**
 * The component a node's data names, or `null` when it names none.
 *
 * `Diagram.data` is free-form JSON and the document is written by other
 * browsers, so a node typed `wire` carrying nothing, a string, or the name of a
 * component this build has never heard of is all possible — and drawing nothing
 * is the right answer to each, the way `InkNode` answers a stroke with no
 * points.
 */
export function wireComponentOf(data: { wire?: unknown } | null | undefined): WireComponent | null {
  const wire = data?.wire;
  if (typeof wire !== 'object' || wire === null) return null;
  const component = (wire as { component?: unknown }).component;
  return typeof component === 'string' && COMPONENT_SET.has(component)
    ? (component as WireComponent)
    : null;
}

/**
 * True when a node's data names a component that carries words — what the
 * floating toolbar asks before offering the typography controls, since a
 * browser chrome and a divider have nothing to typeset.
 */
export function hasWireLabel(data: { wire?: unknown } | null | undefined): boolean {
  const component = wireComponentOf(data);
  return component !== null && hasLabel(component);
}

/** One of a component's own knobs, as a boolean — see `WireData.props`. */
export function wireFlag(data: { wire?: unknown } | null | undefined, key: string): boolean {
  const wire = data?.wire;
  if (typeof wire !== 'object' || wire === null) return false;
  const props = (wire as { props?: unknown }).props;
  if (typeof props !== 'object' || props === null) return false;
  return (props as Record<string, unknown>)[key] === true;
}
