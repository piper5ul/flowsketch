import { expect, test, type Page } from '@playwright/test';

/**
 * How connectors line up in the browser. `cleanPath` (and the levelling of an
 * unbent straight or curved line) absorbs a jog of a few pixels between two
 * nearly level shapes; a unit test of the path builder once passed while the
 * drawn arrows had a visible step in them, so this reads the `d` that is
 * actually on the page.
 */

async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();
}

type Box = { id: string; x: number; y: number };

/** A diagram of 160×80 rectangles (and the given connectors), opened at 100%. */
async function openBoard(page: Page, boxes: Box[], edges: unknown[] = []) {
  await signUp(page);
  const id = await page.evaluate(async ({ boxes, edges }) => {
    const nodes = boxes.map((b) => ({
      id: b.id, type: 'shape', position: { x: b.x, y: b.y }, width: 160, height: 80,
      data: { label: b.id, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
    }));
    const body = { title: 'Connector align', data: { version: 3, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } } };
    const r = await fetch('/api/diagrams', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return ((await r.json()) as { id: string }).id;
  }, { boxes, edges });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(boxes.length);
}

function connector(id: string, source: string, target: string, connectorType: string) {
  return {
    id, source, target, type: 'connector',
    data: { connectorType, sourceAnchor: { side: 'right', t: 0.5 }, targetAnchor: { side: 'left', t: 0.5 } },
  };
}

/** Every coordinate pair in a connector's drawn path, control points included. */
async function pathPoints(page: Page, edgeId: string) {
  const d = await page.locator(`.react-flow__edge[data-id="${edgeId}"] .react-flow__edge-path`).getAttribute('d');
  const numbers = (d ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
  return points;
}

async function expectLevel(page: Page, edgeId: string) {
  await expect.poll(async () => new Set((await pathPoints(page, edgeId)).map((p) => p.y)).size, {
    message: `${edgeId} should be one level run`,
  }).toBe(1);
}

test('two shapes 3 px out of line are joined by one straight run, whatever the kind', async ({ page }) => {
  await openBoard(
    page,
    [
      { id: 'a1', x: 100, y: 60 }, { id: 'b1', x: 500, y: 63 },
      { id: 'a2', x: 100, y: 260 }, { id: 'b2', x: 500, y: 263 },
      { id: 'a3', x: 100, y: 460 }, { id: 'b3', x: 500, y: 463 },
    ],
    [connector('elbow', 'a1', 'b1', 'elbow'), connector('straight', 'a2', 'b2', 'straight'), connector('curved', 'a3', 'b3', 'curved')],
  );
  for (const id of ['elbow', 'straight', 'curved']) await expectLevel(page, id);

  // Nudged 6 px the other way — 3 px above instead of below — it stays level.
  for (const target of ['b1', 'b2']) {
    await page.locator(`.react-flow__node[data-id="${target}"]`).click();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
  }
  await page.keyboard.press('Escape');
  for (const id of ['elbow', 'straight']) await expectLevel(page, id);
});

test('a connector drawn with the tool between two nearly level shapes is straight', async ({ page }) => {
  await openBoard(page, [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 500, y: 103 }]);
  const a = (await page.locator('.react-flow__node[data-id="a"]').boundingBox())!;
  const b = (await page.locator('.react-flow__node[data-id="b"]').boundingBox())!;

  await page.keyboard.press('a');
  await page.mouse.move(a.x + a.width - 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 10 });
  await page.mouse.move(b.x + 2, b.y + b.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const id = await page.locator('.react-flow__edge').getAttribute('data-id');
  await expectLevel(page, id!);
});

test('a loop-back elbow arrives on its target from above, along a vertical final run', async ({ page }) => {
  // The source sits lower than the target, so the line leaves its bottom and
  // has to come back up and round to reach the target's top.
  await openBoard(page, [{ id: 'low', x: 100, y: 400 }, { id: 'high', x: 500, y: 250 }]);
  const low = (await page.locator('.react-flow__node[data-id="low"]').boundingBox())!;
  const high = (await page.locator('.react-flow__node[data-id="high"]').boundingBox())!;

  await page.keyboard.press('a');
  await page.mouse.move(low.x + low.width / 2, low.y + low.height - 2);
  await page.mouse.down();
  await page.mouse.move(high.x + high.width / 2, high.y - 30, { steps: 10 });
  await page.mouse.move(high.x + high.width / 2, high.y + 2, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const id = (await page.locator('.react-flow__edge').getAttribute('data-id'))!;

  const points = await pathPoints(page, id);
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  // Board coordinates: `high` is at (500, 250), 160 wide, with the viewport at 100%.
  expect(end.x).toBe(580);
  expect(before.x).toBe(end.x);
  expect(before.y).toBeLessThan(end.y);
  // Short of the top by the standoff and the arrowhead, and no further.
  expect(end.y).toBeLessThan(250);
  expect(end.y).toBeGreaterThan(250 - 24);
});

test('an arrow key nudges a connected shape by exactly one step, however it was selected', async ({ page }) => {
  await openBoard(page, [{ id: 'a', x: 100, y: 150 }, { id: 'b', x: 400, y: 150 }], [connector('ab', 'a', 'b', 'elbow')]);
  const b = page.locator('.react-flow__node[data-id="b"]');
  const y = () => b.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);

  // Clicked: React Flow focuses the node, and its own arrow-key move (5 px)
  // must not ride along with the registry's nudge.
  await b.click();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(y).toBe(153);

  // Box-selected: the same through React Flow's selection rectangle.
  await page.mouse.click(1100, 600);
  await page.mouse.move(80, 100);
  await page.mouse.down();
  await page.mouse.move(700, 400, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.keyboard.press('ArrowDown');
  await expect.poll(y).toBe(154);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(y).toBe(164);
});
