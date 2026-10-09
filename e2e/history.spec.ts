import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, name = 'E2E User') {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();
  return email;
}

test('the history panel scrubs through versions and forks one into a new diagram', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const r = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return r.json() as Promise<{ id: string }>;
    };
    const shape = (id: string, label: string) => ({ id, type: 'shape', position: { x: 100, y: 100 }, width: 180, height: 100, data: { label, shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' } });
    const diagram = await post('/api/diagrams', { title: 'Scrubbed', data: { version: 3, nodes: [shape('a', 'one')], edges: [] } });
    await post(`/api/diagrams/${diagram.id}/versions`, { label: 'First' });
    await post(`/api/diagrams/${diagram.id}/versions`, { label: 'Second' });
    return diagram.id;
  });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  await page.getByRole('button', { name: /^History/ }).click();
  const panel = page.getByRole('dialog', { name: 'Version history' });
  await expect(panel).toBeVisible();
  const scrub = panel.getByRole('group', { name: 'Scrub through versions' });
  await expect(scrub).toBeVisible();
  await expect(scrub).toContainText('2 / 2');

  await scrub.getByRole('button', { name: 'Older version' }).click();
  await expect(scrub).toContainText('1 / 2');
  await expect(scrub.getByRole('button', { name: 'Older version' })).toBeDisabled();

  await panel.getByRole('button', { name: 'Fork' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/d/(?!${id}$)[^/]+$`));
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Diagram title' })).toHaveValue(/\(fork\)/);
});

test('a row-based restore failure shows its error instead of a reconnect prompt', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.json() as Promise<{ id: string }>;
    };
    const diagram = await post('/api/diagrams', {
      title: 'Restore error',
      data: { version: 3, nodes: [], edges: [] },
    });
    await post(`/api/diagrams/${diagram.id}/versions`, { label: 'Checkpoint' });
    return diagram.id;
  });

  // Keep this diagram on its row-based path: the websocket never reaches the
  // server, so opening the canvas cannot create a DiagramDoc row.
  await page.routeWebSocket(/\/collab/, (socket) => { void socket.close(); });
  let restoreRequestIntercepted = false;
  await page.route(/\/api\/diagrams\/[^/]+\/versions\/[^/]+\/restore$/, async (route) => {
    restoreRequestIntercepted = true;
    await route.fulfill({ status: 500, json: { error: 'Database unavailable' } });
  });
  await page.goto(`/d/${id}`);
  await page.getByRole('button', { name: 'History' }).click();
  const panel = page.getByRole('dialog', { name: 'Version history' });
  const checkpoint = panel.getByRole('listitem').filter({ hasText: 'Checkpoint' });
  await checkpoint.getByRole('button', { name: 'Restore' }).click();
  await panel.getByRole('button', { name: 'Restore this version' }).click();

  await expect.poll(() => restoreRequestIntercepted).toBe(true);
  await expect(page.getByText('Could not restore that version.')).toBeVisible();
  await expect(page.getByText('Reconnect to restore a version')).toHaveCount(0);
});

test('a row-based restore flushes a dirty title before loading the restored board', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.json() as Promise<{ id: string }>;
    };
    const diagram = await post('/api/diagrams', {
      title: 'Historical title',
      data: {
        version: 3,
        nodes: [{
          id: 'restore-shape', type: 'shape', position: { x: 100, y: 100 }, width: 180, height: 100,
          data: { label: 'Historical content', shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' },
        }],
        edges: [],
      },
    });
    await post(`/api/diagrams/${diagram.id}/versions`, { label: 'Checkpoint' });
    const currentBoard = {
      version: 3,
      nodes: [{
        id: 'restore-shape', type: 'shape', position: { x: 100, y: 100 }, width: 180, height: 100,
        data: { label: 'Current content', shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' },
      }],
      edges: [],
    };
    const saved = await fetch(`/api/diagrams/${diagram.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: currentBoard }),
    });
    if (!saved.ok) throw new Error(`Could not prepare current board: ${saved.status}`);
    return diagram.id;
  });

  // Keeping the websocket away forces the route's row-based restore branch.
  await page.routeWebSocket(/\/collab/, (socket) => { void socket.close(); });
  const writes: string[] = [];
  await page.route('**/api/diagrams/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT' && path === `/api/diagrams/${id}`) {
      const body = request.postDataJSON() as { title?: string; data?: unknown };
      if (body.title === 'Current title' && body.data === undefined) writes.push('title');
      if (body.title === 'Title save failure' && body.data === undefined) {
        writes.push('title-failure');
        await route.fulfill({ status: 500, json: { error: 'Database unavailable' } });
        return;
      }
    }
    if (request.method() === 'POST' && path.endsWith('/restore')) writes.push('restore');
    await route.continue();
  });

  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toContainText('Current content');

  // Hold only the title saver’s one-second debounce. Restore must flush the
  // dirty value explicitly before the server returns the row title.
  await page.evaluate(() => {
    const originalSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 1000) return 2_147_483_647;
      return originalSetTimeout(callback, delay, ...args);
    }) as typeof window.setTimeout;
  });
  await page.getByRole('textbox', { name: 'Diagram title' }).fill('Current title');
  await page.getByRole('button', { name: 'History' }).click();
  const panel = page.getByRole('dialog', { name: 'Version history' });
  const checkpoint = panel.getByRole('listitem').filter({ hasText: 'Checkpoint' });
  await checkpoint.getByRole('button', { name: 'Restore' }).click();
  await panel.getByRole('button', { name: 'Restore this version' }).click();

  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toContainText('Historical content');
  await expect(page.getByRole('textbox', { name: 'Diagram title' })).toHaveValue('Current title');
  expect(writes.indexOf('title')).toBeGreaterThanOrEqual(0);
  expect(writes.indexOf('restore')).toBeGreaterThan(writes.indexOf('title'));

  await page.getByRole('textbox', { name: 'Diagram title' }).fill('Title save failure');
  await checkpoint.getByRole('button', { name: 'Restore' }).click();
  await panel.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByText("Couldn't save the diagram title")).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Diagram title' })).toHaveValue('Title save failure');
  await expect(page.locator('.react-flow__node')).toContainText('Historical content');
  expect(writes).toEqual(['title', 'restore', 'title-failure']);
});

