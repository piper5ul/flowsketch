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

/**
 * An empty diagram of this user's, opened at 1:1 with the origin in the
 * canvas's top-left corner — so a screen coordinate the mouse is driven to is
 * the board coordinate the stroke is drawn at, and the assertions below can be
 * about the pixels the drag actually visited.
 *
 * The stored viewport is also what stops React Flow from framing the content:
 * a diagram that opens with nothing on it defers its `fitView` until there is
 * something to fit, which would otherwise move the board halfway through this
 * test — the moment the first stroke lands.
 */
async function openBlankDiagram(page: Page) {
  const id = await page.evaluate(async () => {
    const response = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Freehand',
        data: { version: 3, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      }),
    });
    return ((await response.json()) as { id: string }).id;
  });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  return id;
}

/**
 * Drags a squiggle from `from` to `to` in *screen* coordinates, in several
 * steps — a stroke is the moves, not the press and the release.
 */
async function squiggle(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(
      from.x + (to.x - from.x) * t,
      // A wave rather than a straight line, so what is committed is a curve.
      from.y + (to.y - from.y) * t + Math.sin(t * Math.PI * 2) * 25,
    );
  }
  await page.mouse.up();
}

test('the pen draws strokes and the eraser rubs them out', async ({ page }) => {
  await signUp(page);
  await openBlankDiagram(page);

  const ink = page.locator('[data-node-type="ink"]');

  // The pen is picked from the rail; it stays held so several strokes can be
  // drawn without going back for it.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await squiggle(page, { x: 420, y: 300 }, { x: 620, y: 300 });
  await expect(ink).toHaveCount(1);

  // The stroke's node covers the drag: the box is the polyline's bounds grown
  // by half the pen, so a few pixels of slack either way.
  const box = (await ink.first().boundingBox())!;
  expect(box.x).toBeGreaterThan(412);
  expect(box.x).toBeLessThan(422);
  expect(box.x + box.width).toBeGreaterThan(616);
  expect(box.x + box.width).toBeLessThan(626);
  // The wave in the drag is ±25 px, which the box has to hold.
  expect(box.height).toBeGreaterThan(20);

  // Still the pen: a second stroke needs no second trip to the rail.
  await squiggle(page, { x: 420, y: 460 }, { x: 620, y: 460 });
  await expect(ink).toHaveCount(2);

  // ⇧E is the eraser — E itself is not free (see `TOOL_COMMANDS`). Scribbling
  // back along the whole of the first stroke rubs all of it out, a quick wipe
  // included: the eraser covers the path between pointer samples too.
  await page.keyboard.press('Shift+E');
  await squiggle(page, { x: 420, y: 300 }, { x: 620, y: 300 });
  await expect(ink).toHaveCount(1);

  // And the one that is left is the lower one, drawn well clear of the wipe.
  const survivor = (await ink.first().boundingBox())!;
  expect(survivor.y).toBeGreaterThan(400);

  // A stroke is an object like any other: selectable, and deletable from the
  // keyboard. The eraser is put away first, or the click would rub it out.
  await page.keyboard.press('v');
  await ink.first().click({ position: { x: 5, y: 5 }, force: true });
  await expect(page.getByRole('toolbar', { name: 'Selection toolbar' })).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(ink).toHaveCount(0);

  // …and undo brings it back, as one step.
  await page.keyboard.press('Meta+z');
  await expect(ink).toHaveCount(1);
});

test('the highlighter draws a wider, translucent stroke', async ({ page }) => {
  await signUp(page);
  await openBlankDiagram(page);

  await page.keyboard.press('Shift+B');
  await squiggle(page, { x: 420, y: 320 }, { x: 640, y: 320 });

  const ink = page.locator('[data-node-type="ink"]');
  await expect(ink).toHaveCount(1);
  await expect(ink.first()).toHaveAttribute('data-ink-kind', 'highlighter');
  await expect(ink.first().locator('path')).toHaveAttribute('stroke-opacity', '0.4');
});

test('a wipe across the middle of a line cuts it in two', async ({ page }) => {
  await signUp(page);
  await openBlankDiagram(page);
  const ink = page.locator('[data-node-type="ink"]');

  // A straight line is stored as two points once thinned, so this is the case
  // that needs the cut made at the eraser's edge rather than at a sample.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  for (let x = 420; x <= 700; x += 20) await page.mouse.move(x, 300);
  await page.mouse.up();
  await expect(ink).toHaveCount(1);

  // One quick vertical stroke of the eraser, two pointer moves.
  await page.keyboard.press('Shift+E');
  await page.mouse.move(550, 240);
  await page.mouse.down();
  await page.mouse.move(550, 360);
  await page.mouse.up();
  await expect(ink).toHaveCount(2);

  const [a, b] = await Promise.all([ink.nth(0).boundingBox(), ink.nth(1).boundingBox()]);
  const [left, right] = [a!, b!].sort((p, q) => p.x - q.x);
  expect(left.x).toBeLessThan(410);
  expect(left.x + left.width).toBeLessThan(550);
  expect(right.x).toBeGreaterThan(550);
  expect(right.x + right.width).toBeGreaterThan(690);
});
