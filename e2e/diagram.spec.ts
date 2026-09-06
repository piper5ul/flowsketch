import { expect, test, type Page } from '@playwright/test';

/**
 * Creates a fresh account through the real sign-up form. Email verification is
 * not required to sign in, so this needs no mail server.
 */
async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();
  return email;
}

test('unauthenticated visitors are sent to the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('a new user can create a diagram, add a labeled shape, and see it survive a reload', async ({ page }) => {
  await signUp(page);

  // A fresh account shows two "New Diagram" buttons (header + empty state).
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();

  // R selects the rectangle tool; clicking the canvas places one.
  await page.keyboard.press('r');
  await pane.click({ position: { x: 640, y: 400 } });
  const node = page.locator('.react-flow__node');
  await expect(node).toHaveCount(1);

  // Double-click to edit, type, Escape to commit.
  await node.dblclick();
  await page.keyboard.type('Hello from e2e');
  await page.keyboard.press('Escape');
  await expect(node).toContainText('Hello from e2e');

  // Autosave is debounced; wait for the indicator rather than a fixed sleep.
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(page.locator('.react-flow__node', { hasText: 'Hello from e2e' })).toBeVisible();
});

test('the dashboard lists a created diagram and can open it again', async ({ page }) => {
  await signUp(page);

  // A fresh account shows two "New Diagram" buttons (header + empty state).
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const url = page.url();

  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();
  await page.getByText('Untitled').first().click();
  await expect(page).toHaveURL(url);
});
