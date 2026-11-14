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

for (const kind of ['shape', 'table'] as const) {
  test(`restore discards an open ${kind} editor without committing its draft`, async ({ page }) => {
    await signUp(page);
    const id = await page.evaluate(async (kind) => {
      const send = async (path: string, method: string, body: unknown) => {
        const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`Setup failed: ${r.status}`);
        return r.json();
      };
      const data = (text: string) => ({
        version: 3,
        nodes: [{
          id: 'n1', type: kind, position: { x: 100, y: 100 }, width: 180, height: 100,
          data: { shape: 'rectangle', label: text, fill: '#FFFFFF', stroke: '#CBD5E1',
            ...(kind === 'table' ? { table: { columns: [{ width: 180 }], rows: [{ cells: [text] }], header: false } } : {}),
          },
        }],
        edges: [],
      });
      const diagram = await send('/api/diagrams', 'POST', { title: 'Editor cancellation', data: data('Snapshot') });
      await send(`/api/diagrams/${diagram.id}/versions`, 'POST', { label: 'Checkpoint' });
      await send(`/api/diagrams/${diagram.id}`, 'PUT', { data: data('Current') });
      return diagram.id as string;
    }, kind);
    await page.goto(`/d/${id}`);
    const node = page.locator('.react-flow__node').first();
    await expect(node).toContainText('Current');
    await expect(page.locator('[data-collab-sync="synced"]')).toBeVisible();
    await page.getByRole('button', { name: 'History' }).click();
    const panel = page.getByRole('dialog', { name: 'Version history' });
    const checkpoint = panel.getByRole('listitem').filter({ hasText: 'Checkpoint' });
    await checkpoint.getByRole('button', { name: 'Restore' }).click();

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let received!: () => void;
    const responseReady = new Promise<void>((resolve) => { received = resolve; });
    await page.route(`**/api/diagrams/${id}/versions/*/restore`, async (route) => {
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill({ response });
    });
    await panel.getByRole('button', { name: 'Restore this version' }).click();
    await responseReady;
    // A draft opened while the response is in flight must not commit on blur
    // or on EditableLabel's deferred unmount cleanup after the apply.
    if (kind === 'table') await node.locator('td').first().dblclick();
    else await node.dblclick();
    const editor = kind === 'table' ? node.locator('input') : node.locator('[contenteditable="true"]');
    await expect(editor).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Uncommitted draft');
    release();
    await expect(node).toContainText('Snapshot');
    await expect(editor).toHaveCount(0);
    await expect(panel.getByText('Before restore')).toBeVisible();
    await panel.getByRole('button', { name: 'Close history' }).click();
    await page.locator('.react-flow__pane').click({ position: { x: 700, y: 500 } });
    await page.keyboard.press('ControlOrMeta+z');
    // One undo gets the stored board; the cancelled draft is not an edit.
    await expect(node).toContainText('Current');
    await expect(node).not.toContainText('Uncommitted draft');
  });
}
