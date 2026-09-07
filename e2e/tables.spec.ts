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

/** An empty diagram made through the API, opened and ready to draw on. */
async function openEmptyBoard(page: Page, title: string): Promise<void> {
  const id = await page.evaluate(async (boardTitle) => {
    const r = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: boardTitle, data: { version: 3, nodes: [], edges: [] } }),
    });
    return ((await r.json()) as { id: string }).id;
  }, title);
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  await page.locator('.react-flow__pane').click({ position: { x: 400, y: 300 } });
}

/**
 * Puts `text` on the system clipboard, from inside the page.
 *
 * Through a cast because the `navigator` this file's types know about is
 * Node's, which has no `clipboard` — the same reason `e2e/diagram.spec.ts`
 * casts in its own paste tests.
 */
async function writeClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (value) =>
      (navigator as unknown as { clipboard: { writeText(t: string): Promise<void> } }).clipboard.writeText(value),
    text,
  );
}

const tableNode = (page: Page) => page.locator('.react-flow__node [data-node-type="table"]');

test('E draws a 3×3 table, and its cells are typed into and tabbed through', async ({ page }) => {
  await signUp(page);
  await openEmptyBoard(page, 'Tables');

  await page.keyboard.press('e');
  await page.locator('.react-flow__pane').click({ position: { x: 420, y: 260 } });

  await expect(tableNode(page)).toHaveCount(1);
  await expect(tableNode(page).locator('tr')).toHaveCount(3);
  await expect(tableNode(page).locator('tr').first().locator('td')).toHaveCount(3);

  // Double-click opens a cell; Tab commits it and moves to the next one.
  const firstCell = tableNode(page).locator('tr').first().locator('td').first();
  await firstCell.dblclick();
  await page.keyboard.type('Name');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Role');
  await page.keyboard.press('Escape');

  await expect(tableNode(page).getByText('Name', { exact: true })).toBeVisible();
  await expect(tableNode(page).getByText('Role', { exact: true })).toBeVisible();
  // Nothing but the table: an open cell reports `editingNodeId`, so a letter
  // that is also a tool key ("m", the mind map) stays in the cell it was typed
  // into rather than reaching the canvas's keyboard handler.
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
});

test('the toolbar adds a row to the selected table', async ({ page }) => {
  await signUp(page);
  await openEmptyBoard(page, 'Table rows');

  await page.keyboard.press('e');
  await page.locator('.react-flow__pane').click({ position: { x: 420, y: 260 } });
  await expect(tableNode(page).locator('tr')).toHaveCount(3);

  await tableNode(page).click();
  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Add row' }).click();

  await expect(tableNode(page).locator('tr')).toHaveCount(4);

  // One click, one ⌘Z.
  await page.keyboard.press('Meta+z');
  await expect(tableNode(page).locator('tr')).toHaveCount(3);
});

test('a pasted Markdown table becomes a table with a header row', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signUp(page);
  await openEmptyBoard(page, 'Pasted table');

  await writeClipboard(page, '| Name | Role |\n| --- | --- |\n| Ada | Maths |\n| Alan | Machines |');

  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 300, y: 220 } });
  await page.getByRole('menuitem', { name: 'Paste as table' }).click();

  await expect(tableNode(page)).toHaveCount(1);
  await expect(tableNode(page).locator('tr')).toHaveCount(3);
  for (const cell of ['Name', 'Role', 'Ada', 'Maths', 'Alan', 'Machines']) {
    await expect(tableNode(page).getByText(cell, { exact: true })).toBeVisible();
  }

  // The `|---|` rule is what says the first row is a header, and the toolbar
  // reads it back as the pressed state of its own button.
  await tableNode(page).click();
  await expect(
    page.getByRole('toolbar', { name: 'Selection toolbar' }).getByRole('button', { name: 'Header row' }),
  ).toHaveClass(/bg-accent-500/);
});
