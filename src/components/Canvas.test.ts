// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from './Canvas';
import { registry } from '../commands/commands';
import type { CommandContext } from '../commands/types';
import { useDiagramStore, type ClipboardPayload } from '../store/useDiagramStore';
import { usePresentStore } from '../store/usePresentStore';
import { decodeClipboardPayload, encodeClipboardPayload } from '../lib/clipboardPayload';

const surface = vi.hoisted(() => ({ ctx: null as CommandContext | null, insertImages: vi.fn() }));
vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@xyflow/react')>();
  const view = {
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    addEdges: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(), fitView: vi.fn(),
  };
  return { ...original, ReactFlow: () => null, useReactFlow: () => view, useConnection: () => ({ inProgress: false }) };
});
vi.mock('../lib/useImageInsert', () => ({ useImageInsert: () => surface.insertImages }));
vi.mock('./TopBar', () => ({ TopBar: () => null }));
vi.mock('./LeftRail', () => ({ LeftRail: () => null }));
vi.mock('./BottomBar', () => ({ BottomBar: () => null }));
vi.mock('./SearchBar', () => ({ SearchBar: () => null }));
vi.mock('./PresentMode', () => ({ PresentMode: () => null }));
vi.mock('./FloatingToolbar', () => ({ FloatingToolbar: ({ ctx }: { ctx: CommandContext }) => { surface.ctx = ctx; return null; } }));

const store = () => useDiagramStore.getState();
let root: Root;
let host: HTMLDivElement;

function keyboard(key: string) {
  const event = new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true });
  act(() => { host.dispatchEvent(event); });
  return event;
}

function clipboardEvent(type: string, values: Record<string, string> = {}, items: unknown[] = [], target: HTMLElement = host) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    getData: (type: string) => values[type] ?? '',
    setData: (type: string, value: string) => { values[type] = value; },
    items,
  } });
  act(() => { target.dispatchEvent(event); });
  return event;
}

