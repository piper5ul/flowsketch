/**
 * HTTP servers for the supertest suites: bound to loopback, and held rather
 * than rebuilt per request.
 *
 * **Why this exists.** The `auth gate` tests had been failing about one run in
 * twenty — but never twice in the same place. `rateLimit.test.ts` saw a `403`
 * and `images.test.ts`'s auth gate saw one too, a status neither of those apps
 * can produce; other runs hung to the 5 s timeout, or died with `ECONNRESET`,
 * or read an empty body off a 200. Not test state: every `request(...)` in the
 * suite is awaited, nothing is `concurrent`, and the mocked `requireAuth` reads
 * `authState` per request rather than at mount time. Requests were reaching
 * *another test file's server*.
 *
 * **How that happens.** `listen(0)` with no host binds the IPv6 wildcard `::`;
 * a socket bound to the IPv4 wildcard `0.0.0.0` is, to the kernel, a different
 * address — and on macOS (libuv sets `SO_REUSEADDR`) the two can hold the *same
 * port at the same time*. A connection to `127.0.0.1:<port>` then lands on
 * whichever of them the kernel prefers, which need not be the one that just
 * reported that port from `address()`. Give it enough draws and it eventually
 * happens: `request(app)` — supertest handed an app rather than a server —
 * wraps the app in a fresh server, binds an ephemeral port and closes it again
 * the moment the response lands, so a full run of this suite was taking ~150
 * such draws across eight worker processes.
 *
 * **The fix, both halves.** Bind `127.0.0.1` explicitly, so every socket in the
 * suite is in one address family and the kernel's port allocator can see all of
 * them; and hold one server per file instead of one per request, since supertest
 * only calls `listen(0)` for something that is not already listening, and only
 * closes a server it opened itself. One family, and ~150 binds down to ~20.
 *
 * Not part of the shipped server: `tsconfig.server.json` excludes it.
 */
import { createServer, type RequestListener, type Server } from 'node:http';
import { afterAll, onTestFinished } from 'vitest';

/**
 * Loopback, spelled out. The whole point: never the `::` wildcard that can end
 * up sharing a port with an IPv4 socket somewhere else on the machine.
 */
const LOOPBACK = '127.0.0.1';

/** Close a server without waiting out any connection still parked on it. */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

/**
 * One server for the whole test file, closed when the file is done. Call it at
 * module scope, next to the app it serves, and hand the result to `request()`.
 */
export function serveForFile(app: RequestListener): Server {
  const server = createServer(app).listen(0, LOOPBACK);
  afterAll(() => close(server));
  return server;
}

/**
 * A server for a single test, closed when that test finishes. For the suites
 * that build a fresh app per case (a rate limiter has to start from an empty
 * count) and so cannot share one for the file.
 */
export function serveForTest(app: RequestListener): Server {
  const server = createServer(app).listen(0, LOOPBACK);
  onTestFinished(() => close(server));
  return server;
}
