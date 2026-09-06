import type { Command, CommandContext, KeyEventLike, Keybinding, Platform } from './types';

/**
 * Physical keys whose `KeyboardEvent.code` we can turn back into the character
 * the binding is written with. Needed because ⌥ (and non-US layouts) rewrite
 * `event.key`: ⌥C arrives as "ç", ⌥= as "≠".
 */
const CODE_TO_KEY: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Backquote: '`',
  Space: ' ',
  NumpadAdd: '+',
  NumpadSubtract: '-',
};

function keyFromCode(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  return CODE_TO_KEY[code];
}

/** Every spelling of the pressed key a binding is allowed to match. */
function keyCandidates(event: KeyEventLike): Set<string> {
  const out = new Set<string>();
  if (event.key) {
    out.add(event.key);
    out.add(event.key.toLowerCase());
  }
  if (event.code) {
    out.add(event.code);
    const derived = keyFromCode(event.code);
    if (derived) out.add(derived);
  }
  return out;
}

/** ⌘ on a Mac, Ctrl everywhere else — one binding, both platforms. */
function metaHeld(event: KeyEventLike): boolean {
  return !!event.metaKey || !!event.ctrlKey;
}

function bindingMatches(binding: Keybinding, event: KeyEventLike): boolean {
  if (!!binding.meta !== metaHeld(event)) return false;
  if (!!binding.shift !== !!event.shiftKey) return false;
  if (!!binding.alt !== !!event.altKey) return false;
  const candidates = keyCandidates(event);
  return candidates.has(binding.key) || candidates.has(binding.key.toLowerCase());
}

/** A command's bindings as a list, whether it declared one, several, or none. */
export function bindingsOf(command: { shortcut?: Keybinding | Keybinding[] }): Keybinding[] {
  if (!command.shortcut) return [];
  return Array.isArray(command.shortcut) ? command.shortcut : [command.shortcut];
}

const MAC_MODIFIERS: [keyof Keybinding, string][] = [
  ['meta', '⌘'],
  ['shift', '⇧'],
  ['alt', '⌥'],
];

const OTHER_MODIFIERS: [keyof Keybinding, string][] = [
  ['meta', 'Ctrl'],
  ['shift', 'Shift'],
  ['alt', 'Alt'],
];

const MAC_KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
  Delete: '⌦',
  Enter: '↩',
  Escape: 'Esc',
  Tab: '⇥',
};

const OTHER_KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
};

function keyLabel(key: string, platform: Platform): string {
  const labels = platform === 'mac' ? MAC_KEY_LABELS : OTHER_KEY_LABELS;
  if (labels[key]) return labels[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

/** True when the app is running on a Mac, so ⌘ is the right glyph to draw. */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const source = navigator.userAgent ?? '';
  return /Mac|iPhone|iPad|iPod/.test(source) ? 'mac' : 'other';
}

/**
 * Renders a binding the way the platform writes it: `⌘⇧Z` on a Mac,
 * `Ctrl+Shift+Z` elsewhere. Given a list, the first binding is the one shown.
 */
export function formatShortcut(
  binding: Keybinding | Keybinding[] | undefined,
  platform: Platform = detectPlatform(),
): string {
  const one = Array.isArray(binding) ? binding[0] : binding;
  if (!one) return '';
  const modifiers = platform === 'mac' ? MAC_MODIFIERS : OTHER_MODIFIERS;
  const parts = modifiers.filter(([flag]) => one[flag]).map(([, glyph]) => glyph);
  parts.push(keyLabel(one.key, platform));
  return platform === 'mac' ? parts.join('') : parts.join('+');
}

/**
 * How a command is spelled out in the UI. Aliases for the same keystroke are
 * shown together (`S` / `N`), but a binding that only adds a modifier — the ⌘
 * twin of a bare key — is left to the README rather than crowding the row.
 */
export function shortcutLabels(
  shortcut: Keybinding | Keybinding[] | undefined,
  platform: Platform = detectPlatform(),
): string[] {
  const bindings = bindingsOf({ shortcut });
  const [first] = bindings;
  if (!first) return [];
  const aliases = bindings.filter(
    (binding) =>
      !!binding.meta === !!first.meta &&
      !!binding.shift === !!first.shift &&
      !!binding.alt === !!first.alt,
  );
  return [...new Set(aliases.map((binding) => formatShortcut(binding, platform)))];
}

export interface Registry<Ctx = CommandContext> {
  all: () => Command<Ctx>[];
  find: (id: string) => Command<Ctx> | undefined;
  /** The first command whose binding matches and whose `when` passes, if any. */
  matchEvent: (event: KeyEventLike, ctx: Ctx) => Command<Ctx> | undefined;
  formatShortcut: (binding: Keybinding | Keybinding[] | undefined, platform?: Platform) => string;
}

export function createRegistry<Ctx = CommandContext>(commands: Command<Ctx>[]): Registry<Ctx> {
  const byId = new Map(commands.map((command) => [command.id, command]));

  return {
    all: () => commands,
    find: (id) => byId.get(id),
    matchEvent: (event, ctx) =>
      commands.find(
        (command) =>
          bindingsOf(command).some((binding) => bindingMatches(binding, event)) &&
          (!command.when || command.when(ctx)),
      ),
    formatShortcut,
  };
}
