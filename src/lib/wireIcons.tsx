import type { ComponentType } from 'react';
import {
  AppWindow,
  ChevronDown,
  CircleUser,
  Heading,
  Image as ImageIcon,
  LayoutPanelTop,
  Link,
  Minus,
  Pilcrow,
  RectangleHorizontal,
  Smartphone,
  SquareCheck,
  TextCursorInput,
  ToggleLeft,
} from 'lucide-react';
import type { WireComponent } from './wireframe';

/**
 * One icon per wireframe component, shared by the rail's picker and by the
 * floating toolbar's "Filter selection" — the same rule `shapeIcons.tsx` keeps,
 * so a component cannot wear two faces.
 *
 * Kept out of `wireframe.ts` because that module is pure, React-free and
 * compiled by the server (it is reached from `src/types.ts` — see the
 * `nodenext` note in CLAUDE.md); JSX has no business in it.
 */
export type WireIcon = ComponentType<{ size?: number }>;

export const WIRE_ICONS: Record<WireComponent, WireIcon> = {
  browser: AppWindow,
  phone: Smartphone,
  card: LayoutPanelTop,
  button: RectangleHorizontal,
  input: TextCursorInput,
  heading: Heading,
  paragraph: Pilcrow,
  image: ImageIcon,
  avatar: CircleUser,
  checkbox: SquareCheck,
  toggle: ToggleLeft,
  dropdown: ChevronDown,
  divider: Minus,
  link: Link,
};
