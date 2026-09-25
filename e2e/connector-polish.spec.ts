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

test('the shape a connector would land on is outlined while it is being drawn', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const shape = (id: string, x: number) => ({
      id, type: 'shape', position: { x, y: 100 }, width: 200, height: 100,
      data: { label: id, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
    });
    const body = { title: 'Target outline', data: { version: 3, nodes: [shape('a', 100), shape('b', 600)], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } };
    const r = await fetch('/api/diagrams', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return ((await r.json()) as { id: string }).id;
  });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  const a = (await page.locator('[data-id="a"]').boundingBox())!;
  const b = (await page.locator('[data-id="b"]').boundingBox())!;

  await page.keyboard.press('a');
  await page.mouse.move(a.x + a.width * 0.5, a.y + a.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * 0.5, a.y + a.height + 80, { steps: 5 });
  await expect(page.locator('[data-connect-target]')).toHaveCount(0);
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 10 });
  await expect(page.locator('.react-flow__node[data-id="b"] [data-connect-target]')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('[data-connect-target]')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('a connector released on empty board keeps a free end that can be attached and freed again', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const shape = (id: string, x: number) => ({
      id, type: 'shape', position: { x, y: 100 }, width: 200, height: 100,
      data: { label: id, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
    });
    const body = { title: 'Free ends', data: { version: 3, nodes: [shape('a', 100), shape('b', 600)], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } };
    const r = await fetch('/api/diagrams', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return ((await r.json()) as { id: string }).id;
  });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  const a = (await page.locator('[data-id="a"]').boundingBox())!;
  const b = (await page.locator('[data-id="b"]').boundingBox())!;

  // Drawn out of A into nothing: no new box, one invisible anchor, and the
  // label open for typing.
  await page.keyboard.press('a');
  await page.mouse.move(a.x + a.width * 0.5, a.y + a.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * 0.5, a.y + a.height + 200, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('pulls');
  await page.mouse.click(a.x + 1000, a.y + 500);
  await page.screenshot({ path: 'test-results/free-end-1-drawn.png' });

  // Selected, its free end dragged onto B: attached, and the anchor gone.
  await page.getByText('pulls').click();
  const end = page.locator('.connector-joint--endpoint').nth(1);
  const e1 = (await end.boundingBox())!;
  await page.mouse.move(e1.x + e1.width / 2, e1.y + e1.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.6, { steps: 10 });
  await expect(page.locator('.react-flow__node[data-id="b"] [data-connect-target]')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/free-end-2-attached.png' });

  // And pulled off again into empty board, far from every shape: free, not
  // snapped onto whichever shape happens to be nearest.
  const e2 = (await page.locator('.connector-joint--endpoint').nth(1).boundingBox())!;
  await page.mouse.move(e2.x + e2.width / 2, e2.y + e2.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height + 250, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  // The toolbar faded out of the way for the drag, and is back once it ends.
  await expect(page.getByRole('toolbar', { name: 'Selection toolbar' }).locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/free-end-3-freed.png' });
});
