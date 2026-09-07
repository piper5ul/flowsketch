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

test('the history panel scrubs through versions and forks one into a new diagram', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const r = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return r.json() as Promise<{ id: string }>;
    };
    const shape = (id: string, label: string) => ({ id, type: 'shape', position: { x: 100, y: 100 }, width: 180, height: 100, data: { label, shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' } });
    const diagram = await post('/api/diagrams', { title: 'Scrubbed', data: { version: 3, nodes: [shape('a', 'one')], edges: [] } });
    await post(`/api/diagrams/${diagram.id}/versions`, { label: 'First' });
    await post(`/api/diagrams/${diagram.id}/versions`, { label: 'Second' });
    return diagram.id;
  });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  await page.getByRole('button', { name: /^History/ }).click();
  const panel = page.getByRole('dialog', { name: 'Version history' });
  await expect(panel).toBeVisible();
  const scrub = panel.getByRole('group', { name: 'Scrub through versions' });
  await expect(scrub).toBeVisible();
  await expect(scrub).toContainText('2 / 2');

  await scrub.getByRole('button', { name: 'Older version' }).click();
  await expect(scrub).toContainText('1 / 2');
  await expect(scrub.getByRole('button', { name: 'Older version' })).toBeDisabled();

  await panel.getByRole('button', { name: 'Fork' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/d/(?!${id}$)[^/]+$`));
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Diagram title' })).toHaveValue(/\(fork\)/);
});
