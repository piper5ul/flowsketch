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
 * "Set as board thumbnail": the dashboard card is rendered from the chosen
 * shapes rather than from the whole board, and "Remove from board thumbnail"
 * puts the whole board back.
 *
 * What is asserted is the *stored* picture, not the menu: the thumbnail is
 * written through `PUT /api/diagrams/:id` by the scheduler in `CanvasPage`, so
 * the diagram is read back and its PNG measured. Two shapes 1200 px apart make
 * the two answers unmistakable — the whole board is scaled down to the 480 px
 * thumbnail limit, one shape is nowhere near it.
 */
test('a shape can be set as the board thumbnail, and removed again', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const shape = (id: string, x: number) => ({
      id, type: 'shape', position: { x, y: 0 }, width: 180, height: 100,
      data: { label: id, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
    });
    const body = { title: 'Thumbnail', data: { version: 3, nodes: [shape('a', 0), shape('b', 1200)], edges: [] } };
    const r = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await r.json()) as { id: string }).id;
  });

  // The stored thumbnail's pixel size. PNG dimensions live in the IHDR chunk:
  // width at bytes 16-19, height at 20-23 — the same read as the export-options
  // test in `diagram.spec.ts`, done on the data URL the row holds.
  const thumbnailWidth = async () =>
    page.evaluate(async (diagramId) => {
      const r = await fetch(`/api/diagrams/${diagramId}`, { credentials: 'include' });
      const { thumbnail } = (await r.json()) as { thumbnail: string | null };
      if (!thumbnail) return 0;
      const bytes = Uint8Array.from(atob(thumbnail.split(',')[1]), (c) => c.charCodeAt(0));
      return new DataView(bytes.buffer).getUint32(16);
    }, id);

  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // Selecting a shape is an edit to `nodes`, which is what marks the thumbnail
  // stale; the first capture is taken straight away.
  const shape = page.locator('[data-id="a"]');
  await shape.click();
  // 1380 px of board scaled down to the 480 px thumbnail limit.
  await expect.poll(thumbnailWidth, { timeout: 20_000 }).toBeGreaterThan(400);

  await shape.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Canvas actions' });
  await menu.getByRole('menuitem', { name: 'Set as board thumbnail' }).click();
  await expect(page.getByText('Board thumbnail set')).toBeVisible();
  // One 180 px shape plus the export padding — well under the limit, so it is
  // not scaled at all.
  await expect.poll(thumbnailWidth, { timeout: 20_000 }).toBeLessThan(300);

  await shape.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Remove from board thumbnail' }).click();
  await expect(page.getByText('Board thumbnail cleared')).toBeVisible();
  await expect.poll(thumbnailWidth, { timeout: 20_000 }).toBeGreaterThan(400);
});
