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

test('a label typed as Markdown renders as a list once editing ends, and shows its source again to edit', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();
  await page.keyboard.press('r');
  await pane.click({ position: { x: 500, y: 400 } });
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();

  await node.dblclick();
  await page.keyboard.type('# Plan');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('- **one**');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('- two');
  await page.keyboard.press('Escape');

  const rendered = node.getByTestId('markdown-label');
  await expect(rendered).toBeVisible();
  await expect(rendered.getByRole('heading')).toHaveText('Plan');
  await expect(rendered.getByRole('listitem')).toHaveCount(2);
  await expect(rendered.locator('strong')).toHaveText('one');

  // Editing again shows the source, markers and all.
  await node.dblclick();
  await expect(node.getByTestId('markdown-label')).toHaveCount(0);
  await expect(node.locator('[contenteditable="true"]')).toContainText('- **one**');
});
