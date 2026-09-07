import { expect, test, type Page } from '@playwright/test';

/**
 * Creates a fresh account through the real sign-up form. Email verification is
 * not required to sign in, so this needs no mail server.
 */
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

/** Opens a new diagram and waits for its canvas. */
async function newDiagram(page: Page) {
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();
  return pane;
}

/** Where a node's box is on screen, so two nodes can be compared. */
async function boxOf(page: Page, label: string) {
  const box = await page.locator('.react-flow__node', { hasText: label }).first().boundingBox();
  if (!box) throw new Error(`no box for ${label}`);
  return box;
}

test('a mind map is typed: M, Tab, Enter, and ⌘/ folds a branch away', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);
  await pane.click({ position: { x: 300, y: 300 } });

  // M drops a root in the middle of the view, already open for typing — the
  // whole gesture is type, press, type.
  await page.keyboard.press('m');
  await expect(page.locator('[data-mind-map]')).toHaveCount(1);
  await page.keyboard.type('Root');

  // Tab makes a child of it, Enter a sibling of the child. Both are pressed
  // while the label of the node just made is still open.
  await page.keyboard.press('Tab');
  await page.keyboard.type('Child');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Sibling');
  await page.keyboard.press('Escape');

  await expect(page.locator('[data-mind-map]')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  for (const label of ['Root', 'Child', 'Sibling']) {
    await expect(page.locator('.react-flow__node', { hasText: label }).first()).toBeVisible();
  }

  // The map lays itself out: the two children sit to the right of the root and
  // one above the other.
  const root = await boxOf(page, 'Root');
  const child = await boxOf(page, 'Child');
  const sibling = await boxOf(page, 'Sibling');
  expect(child.x).toBeGreaterThan(root.x + root.width);
  expect(Math.round(sibling.x)).toBe(Math.round(child.x));
  expect(sibling.y).toBeGreaterThan(child.y + child.height);
  // …and the root is centred against them.
  expect(root.y + root.height / 2).toBeGreaterThan(child.y);
  expect(root.y + root.height / 2).toBeLessThan(sibling.y + sibling.height);

  // ⌘/ on the root folds both children away, and puts the count on the node.
  await page.locator('.react-flow__node', { hasText: 'Root' }).first().click();
  await page.keyboard.press('ControlOrMeta+/');
  await expect(page.locator('[data-mind-map]')).toHaveCount(1);
  await expect(page.locator('[data-mind-map="collapsed"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Expand branch' })).toHaveText('2');

  // Clicking the count unfolds it again.
  await page.getByRole('button', { name: 'Expand branch' }).click();
  await expect(page.locator('[data-mind-map]')).toHaveCount(3);

  // And it survives a reload: `collapsed` is stored, `hidden` is derived.
  await page.keyboard.press('ControlOrMeta+/');
  await expect(page.locator('[data-mind-map]')).toHaveCount(1);
  await expect(page.locator('[data-collab-sync="synced"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-mind-map]')).toHaveCount(1);
  await expect(page.locator('[data-mind-map="collapsed"]')).toHaveCount(1);
});
