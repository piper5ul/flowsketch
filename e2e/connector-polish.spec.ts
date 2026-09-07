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
