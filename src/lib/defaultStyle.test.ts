import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STYLE_KINDS,
  kindOf,
  pickConnectorStyle,
  pickShapeStyle,
  resolveDefaultStyle,
  sanitizeDefaults,
  withDefault,
  type BoardDefaults,
} from './defaultStyle';

describe('pickShapeStyle', () => {
  it('keeps the fill, the outline and the whole of the typography', () => {
    expect(
      pickShapeStyle({
        fill: '#FF0000',
        stroke: '#880000',
        fillStyle: 'outline',
        fontSize: 22,
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        textColor: '#FFFFFF',
        textAlign: 'right',
        verticalAlign: 'top',
        cornerRadius: 8,
        opacity: 0.5,
        shadow: true,
      }),
    ).toEqual({
      fill: '#FF0000',
      stroke: '#880000',
      fillStyle: 'outline',
      fontSize: 22,
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      textColor: '#FFFFFF',
      textAlign: 'right',
      verticalAlign: 'top',
      cornerRadius: 8,
      opacity: 0.5,
      shadow: true,
    });
  });

  it('lets nothing but style through', () => {
    // The list that matters: a default carrying any of these would stamp
    // somebody's words, link, lock or picture onto every shape drawn after it.
    const style = pickShapeStyle({
      fill: '#FF0000',
      label: 'Do not copy me',
      shape: 'sticky',
      link: 'https://example.com',
      locked: true,
      imageSrc: '/api/images/abc',
      uploading: true,
      width: 900,
      height: 900,
      position: { x: 1, y: 2 },
      id: 'nope',
    });
    expect(style).toEqual({ fill: '#FF0000' });
  });

  it('drops keys that are absent or explicitly undefined', () => {
    expect(pickShapeStyle({ fill: '#FF0000', stroke: undefined })).toEqual({ fill: '#FF0000' });
  });
});

describe('pickConnectorStyle', () => {
  it('keeps the line, both arrowheads and the routing kind', () => {
    expect(
      pickConnectorStyle({
        connectorType: 'curved',
        stroke: '#123456',
        strokeStyle: 'dashed',
        strokeWidth: 3,
        startArrowStyle: 'circle',
        endArrowStyle: 'diamond',
      }),
    ).toEqual({
      connectorType: 'curved',
      stroke: '#123456',
      strokeStyle: 'dashed',
      strokeWidth: 3,
      startArrowStyle: 'circle',
      endArrowStyle: 'diamond',
    });
  });

  it('keeps neither the label nor the route: both belong to one connector', () => {
    expect(
      pickConnectorStyle({
        stroke: '#123456',
        label: 'yes',
        labelBold: true,
        labelT: 0.3,
        waypoints: [{ x: 1, y: 2 }],
        sourceAnchor: { side: 'right', t: 0.5 },
        targetAnchor: { side: 'left', t: 0.5 },
      }),
    ).toEqual({ stroke: '#123456' });
  });
});

describe('kindOf', () => {
  it('tells the three styleable node kinds apart', () => {
    expect(kindOf({ type: 'shape', data: { shape: 'rectangle' } })).toBe('shape');
    expect(kindOf({ type: 'shape', data: { shape: 'star' } })).toBe('shape');
    expect(kindOf({ type: 'shape', data: { shape: 'sticky' } })).toBe('sticky');
    expect(kindOf({ type: 'shape', data: { shape: 'text' } })).toBe('text');
  });

  it('has no answer for a container or an image', () => {
    // `type` is what tells a container apart, never the data it carries.
    expect(kindOf({ type: 'group', data: { shape: 'rectangle' } })).toBeNull();
    expect(kindOf({ type: 'frame', data: { shape: 'rectangle' } })).toBeNull();
    expect(kindOf({ type: 'shape', data: { shape: 'image' } })).toBeNull();
  });
});

describe('sanitizeDefaults', () => {
  it('narrows every kind to its own whitelist', () => {
    expect(
      sanitizeDefaults({
        shape: { fill: '#FF0000', label: 'no', locked: true },
        sticky: { fill: '#FBF3D0', imageSrc: '/api/images/abc' },
        text: { fontSize: 30, link: 'https://example.com' },
        connector: { stroke: '#123456', waypoints: [{ x: 1, y: 2 }] },
      }),
    ).toEqual({
      shape: { fill: '#FF0000' },
      sticky: { fill: '#FBF3D0' },
      text: { fontSize: 30 },
      connector: { stroke: '#123456' },
    });
  });

  it('drops a kind that has nothing left, and the whole thing when none has', () => {
    expect(sanitizeDefaults({ shape: { fill: '#FF0000' }, text: { label: 'no' } })).toEqual({
      shape: { fill: '#FF0000' },
    });
    expect(sanitizeDefaults({ shape: { label: 'no' } })).toBeUndefined();
  });

  it('answers undefined for anything that is not a defaults object', () => {
    // The column is free-form JSON and the document is written by other
    // browsers: none of these may become something the canvas acts on.
    for (const raw of [undefined, null, 42, 'defaults', [], { shape: 'red' }, { nope: { fill: '#f00' } }]) {
      expect(sanitizeDefaults(raw)).toBeUndefined();
    }
  });

  it('ignores a kind this build does not know', () => {
    expect(sanitizeDefaults({ shape: { fill: '#FF0000' }, frame: { fill: '#00FF00' } })).toEqual({
      shape: { fill: '#FF0000' },
    });
  });
});

describe('resolveDefaultStyle', () => {
  const board: BoardDefaults = { shape: { fill: '#FF0000', stroke: '#880000' } };

  it('is the board default when the session has nothing to say', () => {
    expect(resolveDefaultStyle(board, {}, 'shape')).toEqual({ fill: '#FF0000', stroke: '#880000' });
  });

  it('puts the session layer on top, key by key', () => {
    expect(resolveDefaultStyle(board, { shape: { fill: '#00FF00' } }, 'shape')).toEqual({
      fill: '#00FF00',
      stroke: '#880000',
    });
  });

  it('is empty for a kind neither layer knows about', () => {
    expect(resolveDefaultStyle(board, {}, 'connector')).toEqual({});
    expect(resolveDefaultStyle(undefined, undefined, 'sticky')).toEqual({});
  });
});

describe('withDefault', () => {
  it('sets one kind and leaves the others alone', () => {
    expect(withDefault({ shape: { fill: '#FF0000' } }, 'sticky', { fill: '#FBF3D0' })).toEqual({
      shape: { fill: '#FF0000' },
      sticky: { fill: '#FBF3D0' },
    });
  });

  it('removes a kind set to nothing, and answers undefined when none is left', () => {
    expect(withDefault({ shape: { fill: '#FF0000' }, text: { bold: true } }, 'text', undefined)).toEqual({
      shape: { fill: '#FF0000' },
    });
    expect(withDefault({ shape: { fill: '#FF0000' } }, 'shape', {})).toBeUndefined();
    expect(withDefault(undefined, 'shape', undefined)).toBeUndefined();
  });
});

describe('DEFAULT_STYLE_KINDS', () => {
  it('is what sanitize walks, so a new kind cannot be added to one and not the other', () => {
    const all = Object.fromEntries(
      DEFAULT_STYLE_KINDS.map((kind) => [kind, kind === 'connector' ? { stroke: '#123456' } : { fill: '#FF0000' }]),
    );
    expect(Object.keys(sanitizeDefaults(all) ?? {})).toEqual([...DEFAULT_STYLE_KINDS]);
  });
});
