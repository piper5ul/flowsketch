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

/** A 64×64 checkerboard PNG, 165 bytes — small enough to inline. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAbElEQVR42u3XMQ0AIAxFQeQgAiUoQSKuwECZukC4hLEDN738svoMX20jfLfdFwAAAACAFOCVj57uAQAAAAByACUGAAAAsAeUGAAAAMAeUGIAAAAAe0CJAQAAAOwBJQYAAACwB5QYAAAA4BvABjVC6Vo+2hhHAAAAAElFTkSuQmCC';

/** Opens a new diagram and waits for its canvas. */
async function newDiagram(page: Page) {
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();
  return pane;
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

/**
 * Draws a rectangle and quick-adds a neighbour to its right, leaving exactly
 * two shapes joined by one horizontal connector.
 */
async function drawConnectedPair(page: Page) {
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();

  await page.keyboard.press('r');
  await pane.click({ position: { x: 500, y: 400 } });
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();

  // Quick-add buttons only appear while the shape is hovered. QUICK_ADD in
  // ShapeNode is ordered top, right, bottom, left — index 1 spawns to the right.
  await node.hover();
  await node.locator('.quick-add-btn').nth(1).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // A horizontal connector's path has a zero-height box, so callers drive the
  // mouse by coordinate rather than using Playwright's element-centre click.
  return (await page.locator('.react-flow__edge-interaction').first().boundingBox())!;
}

test('double-clicking a connector opens its label for editing', async ({ page }) => {
  await signUp(page);
  const edgeBox = await drawConnectedPair(page);

  // Click a quarter of the way along the path, clear of the add-label target
  // that appears at the midpoint once the connector is selected.
  const x = edgeBox.x + edgeBox.width * 0.25;
  const y = edgeBox.y + edgeBox.height / 2;
  await page.mouse.dblclick(x, y);
  await expect(page.locator('.react-flow__edgelabel-renderer [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('yes');
  await page.keyboard.press('Escape');

  await expect(page.locator('.react-flow__edgelabel-renderer').getByText('yes')).toBeVisible();
  // The double-click must edit the connector, not drop a text shape on the canvas.
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('a selected connector offers a click target for adding its first label', async ({ page }) => {
  await signUp(page);
  const edgeBox = await drawConnectedPair(page);

  await page.mouse.click(edgeBox.x + edgeBox.width * 0.25, edgeBox.y + edgeBox.height / 2);
  const addLabel = page.locator('.connector-label-target');
  await expect(addLabel).toBeVisible();

  await addLabel.click();
  await expect(page.locator('.react-flow__edgelabel-renderer [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('maybe');
  await page.keyboard.press('Escape');

  await expect(page.locator('.react-flow__edgelabel-renderer').getByText('maybe')).toBeVisible();
  // Once the connector has a label the bare target is gone.
  await expect(addLabel).toHaveCount(0);
});

test('a text shape grows to fit the paragraph typed into it', async ({ page }) => {
  await signUp(page);

  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();

  // Double-clicking empty canvas drops a text shape straight into edit mode.
  await pane.dblclick({ position: { x: 400, y: 250 } });
  await expect(page.locator('.react-flow__node [contenteditable="true"]')).toBeFocused();
  const lines = ['Line one', 'Line two', 'Line three', 'Line four', 'Line five'];
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.keyboard.press('Escape');

  // The canvas opens at 80%; reset it so the assertions are in node pixels.
  const zoomReset = page.getByRole('button', { name: 'Reset zoom' });
  await zoomReset.click();
  await expect(zoomReset).toHaveText('100%');

  const textNode = page.locator('.react-flow__node').first();
  await expect(textNode).toContainText('Line five');
  // Five lines at 14px with snug leading come to ~96px — well past the 40px
  // the shape is created at.
  const grown = (await textNode.boundingBox())!;
  expect(grown.height).toBeGreaterThan(90);

  // And nothing is clipped: the rendered text fits inside the node's box.
  const fitsInsideNode = await textNode.evaluate((el) => {
    const content = el.querySelector('[contenteditable]');
    if (!content) return false;
    return content.scrollHeight <= el.clientHeight + 1;
  });
  expect(fitsInsideNode).toBe(true);

  // A fresh single-line text shape keeps the compact default height.
  await pane.dblclick({ position: { x: 900, y: 250 } });
  await expect(page.locator('.react-flow__node [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('Short');
  await page.keyboard.press('Escape');
  const shortNode = page.locator('.react-flow__node', { hasText: 'Short' });
  const compact = (await shortNode.boundingBox())!;
  expect(compact.height).toBeLessThanOrEqual(48);
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

test('an edit made inside the autosave debounce window survives navigating away', async ({ page }) => {
  await signUp(page);

  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();

  await page.keyboard.press('r');
  await pane.click({ position: { x: 640, y: 400 } });
  const node = page.locator('.react-flow__node');
  await expect(node).toHaveCount(1);

  await node.dblclick();
  await page.keyboard.type('Saved on the way out');
  await page.keyboard.press('Escape');
  await expect(node).toContainText('Saved on the way out');

  // Leave immediately — inside the 2 s debounce, without waiting for "Saved".
  // The unmount must flush the pending save rather than drop it.
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();

  await page.getByText('Untitled').first().click();
  await expect(page.locator('.react-flow__node', { hasText: 'Saved on the way out' })).toBeVisible();
});

test('deleting a diagram from the dashboard asks for confirmation first', async ({ page }) => {
  await signUp(page);

  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  await page.getByRole('button', { name: 'Back to dashboard' }).click();

  const card = page.getByText('Untitled').first();
  await expect(card).toBeVisible();
  const menuButton = page.getByRole('button', { name: 'Diagram actions' });

  // Cancelling leaves the diagram alone.
  await card.hover();
  await menuButton.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Delete this diagram?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Delete this diagram?')).toBeHidden();
  await expect(card).toBeVisible();

  // Confirming removes it.
  await card.hover();
  await menuButton.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByRole('heading', { name: 'No diagrams yet' })).toBeVisible();
  await expect(page.getByText('Untitled')).toHaveCount(0);
});

test('a pasted image is uploaded and referenced by URL, not embedded as base64', async ({ page }) => {
  await signUp(page);
  await newDiagram(page);

  // Playwright cannot put an image on the OS clipboard, so the paste event is
  // synthesised with the same shape the browser would deliver.
  await page.evaluate(async (base64) => {
    // This file compiles without the DOM lib, so the browser-only globals are
    // reached through a narrow structural view of `globalThis`.
    const browser = globalThis as unknown as {
      document: { dispatchEvent: (event: unknown) => void };
      DataTransfer: new () => { items: { add: (file: unknown) => void } };
      ClipboardEvent: new (type: string, init: Record<string, unknown>) => unknown;
    };

    const res = await fetch(`data:image/png;base64,${base64}`);
    const file = new File([await res.blob()], 'tile.png', { type: 'image/png' });
    const data = new browser.DataTransfer();
    data.items.add(file);
    browser.document.dispatchEvent(
      new browser.ClipboardEvent('paste', { clipboardData: data, bubbles: true }),
    );
  }, TINY_PNG_BASE64);

  const image = page.locator('.react-flow__node img[src^="/api/images/"]');
  await expect(image).toHaveCount(1);
  // The image the server stored is what actually renders, not a data URL.
  await expect(image).toHaveJSProperty('complete', true);
  expect(await image.evaluate((el) => el.naturalWidth)).toBe(64);

  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__node img[src^="/api/images/"]')).toHaveCount(1);
});
