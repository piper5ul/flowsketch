/**
 * The real-time collaboration server: Hocuspocus, attached to the Express
 * process rather than listening on a port of its own.
 *
 * See `docs/realtime.md`. Phase 1 carries **presence only** — the Yjs document
 * behind each connection is created and synced but nothing on either side reads
 * or writes it yet; what travels is awareness (cursors, selections, who is
 * here), which Yjs keeps out of the document and never persists.
 *
 * **Why attached.** `@hocuspocus/server`'s own `Server` builds an HTTP server,
 * which would mean a second port, a second thing for the Cloudflare tunnel to
 * carry and a second place the session cookie has to be valid. Handing the
 * upgrade to a `noServer` `WebSocketServer` instead keeps one process, one port
 * and one origin, so the browser sends the same cookie it sends to `/api`.
 *
 * **Why the hand-rolled message pump.** In 4.x `handleConnection` no longer
 * subscribes to the socket: it returns a `ClientConnection` and the integration
 * is expected to feed it (`handleMessage`, `handleClose`). The upstream `Server`
 * does that through `crossws`; `attachCollab` does it directly against `ws`.
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, type RawData } from 'ws';
import { auth } from './auth.js';
import { getDiagramAccess } from './access.js';
import type { DiagramRole } from '../shared/types.js';

/** The path the browser opens its collaboration socket on. */
export const COLLAB_PATH = '/collab';

/** Document names are `diagram:<id>`; nothing else is a document we serve. */
const DOCUMENT_NAME = /^diagram:(.+)$/;

/**
 * What `onAuthenticate` hands the rest of the hooks. Kept to what presence
 * needs — the connection's own identity is authoritative here, so a client
 * cannot claim to be someone else in its awareness state.
 */
export interface CollabContext {
  user: { id: string; name: string };
  role: DiagramRole;
}

/**
 * The diagram id inside a document name, or `null` when the name is not one of
 * ours. Exported for the test, and because it is the only thing standing
 * between an arbitrary string off the wire and a database lookup.
 */
export function diagramIdFromDocumentName(documentName: string): string | null {
  const match = DOCUMENT_NAME.exec(documentName);
  return match ? match[1] : null;
}

/**
 * Connection lifecycle noise, off unless asked for. One line per open and close
 * per document is a lot of log for something that happens on every page view,
 * and none of it is actionable — a rejected connection throws instead, which is
 * the part worth seeing.
 */
function debug(message: string): void {
  if (process.env.COLLAB_DEBUG) console.debug(`[collab] ${message}`);
}

/**
 * A Hocuspocus instance with no server of its own — `attachCollab` gives it
 * one. Exported un-attached so the auth hook can be exercised without a socket.
 */
export function createCollabServer(): Hocuspocus<CollabContext> {
  return new Hocuspocus<CollabContext>({
    // The start screen belongs to the standalone server; this one is a detail
    // of the Express process and says so through `index.ts`'s own line.
    quiet: true,

    /**
     * The whole of the access control. It runs before the document is created,
     * so a caller with no business here never reaches one — and because the
     * role is resolved here rather than trusted from the client, a viewer
     * cannot talk their way into a writable connection.
     */
    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const diagramId = diagramIdFromDocumentName(documentName);
      // Not a rejection of *this* diagram: there is no diagram to reject.
      if (!diagramId) throw new Error('Unknown document');

      // The same read `requireAuth` does. The upgrade request carries the
      // browser's cookies because the socket is same-origin with the API.
      const session = await auth.api.getSession({ headers: requestHeaders });
      if (!session) throw new Error('Unauthorized');

      // `getDiagramAccess` answers "nothing at all" for a diagram that is not
      // there as well as for one you may not see, and both are the same
      // rejection here — as they are over HTTP.
      const access = await getDiagramAccess(session.user.id, diagramId, { id: true });
      if (!access) throw new Error('Forbidden');

      // A viewer is connected, not refused: they are entitled to see who else
      // is here and where. `readOnly` is what stops their socket from writing
      // to the document when phase 2 puts something in it.
      if (access.role === 'viewer') connectionConfig.readOnly = true;

      return { user: { id: session.user.id, name: session.user.name }, role: access.role };
    },

    async onConnect({ documentName, socketId }) {
      debug(`connect ${socketId} -> ${documentName}`);
    },

    async onDisconnect({ documentName, socketId, clientsCount }) {
      debug(`disconnect ${socketId} <- ${documentName} (${clientsCount} left)`);
    },
  });
}

/** `ws` hands binary frames as a Buffer, a list of them, or an ArrayBuffer. */
function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // A Buffer *is* a Uint8Array, but it can be a window onto a larger pooled
  // allocation — copying the view's own bounds is what keeps the decoder from
  // reading a neighbour's bytes.
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Hocuspocus 4 speaks the web `Request`; Node's upgrade handler speaks
 * `IncomingMessage`. Only the URL and the headers are ever read (the cookie,
 * and the document name out of the first message), so this is the whole of it.
 */
function toWebRequest(req: IncomingMessage): Request {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const one of value) headers.append(name, one);
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(url, { headers });
}

/**
 * Routes `upgrade` requests on `/collab` into `hocuspocus`, and refuses every
 * other path.
 *
 * The refusal matters: an `upgrade` listener that ignores what it does not
 * recognise leaves the socket open and half-upgraded until it times out, so
 * anything not ours is destroyed here rather than left hanging. Vite's HMR
 * socket is not affected — that one is served by Vite, not by this process.
 */
export function attachCollab(
  httpServer: HttpServer,
  hocuspocus: Hocuspocus<CollabContext> = createCollabServer(),
): Hocuspocus<CollabContext> {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
    if (path !== COLLAB_PATH) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const connection = hocuspocus.handleConnection(ws, toWebRequest(req));
      ws.on('message', (data: RawData) => connection.handleMessage(toUint8Array(data)));
      ws.on('close', (code: number, reason: Buffer) =>
        connection.handleClose({ code, reason: reason.toString() }));
      // A socket-level error closes the socket, which fires `close` above; the
      // listener is here so the error is not thrown at the process instead.
      ws.on('error', () => ws.close());
    });
  });

  return hocuspocus;
}
