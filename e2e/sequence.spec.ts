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

async function openEmptyBoard(page: Page, title: string): Promise<void> {
  const id = await page.evaluate(async (boardTitle) => {
    const body = { title: boardTitle, data: { version: 3, nodes: [], edges: [] } };
    const r = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await r.json()) as { id: string }).id;
  }, title);
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__pane')).toBeVisible();
}

async function writeClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (value) =>
      (navigator as unknown as { clipboard: { writeText(t: string): Promise<void> } }).clipboard.writeText(value),
    text,
  );
}

/** The board's current scale, so a pixel assertion does not assume zoom 1. */
async function zoomOf(page: Page): Promise<number> {
  // React Flow writes the viewport transform as an inline style, so it can be
  // read as the string it was written as — no computed-style round trip.
  const transform = await page.locator('.react-flow__viewport').evaluate((el) => el.style.transform);
  return Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? 1);
}

interface PathBox {
  x: number;
  width: number;
  height: number;
  dashed: boolean;
}

/** Every connector's drawn path, as a screen box plus whether it is dashed. */
async function connectorPaths(page: Page): Promise<PathBox[]> {
  return page.locator('.react-flow__edge-path').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      // `ConnectorEdge` sets the dash pattern inline, and leaves it off a solid
      // line entirely — so an empty string is "solid".
      const dash = el.style.strokeDasharray;
      return { x: r.x, width: r.width, height: r.height, dashed: dash !== '' };
    }),
  );
}

const SEQUENCE = [
  'sequenceDiagram',
  '  participant U as User',
  '  participant S as Server',
  '  participant D as Database',
  '  U->>S: save diagram',
  '  S->>D: write row',
  '  D-->>S: row id',
  '  S-->>U: saved',
].join('\n');

test('"Paste Mermaid" builds a sequence diagram whose columns move as one', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signUp(page);
  await openEmptyBoard(page, 'Sequence');

  await writeClipboard(page, SEQUENCE);

  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 240, y: 130 } });
  await page.getByRole('menuitem', { name: 'Paste Mermaid (flowchart or sequence)' }).click();

  // Three participants, each with a lifeline end, plus two invisible endpoints
  // per message: 3 + 3 + 8 boxes, and 3 lifelines + 4 messages of connector.
  await expect(page.locator('.react-flow__node')).toHaveCount(14);
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);

  for (const name of ['User', 'Server', 'Database']) {
    await expect(page.locator('.react-flow__node').getByText(name, { exact: true })).toBeVisible();
  }
  for (const message of ['save diagram', 'write row', 'row id', 'saved']) {
    await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
  }

  const zoom = await zoomOf(page);
  const before = await connectorPaths(page);

  // The lifelines are the only tall connectors on the board — a message runs
  // across — and every one of them is dashed.
  const lifelines = before.filter((p) => p.height > 100 * zoom);
  expect(lifelines).toHaveLength(3);
  expect(lifelines.every((p) => p.dashed)).toBe(true);

  // Nothing may be selected before the drag, or React Flow would move all
  // three participants together: the paste leaves them selected.
  await page.keyboard.press('Escape');

  const participant = page.locator('.react-flow__node').filter({ hasText: 'User' }).first();
  const start = (await participant.boundingBox())!;

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 100, start.y + start.height / 2, { steps: 5 });
  await page.mouse.move(start.x + start.width / 2 + 200, start.y + start.height / 2, { steps: 5 });
  await page.mouse.up();

  const end = (await participant.boundingBox())!;
  const dx = end.x - start.x;
  expect(dx).toBeGreaterThan(150);
  expect(Math.abs(end.y - start.y)).toBeLessThan(4);

  const after = await connectorPaths(page);

  // Nothing was orphaned: the column travelled whole.
  expect(after).toHaveLength(before.length);
  await expect(page.locator('.react-flow__node')).toHaveCount(14);

  // The lifeline under the participant went with it — it is still the leftmost
  // thing drawn, and it has moved by exactly the drag.
  const leftmost = (boxes: PathBox[]) => Math.min(...boxes.map((b) => b.x));
  expect(Math.abs(leftmost(after) - leftmost(before) - dx)).toBeLessThan(2);

  // And so did both message endpoints on it: "save diagram" leaves that
  // lifeline and "saved" arrives at it, so each is `dx` shorter than it was
  // while the two between Server and Database are untouched.
  const totalWidth = (boxes: PathBox[]) => boxes.reduce((sum, b) => sum + b.width, 0);
  expect(Math.abs(totalWidth(before) - totalWidth(after) - 2 * dx)).toBeLessThan(4);
});