function payload(label: string): ClipboardPayload {
  return { nodes: [{ id: label, type: 'shape', position: { x: 0, y: 0 },
    data: { shape: 'rectangle', label, fill: '#ABC', stroke: '#123' },
  }], edges: [] };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  surface.insertImages.mockClear();
  store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => { root.render(createElement(Canvas)); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Canvas clipboard', () => {
  it.each(['copy', 'cut'])('captures %s on keydown and only writes it on the clipboard event', (type) => {
    act(() => {
      const id = store().addShape('rectangle', { x: 10, y: 20 });
      useDiagramStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: n.id === id })) });
    });
    const run = vi.spyOn(registry.find(`clipboard.${type}`)!, 'run');
    const values: Record<string, string> = {};
    expect(keyboard(type === 'copy' ? 'c' : 'x').defaultPrevented).toBe(false);
    const captured = surface.ctx!.clipboard.get();
    expect(captured?.nodes).toHaveLength(1);
    expect(store().nodes).toHaveLength(type === 'copy' ? 1 : 0);
    const event = clipboardEvent(type, values);
    expect(event.defaultPrevented).toBe(true);
    expect(decodeClipboardPayload(values['text/html'])!.nodes).toHaveLength(1);
    expect(values).toHaveProperty('text/plain');
    expect(decodeClipboardPayload(values['text/html'])).toEqual(captured);
    expect(run).toHaveBeenCalledOnce();
    expect(store().nodes).toHaveLength(type === 'copy' ? 1 : 0);
    if (type === 'cut') {
      act(() => { store().undo(); });
      expect(store().nodes).toHaveLength(1);
    }
  });

  it.each(['copy', 'cut'])('keeps %s working when no clipboard event fires', (type) => {
    act(() => {
      store().loadDiagram('source', 'Source', false, payload('Selection'));
      useDiagramStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: true })) });
    });
    const run = vi.spyOn(registry.find(`clipboard.${type}`)!, 'run');
    expect(keyboard(type === 'copy' ? 'c' : 'x').defaultPrevented).toBe(false);
    expect(surface.ctx!.clipboard.get()?.nodes.map((n) => n.data.label)).toEqual(['Selection']);
    expect(store().nodes).toHaveLength(type === 'cut' ? 0 : 1);
    expect(run).toHaveBeenCalledOnce();
    if (type === 'cut') {
      act(() => { store().undo(); });
      expect(store().nodes).toHaveLength(1);
      expect(store().canUndo).toBe(false);
    }
  });

  it.each(['copy', 'cut'])('runs %s once for a browser menu event without a keystroke', (type) => {
    act(() => {
      store().loadDiagram('source', 'Source', false, payload('Selection'));
      useDiagramStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: true })) });
    });
    const run = vi.spyOn(registry.find(`clipboard.${type}`)!, 'run');
    const values: Record<string, string> = {};
    expect(clipboardEvent(type, values).defaultPrevented).toBe(true);
    expect(decodeClipboardPayload(values['text/html'])?.nodes[0].data.label).toBe('Selection');
    expect(values['text/plain']).toBe('Selection');
    expect(store().nodes).toHaveLength(type === 'cut' ? 0 : 1);
    expect(run).toHaveBeenCalledOnce();
  });

  it.each(['copy', 'cut'])('expires a missing %s event on keyup before a later menu event', (type) => {
    act(() => {
      store().loadDiagram('source', 'Source', false, payload('First'));
      useDiagramStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: true })) });
    });
    const key = type === 'copy' ? 'c' : 'x';
    keyboard(key);
    act(() => {
      host.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      store().loadDiagram('next', 'Next', false, payload('Next'));
      useDiagramStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: true })) });
    });
    const values: Record<string, string> = {};
    clipboardEvent(type, values);
    expect(decodeClipboardPayload(values['text/html'])?.nodes[0].data.label).toBe('Next');
    expect(store().nodes).toHaveLength(type === 'cut' ? 0 : 1);
  });

  it('pastes a system payload into a fresh canvas as one undo step', () => {
    act(() => {
      store().loadDiagram('source', 'Source', false, payload('Other browser'));
      useDiagramStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: true })) });
    });
    const values: Record<string, string> = {};
    clipboardEvent('copy', values);
    act(() => { root.unmount(); });
    store().loadDiagram('destination', 'Destination', false, { nodes: [], edges: [] });
    root = createRoot(host);
    act(() => { root.render(createElement(Canvas)); });
    const html = values['text/html'];
    expect(keyboard('v').defaultPrevented).toBe(false);
    const event = clipboardEvent('paste', { 'text/html': html });
    expect(event.defaultPrevented).toBe(true);
    expect(store().nodes.map((n) => n.data.label)).toEqual(['Other browser']);
    expect(store().nodes[0].id).not.toBe('Other browser');
    act(() => { store().undo(); });
    expect(store().nodes).toEqual([]);
    expect(store().canUndo).toBe(false);
  });

  it('uses a newer system payload before the tab ref, images and text parsers', () => {
    act(() => { surface.ctx!.clipboard.set(payload('Old copy')); });
    const html = encodeClipboardPayload(payload('New copy')).html;
    expect(keyboard('v').defaultPrevented).toBe(false);
    clipboardEvent('paste', { 'text/html': html, 'text/plain': 'flowchart TD\nA --> B' }, [
      { kind: 'file', type: 'image/png', getAsFile: () => new File(['image'], 'image.png') },
    ]);
    expect(store().nodes.map((n) => n.data.label)).toEqual(['New copy']);
    expect(surface.insertImages).not.toHaveBeenCalled();
  });

  it('keeps menu paste working when the system clipboard write is refused', async () => {
    const write = vi.fn(async (_items: { data: Record<string, Blob> }[]) => { throw new Error('refused'); });
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', class {
      data: Record<string, Blob>;
      constructor(data: Record<string, Blob>) { this.data = data; }
    });
    act(() => {
      const id = store().addShape('rectangle', { x: 0, y: 0 });
      useDiagramStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: n.id === id })) });
    });
    await act(async () => { registry.find('clipboard.copy')!.run(surface.ctx!); });
    expect(write).toHaveBeenCalledOnce();
    const item = write.mock.calls[0][0][0] as { data: Record<string, Blob> };
    expect(Object.keys(item.data)).toEqual(['text/html', 'text/plain']);
    act(() => { registry.find('clipboard.paste')!.run(surface.ctx!); });
    expect(store().nodes).toHaveLength(2);
    expect(write).toHaveBeenCalledOnce();
  });

  it('leaves text editors and read-only paste alone', () => {
    const input = document.createElement('input');
    host.append(input);
    const values = { 'text/html': encodeClipboardPayload(payload('Ignored')).html };
    expect(clipboardEvent('paste', values, [], input).defaultPrevented).toBe(false);
    expect(clipboardEvent('copy', {}, [], input).defaultPrevented).toBe(false);
    act(() => { useDiagramStore.setState({ readOnly: true }); });
    expect(clipboardEvent('paste', values).defaultPrevented).toBe(false);
    expect(store().nodes).toEqual([]);
  });

  it('keeps clipboard edits out of presentation mode', () => {
    act(() => { usePresentStore.setState({ active: true }); });
    const values = { 'text/html': encodeClipboardPayload(payload('Ignored')).html };
    expect(clipboardEvent('paste', values).defaultPrevented).toBe(false);
    expect(store().nodes).toEqual([]);
  });

  it('still offers external images and Mermaid to the existing paste chain', () => {
    clipboardEvent('paste', {}, [
      { kind: 'file', type: 'image/png', getAsFile: () => new File(['image'], 'image.png') },
    ]);
    expect(surface.insertImages).toHaveBeenCalledOnce();
    clipboardEvent('paste', { 'text/plain': 'sequenceDiagram\nAlice->>Bob: Hello' });
    expect(store().nodes.some((n) => n.data.label === 'Alice')).toBe(true);
  });
});
