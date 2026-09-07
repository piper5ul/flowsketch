import { expect, test, type Locator, type Page } from '@playwright/test';

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

/**
 * Picks one component out of the rail's wireframe grid and drops it on the
 * board.
 *
 * W opens the picker — Whimsical's key for changing board mode — rather than
 * arming a tool, because there is no single "wireframe" to place: which of the
 * fourteen is coming is the question the grid asks.
 */
async function placeWire(page: Page, pane: Locator, component: string, at: { x: number; y: number }) {
  await page.keyboard.press('w');
  const grid = page.getByRole('dialog', { name: 'Wireframe components' });
  await expect(grid).toBeVisible();
  await grid.getByRole('button', { name: component, exact: true }).click();
  await expect(grid).toBeHidden();
  await pane.click({ position: at });
}

test('the wireframe library places components, and their captions are ordinary labels', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await placeWire(page, pane, 'Button', { x: 320, y: 240 });

  const button = page.locator('[data-node-type="wire"][data-wire="button"]');
  await expect(button).toHaveCount(1);
  // Dropped with its default caption, and opened for typing: a button is
  // placed in order to be captioned.
  await expect(button).toContainText('Button');

  // Escape closes the editor the placement opened, and the caption survives it
  // — committing the same text is a no-op patch.
  await page.keyboard.press('Escape');
  await expect(button).toContainText('Button');

  await button.dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Sign in');
  await page.keyboard.press('Escape');
  await expect(button).toContainText('Sign in');
  await expect(button).not.toContainText('Button');

  // A second component out of the same grid. A browser chrome carries no label
  // of its own — it is chrome.
  await placeWire(page, pane, 'Browser', { x: 620, y: 380 });
  await expect(page.locator('[data-node-type="wire"][data-wire="browser"]')).toHaveCount(1);
  await expect(page.locator('[data-node-type="wire"]')).toHaveCount(2);

  // The caption is `data.label`, exactly as a shape's is, so canvas search
  // finds a wireframe component with no special case anywhere.
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('textbox', { name: 'Find on canvas' }).fill('Sign in');
  await expect(page.getByText('1 of 1')).toBeVisible();
});