test('a title edited while row-based restore is in flight survives its response', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.json() as Promise<{ id: string }>;
    };
    const diagram = await post('/api/diagrams', {
      title: 'Persisted title',
      data: {
        version: 3,
        nodes: [{
          id: 'restore-shape', type: 'shape', position: { x: 100, y: 100 }, width: 180, height: 100,
          data: { label: 'Historical content', shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' },
        }],
        edges: [],
      },
    });
    await post(`/api/diagrams/${diagram.id}/versions`, { label: 'Checkpoint' });
    const saved = await fetch(`/api/diagrams/${diagram.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          version: 3,
          nodes: [{
            id: 'restore-shape', type: 'shape', position: { x: 100, y: 100 }, width: 180, height: 100,
            data: { label: 'Current content', shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' },
          }],
          edges: [],
        },
      }),
    });
    if (!saved.ok) throw new Error(`Could not prepare current board: ${saved.status}`);
    return diagram.id;
  });

  await page.routeWebSocket(/\/collab/, (socket) => { void socket.close(); });
  let releaseRestore!: () => void;
  const restoreGate = new Promise<void>((resolve) => { releaseRestore = resolve; });
  let markRestoreReady!: () => void;
  const restoreReady = new Promise<void>((resolve) => { markRestoreReady = resolve; });
  await page.route(/\/api\/diagrams\/[^/]+\/versions\/[^/]+\/restore$/, async (route) => {
    const response = await route.fetch();
    markRestoreReady();
    await restoreGate;
    await route.fulfill({ response });
  });

  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toContainText('Current content');
  await page.getByRole('button', { name: 'History' }).click();
  const panel = page.getByRole('dialog', { name: 'Version history' });
  const checkpoint = panel.getByRole('listitem').filter({ hasText: 'Checkpoint' });
  await checkpoint.getByRole('button', { name: 'Restore' }).click();
  await panel.getByRole('button', { name: 'Restore this version' }).click();
  await restoreReady;

  try {
    const titleSaved = page.waitForResponse((response) => {
      const request = response.request();
      if (request.method() !== 'PUT' || new URL(response.url()).pathname !== `/api/diagrams/${id}`) return false;
      const body = request.postDataJSON() as { title?: string };
      return body.title === 'Newer title during restore';
    });
    await page.getByRole('textbox', { name: 'Diagram title' }).fill('Newer title during restore');
    const saved = await titleSaved;
    expect(saved.ok()).toBe(true);
  } finally {
    releaseRestore();
  }

  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toContainText('Historical content');
  await expect(page.getByRole('textbox', { name: 'Diagram title' })).toHaveValue('Newer title during restore');
  const persisted = await page.evaluate(async (diagramId) => {
    const response = await fetch(`/api/diagrams/${diagramId}`, { credentials: 'include' });
    return response.json() as Promise<{ title: string; data: { nodes: { data: { label: string } }[] } }>;
  }, id);
  expect(persisted.title).toBe('Newer title during restore');
  expect(persisted.data.nodes.map((node) => node.data.label)).toEqual(['Historical content']);
});
