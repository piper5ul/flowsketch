/**
 * The collaboration server: who is let in, and that two clients let in on the
 * same diagram can see each other.
 *
 * The database, the auth instance and `getDiagramAccess` are all mocked, so the
 * integration half is hermetic — a real socket, a real Hocuspocus, a real
 * `@hocuspocus/provider` on both ends, and nothing outside the process.
 */
import { afterAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { Hocuspocus, onAuthenticatePayload, ConnectionConfiguration } from '@hocuspocus/server';
import type { AddressInfo } from 'node:net';
import { serveForFile } from './testServer.js';

const { authMock, accessMock } = vi.hoisted(() => ({
  authMock: { api: { getSession: vi.fn() } },
  accessMock: { getDiagramAccess: vi.fn() },
}));

// Never constructed: `access.js` is mocked, and nothing else here reaches it.
vi.mock('./db.js', () => ({ prisma: {} }));
vi.mock('./auth.js', () => ({ auth: authMock }));
vi.mock('./access.js', () => accessMock);

const { attachCollab, createCollabServer, diagramIdFromDocumentName, COLLAB_PATH } =
  await import('./collab.js');
const { HocuspocusProvider, HocuspocusProviderWebsocket } = await import('@hocuspocus/provider');
type HocuspocusProviderConfiguration = ConstructorParameters<typeof HocuspocusProvider>[0];

type CollabServer = ReturnType<typeof createCollabServer>;

const session = { user: { id: 'u1', name: 'User One' } };

/**
 * A full `onAuthenticate` payload around the two fields the hook reads. The
 * rest is what Hocuspocus would hand it; spelled out rather than cast so a
 * change to the payload shape is a compile error here.
 */
function authPayload(
  documentName: string,
  instance: CollabServer,
  connectionConfig: ConnectionConfiguration = { readOnly: false, isAuthenticated: false },
): onAuthenticatePayload {
  const request = new Request('http://localhost/collab', {
    headers: new Headers({ cookie: 'better-auth.session_token=abc' }),
  });
  return {
    context: undefined,
    documentName,
    instance: instance as Hocuspocus,
    requestHeaders: request.headers,
    requestParameters: new URLSearchParams(),
    request,
    socketId: 'socket-1',
    // Cookie auth: the provider still sends an authentication message, and it
    // is always empty. Nothing in the hook looks at it.
    token: '',
    connectionConfig,
    providerVersion: null,
  };
}

/** The hook under test, which is only ever configured. */
function authenticate(
  server: CollabServer,
  documentName: string,
  connectionConfig?: ConnectionConfiguration,
) {
  const onAuthenticate = server.configuration.onAuthenticate;
  if (!onAuthenticate) throw new Error('onAuthenticate is not configured');
  return onAuthenticate(authPayload(documentName, server, connectionConfig));
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.api.getSession.mockResolvedValue(session);
  accessMock.getDiagramAccess.mockResolvedValue({ diagram: { id: 'd1' }, role: 'editor' });
});

describe('diagramIdFromDocumentName', () => {
  it('reads the id out of a diagram document name', () => {
    expect(diagramIdFromDocumentName('diagram:d1')).toBe('d1');
  });

  it('rejects anything else', () => {
    expect(diagramIdFromDocumentName('d1')).toBeNull();
    expect(diagramIdFromDocumentName('diagram:')).toBeNull();
    expect(diagramIdFromDocumentName('')).toBeNull();
  });
});

