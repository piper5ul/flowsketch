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

async function boardWith(page: Page, label: string) {
  const id = await page.evaluate(async (label) => {
    const body = { title: 'Typing', data: { version: 3, nodes: [{ id: 'a', type: 'shape', position: { x: 300, y: 200 }, width: 200, height: 100, data: { label, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } };
    const r = await fetch('/api/diagrams', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return ((await r.json()) as { id: string }).id;
  }, label);
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  return page.locator('[data-id="a"] [contenteditable]');
}

test('typing into an empty shape shows the text once', async ({ page }) => {
  await signUp(page);
  const label = await boardWith(page, '');
  await page.locator('[data-id="a"]').dblclick();
  await page.keyboard.type('hello');
  await page.mouse.click(900, 600);
  await expect(label).toHaveText('hello');
  // And again, replacing everything that is there.
  await page.locator('[data-id="a"]').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('world');
  await page.mouse.click(900, 600);
  await expect(label).toHaveText('world');
});

test('editing an existing label keeps it once', async ({ page }) => {
  await signUp(page);
  const label = await boardWith(page, 'Runa');
  await page.locator('[data-id="a"]').dblclick();
  await page.keyboard.press('End');
  await page.keyboard.type(' Account');
  await page.mouse.click(900, 600);
  await expect(label).toHaveText('Runa Account');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(label).toHaveText('Runa');
});

test('a shape placed from the rail takes typed text once', async ({ page }) => {
  await signUp(page);
  await boardWith(page, 'x');
  await page.getByRole('button', { name: /^Rectangle/ }).first().click();
  await page.mouse.click(700, 500);
  await expect(page.locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('Clearing account');
  await page.mouse.click(1000, 650);
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  const labels = await page.locator('.react-flow__node [contenteditable]').allInnerTexts();
  expect(labels.filter((l) => l.includes('Clearing'))).toEqual(['Clearing account']);
});

test('a multi-line label and a Markdown one are shown once', async ({ page }) => {
  await signUp(page);
  const label = await boardWith(page, '');
  await page.locator('[data-id="a"]').dblclick();
  await page.keyboard.type('User\'s external bank');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('account');
  await page.mouse.click(900, 600);
  await expect(label).toHaveText("User's external bank\naccount", { useInnerText: true });
  await page.locator('[data-id="a"]').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('- one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('- two');
  await page.mouse.click(900, 600);
  await expect(label.getByRole('listitem')).toHaveText(['•one', '•two']);
});

test('a collaborator moving the shape mid-sentence does not duplicate or lose what is being typed', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Ada Lovelace');
  const label = await boardWith(page, '');
  await expect(page.locator('[data-collab-status="connected"]')).toBeVisible();

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestEmail = await signUp(guestPage, 'Grace Hopper');
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  await dialog.getByLabel('Invite by email').fill(guestEmail);
  await dialog.getByLabel('Invite as').selectOption('editor');
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(dialog.getByText(guestEmail)).toBeVisible();
  await page.getByRole('button', { name: 'Close share dialog' }).click();
  await guestPage.goto(page.url());
  await expect(guestPage.locator('[data-collab-status="connected"]')).toBeVisible();

  await page.locator('[data-id="a"]').dblclick();
  await page.keyboard.type('Clearing');

  // Grace drags the very shape Ada is typing in; Ada's window re-renders it.
  const box = (await guestPage.locator('[data-id="a"]').boundingBox())!;
  await guestPage.mouse.move(box.x + 20, box.y + 20);
  await guestPage.mouse.down();
  await guestPage.mouse.move(box.x + 60, box.y + 80, { steps: 8 });
  await guestPage.mouse.up();
  const moved = page.locator('[data-id="a"]');
  await expect.poll(async () => (await moved.boundingBox())!.y).toBeGreaterThan(box.y + 40);

  await page.keyboard.type(' account');
  await page.keyboard.press('Escape');
  await expect(label).toHaveText('Clearing account');
  await expect(guestPage.locator('[data-id="a"] [contenteditable]')).toHaveText('Clearing account');
  await guest.close();
});
