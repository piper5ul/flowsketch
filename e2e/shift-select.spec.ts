import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();
}

/** Three shapes in a row, the last two joined by a connector. */
async function openBoard(page: Page) {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const shape = (id: string, x: number) => ({
      id, type: 'shape', position: { x, y: 150 }, width: 160, height: 80,
      data: { label: id, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
    });
    const edge = {
      id: 'bc', source: 'b', target: 'c', type: 'connector',
      data: { connectorType: 'straight', sourceAnchor: { side: 'right', t: 0.5 }, targetAnchor: { side: 'left', t: 0.5 } },
    };
    const body = { title: 'Shift select', data: { version: 3, nodes: [shape('a', 100), shape('b', 400), shape('c', 800)], edges: [edge], viewport: { x: 0, y: 0, zoom: 1 } } };
    const r = await fetch('/api/diagrams', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return ((await r.json()) as { id: string }).id;
  });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
}

const selectedNodes = (page: Page) => page.locator('.react-flow__node.selected');

test('⇧-click toggles a shape or a connector in and out of the selection', async ({ page }) => {
  await openBoard(page);
  const a = page.locator('.react-flow__node[data-id="a"]');
  const b = page.locator('.react-flow__node[data-id="b"]');

  await a.click();
  await expect(selectedNodes(page)).toHaveCount(1);
  await b.click({ modifiers: ['Shift'] });
  await expect(selectedNodes(page)).toHaveCount(2);
  await expect(a).toHaveClass(/selected/);
  await expect(b).toHaveClass(/selected/);

  // Again on the same shape: out of the selection, the other left alone.
  await b.click({ modifiers: ['Shift'] });
  await expect(selectedNodes(page)).toHaveCount(1);
  await expect(a).toHaveClass(/selected/);

  // A connector joins the selection the same way.
  const line = page.locator('.react-flow__edge[data-id="bc"]');
  const box = (await line.locator('.react-flow__edge-path').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Shift');
  await expect(line).toHaveClass(/selected/);
  await expect(a).toHaveClass(/selected/);
});

test('⌘-click still toggles, and ⇧-drag still draws a selection box', async ({ page }) => {
  await openBoard(page);
  const a = page.locator('.react-flow__node[data-id="a"]');
  const b = page.locator('.react-flow__node[data-id="b"]');
  const mod = 'ControlOrMeta';

  await a.click();
  await b.click({ modifiers: [mod] });
  await expect(selectedNodes(page)).toHaveCount(2);
  await b.click({ modifiers: [mod] });
  await expect(selectedNodes(page)).toHaveCount(1);

  // Clear, then box-select the first two from empty board with ⇧ held.
  await page.mouse.click(1100, 600);
  await expect(selectedNodes(page)).toHaveCount(0);
  const aBox = (await a.boundingBox())!;
  const bBox = (await b.boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(aBox.x - 30, aBox.y - 30);
  await page.mouse.down();
  await page.mouse.move(bBox.x + bBox.width + 30, bBox.y + bBox.height + 30, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(selectedNodes(page)).toHaveCount(2);
});
