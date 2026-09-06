import type { ClipboardPayload, useDiagramStore } from '../store/useDiagramStore';
import type { ShapeData } from '../types';

/**
 * One keystroke. `key` is matched against `KeyboardEvent.key` and, when a
 * layout mangles it (macOS turns ⌥C into "ç"), against the key the physical
 * `KeyboardEvent.code` stands for — so "c", "ArrowUp", "=", "]" and " " are
 * all valid spellings.
 *
 * `meta` covers ⌘ and Ctrl together: one binding serves both platforms.
 */
export interface Keybinding {
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type CommandGroup =
  | 'tools'
  | 'edit'
  | 'select'
  | 'arrange'
  | 'clipboard'
  | 'style'
  | 'view'
  | 'history';

/** Which right-click menu a command belongs on. `any` means all three. */
export type ContextMenuTarget = 'node' | 'edge' | 'pane' | 'any';

export interface Command<Ctx = CommandContext> {
  id: string;
  title: string;
  group: CommandGroup;
  shortcut?: Keybinding | Keybinding[];
  /** Gate on the current state. A command whose `when` is false never matches and is never offered. */
  when?: (ctx: Ctx) => boolean;
  run: (ctx: Ctx) => void;
  /** Kept out of the shortcut cheat sheet. */
  hidden?: boolean;
  /** Offered on these right-click menus; a list when a command belongs on more than one. */
  contextMenu?: ContextMenuTarget | ContextMenuTarget[];
}

/** The fields the registry reads off a keyboard event — a real `KeyboardEvent` satisfies it. */
export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type Platform = 'mac' | 'other';

export type DiagramState = ReturnType<typeof useDiagramStore.getState>;

/** The slice of the Zustand store commands are allowed to touch. */
export interface StoreAccess {
  getState: () => DiagramState;
  setState: (partial: Partial<DiagramState>) => void;
}

/** The React Flow viewport helpers, as `useReactFlow()` hands them over. */
export interface ViewportAccess {
  zoomIn: (options?: { duration?: number }) => void;
  zoomOut: (options?: { duration?: number }) => void;
  zoomTo: (zoom: number, options?: { duration?: number }) => void;
  fitView: (options?: { nodes?: { id: string }[]; padding?: number; duration?: number }) => void;
}

/** A mutable cell — the copy/paste clipboards live outside the store. */
export interface Holder<T> {
  get: () => T;
  set: (value: T) => void;
}

export interface CommandContext {
  store: StoreAccess;
  view: ViewportAccess;
  /** What ⌘C captured; `null` until something has been copied. */
  clipboard: Holder<ClipboardPayload | null>;
  /** What ⌘⌥C captured. */
  styleClipboard: Holder<Partial<ShapeData> | null>;
  /** Hold-to-pan: `begin` remembers the current tool, `end` restores it. */
  pan: { begin: () => void; end: () => void };
  ui: { openShortcuts: () => void };
}
