import { describe, expect, it } from 'vitest';
import {
  WIRE_COMPONENTS,
  WIRE_DEFAULTS,
  WIRE_FILL,
  WIRE_LABELS,
  WIRE_TINT_STROKE,
  defaultSizeOf,
  hasLabel,
  hasWireLabel,
  labelPlaceholder,
  minSizeOf,
  wireComponentOf,
  wireFlag,
  wireTint,
  type WireComponent,
} from './wireframe';

describe('the component list', () => {
  it('names every component exactly once, and gives each a label, a size and a placeholder', () => {
    expect(new Set(WIRE_COMPONENTS).size).toBe(WIRE_COMPONENTS.length);
    expect(WIRE_COMPONENTS).toHaveLength(14);
    for (const component of WIRE_COMPONENTS) {
      expect(WIRE_LABELS[component], component).toBeTruthy();
      expect(WIRE_DEFAULTS[component], component).toBeDefined();
      // `labelPlaceholder` answers for every component; the empty string is the
      // answer for the ones with nothing to say, which is what `hasLabel` reads.
      expect(typeof labelPlaceholder(component), component).toBe('string');
    }
  });

  it('has the tables keyed by exactly the components on the list', () => {
    expect(Object.keys(WIRE_DEFAULTS).sort()).toEqual([...WIRE_COMPONENTS].sort());
    expect(Object.keys(WIRE_LABELS).sort()).toEqual([...WIRE_COMPONENTS].sort());
  });
});

describe('defaultSizeOf / minSizeOf', () => {
  it('gives each component a box, and a minimum no bigger than it', () => {
    for (const component of WIRE_COMPONENTS) {
      const { width, height } = defaultSizeOf(component);
      const { minWidth, minHeight } = minSizeOf(component);
      expect(width, component).toBeGreaterThan(0);
      expect(height, component).toBeGreaterThan(0);
      expect(minWidth, component).toBeLessThanOrEqual(width);
      expect(minHeight, component).toBeLessThanOrEqual(height);
    }
  });

  it('drops a browser at a landscape box and a phone at a portrait one', () => {
    const browser = defaultSizeOf('browser');
    const phone = defaultSizeOf('phone');
    expect(browser.width).toBeGreaterThan(browser.height);
    expect(phone.height).toBeGreaterThan(phone.width);
  });

  it('keeps a divider grabbable: its minimum height is more than a hairline', () => {
    expect(minSizeOf('divider').minHeight).toBeGreaterThanOrEqual(8);
  });
});

describe('hasLabel / labelPlaceholder', () => {
  it('gives words to the components that say something', () => {
    expect(labelPlaceholder('button')).toBe('Button');
    expect(labelPlaceholder('input')).toBe('Placeholder');
    expect(labelPlaceholder('heading')).toBe('Heading');
    expect(labelPlaceholder('link')).toBe('Link');
    for (const component of ['button', 'input', 'heading', 'paragraph', 'link', 'checkbox', 'toggle', 'dropdown'] as WireComponent[]) {
      expect(hasLabel(component), component).toBe(true);
    }
  });

  it('gives none to the frames and the placeholders', () => {
    for (const component of ['browser', 'phone', 'card', 'image', 'avatar', 'divider'] as WireComponent[]) {
      expect(hasLabel(component), component).toBe(false);
      expect(labelPlaceholder(component), component).toBe('');
    }
  });
});

describe('wireTint', () => {
  it('mixes a picked colour into the palette entry the part would have worn', () => {
    expect(wireTint('#FF0000', WIRE_FILL)).toBe('color-mix(in srgb, #FF0000 30%, #EAEFF4)');
    expect(wireTint('#FF0000', WIRE_FILL, WIRE_TINT_STROKE)).toBe('color-mix(in srgb, #FF0000 40%, #EAEFF4)');
  });

  it('is the identity in effect for a component nobody has coloured', () => {
    // The base is the colour a fresh wire node stores, so the mix is that
    // colour with itself — which is why the renderer needs no untinted branch.
    expect(wireTint(WIRE_FILL, WIRE_FILL)).toBe('color-mix(in srgb, #EAEFF4 30%, #EAEFF4)');
  });
});

describe('wireComponentOf', () => {
  it('reads the component out of a wire node’s data', () => {
    expect(wireComponentOf({ wire: { component: 'button' } })).toBe('button');
  });

  it('answers null for anything a free-form JSON column could hold instead', () => {
    expect(wireComponentOf(undefined)).toBeNull();
    expect(wireComponentOf(null)).toBeNull();
    expect(wireComponentOf({})).toBeNull();
    expect(wireComponentOf({ wire: 'button' })).toBeNull();
    expect(wireComponentOf({ wire: null })).toBeNull();
    expect(wireComponentOf({ wire: { component: 42 } })).toBeNull();
    // A component from a newer build. Drawing nothing is the right answer.
    expect(wireComponentOf({ wire: { component: 'hologram' } })).toBeNull();
  });
});

describe('hasWireLabel', () => {
  it('is true only for a wire node naming a component with words', () => {
    expect(hasWireLabel({ wire: { component: 'button' } })).toBe(true);
    expect(hasWireLabel({ wire: { component: 'divider' } })).toBe(false);
    expect(hasWireLabel({})).toBe(false);
  });
});

describe('wireFlag', () => {
  it('reads a component’s own boolean knob, and nothing it cannot trust', () => {
    expect(wireFlag({ wire: { component: 'toggle', props: { checked: true } } }, 'checked')).toBe(true);
    expect(wireFlag({ wire: { component: 'toggle', props: { checked: 'yes' } } }, 'checked')).toBe(false);
    expect(wireFlag({ wire: { component: 'toggle' } }, 'checked')).toBe(false);
    expect(wireFlag({ wire: { component: 'toggle', props: null } }, 'checked')).toBe(false);
    expect(wireFlag(undefined, 'checked')).toBe(false);
  });
});