describe('onAuthenticate', () => {
  it('rejects a document name that is not a diagram', async () => {
    const server = createCollabServer();
    await expect(authenticate(server, 'notes:d1')).rejects.toThrow();
    // Refused before any lookup: an arbitrary string off the wire never
    // reaches the database.
    expect(authMock.api.getSession).not.toHaveBeenCalled();
    expect(accessMock.getDiagramAccess).not.toHaveBeenCalled();
  });

  it('rejects a connection with no session', async () => {
    authMock.api.getSession.mockResolvedValue(null);
    const server = createCollabServer();
    await expect(authenticate(server, 'diagram:d1')).rejects.toThrow();
    expect(accessMock.getDiagramAccess).not.toHaveBeenCalled();
  });

  it('rejects a signed-in user with no access to the diagram', async () => {
    accessMock.getDiagramAccess.mockResolvedValue(null);
    const server = createCollabServer();
    await expect(authenticate(server, 'diagram:d1')).rejects.toThrow();
    expect(accessMock.getDiagramAccess).toHaveBeenCalledWith('u1', 'd1', { id: true });
  });

  it('connects a viewer read-only', async () => {
    accessMock.getDiagramAccess.mockResolvedValue({ diagram: { id: 'd1' }, role: 'viewer' });
    const server = createCollabServer();
    const connectionConfig: ConnectionConfiguration = { readOnly: false, isAuthenticated: false };
    const context = await authenticate(server, 'diagram:d1', connectionConfig);
    expect(connectionConfig.readOnly).toBe(true);
    expect(context).toEqual({ user: { id: 'u1', name: 'User One' }, role: 'viewer' });
  });

  it('connects an editor read-write, with the role resolved by the server', async () => {
    const server = createCollabServer();
    const connectionConfig: ConnectionConfiguration = { readOnly: false, isAuthenticated: false };
    const context = await authenticate(server, 'diagram:d1', connectionConfig);
    expect(connectionConfig.readOnly).toBe(false);
    expect(context).toEqual({ user: { id: 'u1', name: 'User One' }, role: 'editor' });
  });

  it('connects an owner read-write', async () => {
    accessMock.getDiagramAccess.mockResolvedValue({ diagram: { id: 'd1' }, role: 'owner' });
    const server = createCollabServer();
    const connectionConfig: ConnectionConfiguration = { readOnly: false, isAuthenticated: false };
    const context = await authenticate(server, 'diagram:d1', connectionConfig);
    expect(connectionConfig.readOnly).toBe(false);
    expect(context).toEqual({ user: { id: 'u1', name: 'User One' }, role: 'owner' });
  });
});

// The HTTP half answers nothing: every request this server sees is an upgrade
// on `/collab`. One server for the whole file — see `testServer.ts`.
const httpServer = await serveForFile((_req, res) => res.end());
const hocuspocus: Hocuspocus = attachCollab(httpServer);
const collabUrl = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}${COLLAB_PATH}`;

/**
 * A provider for `name`, on a socket of its own, torn down with the test.
 *
 * The websocket half is built explicitly for two reasons: `WebSocketPolyfill`
 * lives on that configuration (Node has no global `WebSocket` the provider
 * could reach for), and one per provider is what makes these two separate
 * clients rather than two documents down one connection. A provider handed a
 * socket it did not create neither attaches to nor destroys it, so both are
 * done here.
 */
function connect(name: string, options: Partial<HocuspocusProviderConfiguration> = {}) {
  const socket = new HocuspocusProviderWebsocket({ url: collabUrl, WebSocketPolyfill: WebSocket });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, ...options });
  provider.attach();
  onTestFinished(() => {
    provider.destroy();
    socket.destroy();
  });
  return provider;
}

/** Resolves when `check` holds, or rejects rather than hanging the suite. */
async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Everyone this provider can see except itself: the peer list, in essence. */
function peersOf(provider: ReturnType<typeof connect>) {
  return [...(provider.awareness?.getStates() ?? [])].filter(
    ([clientId]) => clientId !== provider.document.clientID,
  );
}

describe('presence over a real socket', () => {
  afterAll(() => hocuspocus.closeConnections());

  it('fans one client’s awareness state out to the other', async () => {
    const a = connect('diagram:shared');
    const b = connect('diagram:shared');
    await eventually(() => a.isAuthenticated && b.isAuthenticated, 'both clients to authenticate');

    a.setAwarenessField('user', { userId: 'u1', name: 'User One', color: '#2563EB' });
    a.setAwarenessField('cursor', { x: 120, y: 40 });
    a.setAwarenessField('selection', ['n1']);

    await eventually(() => peersOf(b).length === 1, "b to see a's state");
    const [, state] = peersOf(b)[0];
    expect(state).toEqual({
      user: { userId: 'u1', name: 'User One', color: '#2563EB' },
      cursor: { x: 120, y: 40 },
      selection: ['n1'],
    });
  });

  it('keeps separate diagrams apart', async () => {
    const a = connect('diagram:one');
    const b = connect('diagram:two');
    await eventually(() => a.isAuthenticated && b.isAuthenticated, 'both clients to authenticate');
    a.setAwarenessField('user', { userId: 'u1', name: 'User One', color: '#2563EB' });

    // Nothing to wait for on the way in, so give the update the time it would
    // have needed to arrive before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(peersOf(b)).toHaveLength(0);
  });

  it('refuses a client with no access to the diagram', async () => {
    accessMock.getDiagramAccess.mockResolvedValue(null);
    let refused = false;
    const provider = connect('diagram:forbidden', {
      onAuthenticationFailed: () => { refused = true; },
    });
    await eventually(() => refused, 'the connection to be refused');
    // A refusal is not an authentication: the client never gets a scope.
    expect(provider.isAuthenticated).toBe(false);
    expect(provider.authorizedScope).toBeUndefined();
  });
});
