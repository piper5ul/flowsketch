import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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

/** A 64×64 checkerboard PNG, 165 bytes — small enough to inline. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAbElEQVR42u3XMQ0AIAxFQeQgAiUoQSKuwECZukC4hLEDN738svoMX20jfLfdFwAAAACAFOCVj57uAQAAAAByACUGAAAAsAeUGAAAAMAeUGIAAAAAe0CJAQAAAOwBJQYAAACwB5QYAAAA4BvABjVC6Vo+2hhHAAAAAElFTkSuQmCC';

/**
 * Draws one labelled rectangle on the open canvas and waits for it to be saved,
 * so a second reader of the same diagram is guaranteed to see it.
 */
async function drawLabelledShape(page: Page, pane: Locator, label: string) {
  await page.keyboard.press('r');
  await pane.click({ position: { x: 640, y: 400 } });
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await node.dblclick();
  await page.keyboard.type(label);
  await page.keyboard.press('Escape');
  await expect(node).toContainText(label);
  await expect(page.getByText('Saved')).toBeVisible();
  return node;
}

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

test('the selection toolbar aligns, distributes and bolds a multi-selection', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  // Three rectangles at different heights and uneven horizontal gaps. The tool
  // falls back to select after each placement, so R is pressed each time.
  for (const position of [{ x: 300, y: 300 }, { x: 520, y: 340 }, { x: 800, y: 290 }]) {
    await page.keyboard.press('r');
    await pane.click({ position });
  }
  const nodes = page.locator('.react-flow__node');
  await expect(nodes).toHaveCount(3);

  await page.keyboard.press('Meta+a');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);

  /** The three nodes' boxes, left to right. */
  async function boxes() {
    const measured = await Promise.all((await nodes.all()).map(async (n) => (await n.boundingBox())!));
    return measured.sort((a, b) => a.x - b.x);
  }

  await page.getByRole('button', { name: 'Arrange' }).click();
  await page.getByRole('button', { name: 'Align top' }).click();

  await expect
    .poll(async () => {
      const [a, b, c] = await boxes();
      return Math.max(Math.abs(a.y - b.y), Math.abs(b.y - c.y));
    })
    .toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Distribute horizontally' }).click();

  await expect
    .poll(async () => {
      const [a, b, c] = await boxes();
      return Math.abs((b.x - (a.x + a.width)) - (c.x - (b.x + b.width)));
    })
    .toBeLessThanOrEqual(1);

  // Close the popover by toggling its trigger — Escape would reach the canvas.
  await page.getByRole('button', { name: 'Arrange' }).click();

  // Text formatting on the selection toolbar applies to every selected node.
  await page.getByRole('button', { name: 'Bold' }).click();
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('.react-flow__node [contenteditable]').nth(i)).toHaveCSS('font-weight', '700');
  }
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

test('a diagram can be renamed, duplicated and found again by searching', async ({ page }) => {
  await signUp(page);
  await newDiagram(page);
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();

  const card = page.getByText('Untitled').first();
  await card.hover();
  await page.getByRole('button', { name: 'Diagram actions' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();

  const titleInput = page.getByRole('textbox', { name: 'Diagram title' });
  await titleInput.fill('Roadmap');
  await titleInput.press('Enter');
  await expect(page.getByText('Roadmap', { exact: true })).toBeVisible();

  const renamed = page.getByText('Roadmap', { exact: true });
  await renamed.hover();
  await page.getByRole('button', { name: 'Diagram actions' }).first().click();
  await page.getByRole('button', { name: 'Duplicate' }).click();

  await expect(page.getByText('Roadmap (copy)')).toBeVisible();
  await expect(page.getByText('Roadmap', { exact: true })).toBeVisible();

  // The rename survives a round trip, rather than only living in the page.
  await page.reload();
  await expect(page.getByText('Roadmap (copy)')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search diagrams' }).fill('copy');
  await expect(page.getByText('Roadmap (copy)')).toBeVisible();
  await expect(page.getByText('Roadmap', { exact: true })).toHaveCount(0);
});

test('a diagram card offers its star by name, and the star sticks', async ({ page }) => {
  await signUp(page);
  await newDiagram(page);
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();

  // Icon-only, so the accessible name is all a screen reader (or this test) has
  // to go on. Named exactly, because the sidebar's "Starred" view is a button
  // too and a loose match would find that one first.
  const star = page.getByRole('button', { name: 'Star diagram', exact: true });
  await expect(star).toHaveAttribute('aria-pressed', 'false');

  await star.click();
  const unstar = page.getByRole('button', { name: 'Unstar diagram', exact: true });
  await expect(unstar).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Unstar diagram', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a diagram exported as JSON can be imported back from the dashboard', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await page.keyboard.press('r');
  await pane.click({ position: { x: 500, y: 350 } });
  const node = page.locator('.react-flow__node');
  await expect(node).toHaveCount(1);
  await node.dblclick();
  await page.keyboard.type('Exported shape');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Saved')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export' }).click();
      await page.getByRole('button', { name: 'Export as JSON' }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toBe('Untitled.json');
  const file = await download.path();

  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import' }).click(),
  ]);
  await chooser.setFiles(file);

  // The import opens the new diagram, holding the shape the file described.
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  await expect(page.locator('.react-flow__node', { hasText: 'Exported shape' })).toBeVisible();

  // And it is a second diagram, not the one that was exported.
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(page.getByText('Untitled', { exact: true })).toHaveCount(2);
});

test('exporting as SVG writes a self-contained document holding the diagram', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await page.keyboard.press('r');
  await pane.click({ position: { x: 500, y: 350 } });
  const node = page.locator('.react-flow__node');
  await expect(node).toHaveCount(1);
  await node.dblclick();
  await page.keyboard.type('Vector shape');
  await page.keyboard.press('Escape');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export' }).click();
      await page.getByRole('button', { name: 'Export as SVG' }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toBe('Untitled.svg');

  const svg = await readFile((await download.path())!, 'utf8');
  expect(svg.startsWith('<svg')).toBe(true);
  // The background is painted in the SVG's own coordinates, not on the
  // transformed clone, so it covers the whole document.
  expect(svg).toContain('<rect width="100%" height="100%"');
  expect(svg).toContain('Vector shape');
  // Self-contained: nothing to fetch when the file is opened on its own.
  expect(svg).not.toMatch(/(src|href)="(?!data:|#)/);
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

test('the rail\'s image button inserts a picked file, and it survives a reload', async ({ page }) => {
  await signUp(page);
  await newDiagram(page);

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Insert image' }).click(),
  ]);
  await chooser.setFiles({
    name: 'tile.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });

  const image = page.locator('.react-flow__node img[src^="/api/images/"]');
  await expect(image).toHaveCount(1);
  await expect(image).toHaveJSProperty('complete', true);

  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__node img[src^="/api/images/"]')).toHaveCount(1);
});

test('an image dropped onto the canvas lands where it was dropped', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  // An empty diagram frames itself the moment its first node appears, which
  // would move the dropped image out from under the drop point. One shape up
  // front gets that out of the way.
  await page.keyboard.press('r');
  await pane.click({ position: { x: 900, y: 500 } });
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  // A real OS drag cannot be driven from Playwright, so the drop event carries
  // a DataTransfer built in the page.
  const dataTransfer = await page.evaluateHandle(async (base64) => {
    const browser = globalThis as unknown as {
      DataTransfer: new () => { items: { add: (file: unknown) => void } };
    };
    const res = await fetch(`data:image/png;base64,${base64}`);
    const data = new browser.DataTransfer();
    data.items.add(new File([await res.blob()], 'tile.png', { type: 'image/png' }));
    return data;
  }, TINY_PNG_BASE64);

  const box = (await pane.boundingBox())!;
  const drop = { x: box.x + 300, y: box.y + 200 };
  await pane.dispatchEvent('drop', { dataTransfer, clientX: drop.x, clientY: drop.y });

  const image = page.locator('.react-flow__node img[src^="/api/images/"]');
  await expect(image).toHaveCount(1);

  // It lands under the pointer, not at the centre of the viewport.
  const dropped = (await image.boundingBox())!;
  expect(Math.abs(dropped.x + dropped.width / 2 - drop.x)).toBeLessThan(20);
  expect(Math.abs(dropped.y + dropped.height / 2 - drop.y)).toBeLessThan(20);
});

test('pressing ? opens the shortcut cheat sheet, and Escape closes it', async ({ page }) => {
  await signUp(page);
  await newDiagram(page);

  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  // The sheet is generated from the registry, so a known command has to be in it.
  await expect(sheet.getByText('Undo', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('right-clicking a shape opens a context menu that deletes it', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await page.keyboard.press('r');
  await pane.click({ position: { x: 640, y: 400 } });
  const node = page.locator('.react-flow__node');
  await expect(node).toHaveCount(1);

  // Right-clicking an unselected shape selects it, then acts on it.
  await node.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Canvas actions' });
  await expect(menu).toBeVisible();

  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(menu).toBeHidden();
});

test('a diagram reopens at the zoom it was left at', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  // One shape, saved, so the frame-on-first-node is over and done with before
  // the viewport under test is set.
  await page.keyboard.press('r');
  await pane.click({ position: { x: 640, y: 400 } });
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.getByText('Saved')).toBeVisible();

  const zoomReset = page.getByRole('button', { name: 'Reset zoom' });
  const opened = await zoomReset.textContent();

  // The autosave the zoom triggers, rather than a timeout: the thumbnail save
  // goes to the same route, so the body is what tells the two apart.
  const viewportSaved = page.waitForResponse((response) => {
    if (response.request().method() !== 'PUT' || !response.ok()) return false;
    const body = response.request().postDataJSON() as { data?: { viewport?: unknown } } | null;
    return !!body?.data?.viewport;
  });

  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  await zoomIn.click();
  await zoomIn.click();
  await viewportSaved;

  const zoomed = await zoomReset.textContent();
  expect(zoomed).not.toBe(opened);

  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  // Restored from the diagram, not re-framed: fitView would put it back to the
  // zoom the diagram opened at.
  await expect(zoomReset).toHaveText(zoomed!);
});

test('the minimap is off until it is switched on, and is still on after a reload', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  // Something to see on the map, so "visible" means it actually drew.
  await page.keyboard.press('r');
  await pane.click({ position: { x: 640, y: 400 } });
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  const minimap = page.locator('.react-flow__minimap');
  await expect(minimap).toBeHidden();

  await page.getByRole('button', { name: 'Minimap' }).click();
  await expect(minimap).toBeVisible();

  // The preference lives in localStorage, not in the diagram, so it survives
  // the reload without a save.
  await page.reload();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
});

test('X selects the hexagon tool', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await page.keyboard.press('x');
  await pane.click({ position: { x: 640, y: 400 } });

  const node = page.locator('.react-flow__node');
  await expect(node).toHaveCount(1);
  await expect(node.locator('[data-shape="hexagon"]')).toHaveCount(1);
});

/**
 * Selects the one connector `drawConnectedPair` drew, by clicking a quarter of
 * the way along it — clear of the add-label target that appears at its
 * midpoint once it is selected.
 */
async function selectConnector(page: Page) {
  const box = await drawConnectedPair(page);
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: 'End arrowhead' })).toBeVisible();
  return page.locator('.react-flow__edge-path').first();
}

test('the toolbar redraws a connector as a curve', async ({ page }) => {
  await signUp(page);
  const edgePath = await selectConnector(page);

  // The pair is drawn as an elbow, and quick-add aligns the two shapes, so the
  // route it starts with is one straight run with no curve in it.
  await expect(edgePath).not.toHaveAttribute('d', /[CQ]/);

  await page.getByRole('button', { name: 'Curved line' }).click();
  // A curve is a cubic, or a quadratic once a bend has been dragged onto it.
  await expect(edgePath).toHaveAttribute('d', /[CQ]/);
});

test('the toolbar swaps a connector\'s end arrowhead for a circle', async ({ page }) => {
  await signUp(page);
  const edgePath = await selectConnector(page);

  await expect(edgePath).toHaveAttribute('marker-end', /arrow/);

  await page.getByRole('button', { name: 'End arrowhead' }).click();
  await page.getByRole('button', { name: 'Circle', exact: true }).click();

  // The marker is one this app defines — React Flow has no circle of its own.
  await expect(edgePath).toHaveAttribute('marker-end', /^url\(['"]?#fs-circle-/);

  // Assert the def this path actually points at, rather than counting every
  // circle on the page: `markerDefsForEdges` renders one def per style/colour/
  // size, so a global count also sees defs on their way out and races their
  // unmount. `expect.poll` re-reads the attribute, since the id changes with
  // the connector's colour and width.
  await expect
    .poll(async () => {
      const ref = (await edgePath.getAttribute('marker-end')) ?? '';
      const markerId = ref.replace(/^url\(['"]?#/, '').replace(/['"]?\)$/, '');
      return page.locator(`marker[id="${markerId}"]`).count();
    })
    .toBe(1);
});

/**
 * Drags an element from the centre of its box by (dx, dy). React only sees a
 * drag if it sees the moves, so the pointer travels in steps rather than
 * jumping, and the press and release are separate events either side of them.
 */
async function dragBy(page: Page, target: Locator, dx: number, dy: number) {
  const box = (await target.boundingBox())!;
  const fromX = box.x + box.width / 2;
  const fromY = box.y + box.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await page.mouse.move(fromX + dx * step, fromY + dy * step);
  }
  await page.mouse.up();
}

test('a connector collects bends: drag a run to add one, double-click it to drop it', async ({ page }) => {
  await signUp(page);
  await selectConnector(page);

  const bends = page.locator('.connector-joint--bend');
  const runs = page.locator('.connector-joint--segment');
  // The pair is joined by one straight run, and nobody has bent it yet.
  await expect(runs).toHaveCount(1);
  await expect(bends).toHaveCount(0);

  // Dragging the run's handle down drops a bend under the pointer, and the
  // route now turns: the two runs either side of the bend get handles of
  // their own.
  await dragBy(page, runs.first(), 0, 60);
  await expect(bends).toHaveCount(1);
  await expect(runs).not.toHaveCount(1);

  // The bend itself is draggable, and taking it further leaves the connector
  // still bent exactly once.
  const runsAfterInsert = await runs.count();
  await dragBy(page, bends.first(), 0, 40);
  await expect(bends).toHaveCount(1);
  await expect(runs).not.toHaveCount(0);

  // Double-clicking the bend drops it, and the route goes back to being one
  // run between the two shapes.
  const bendBox = (await bends.first().boundingBox())!;
  await page.mouse.dblclick(bendBox.x + bendBox.width / 2, bendBox.y + bendBox.height / 2);
  await expect(bends).toHaveCount(0);
  await expect(runs).toHaveCount(1);
  expect(runsAfterInsert).toBeGreaterThan(1);
});

test('the colour palette hides for an image-only selection and comes back for a mixed one', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  // A shape first: an empty diagram frames itself when its first node appears,
  // which would move the image out from under the assertions below.
  await page.keyboard.press('r');
  await pane.click({ position: { x: 240, y: 180 } });
  const rect = page.locator('.react-flow__node').first();
  await expect(rect).toBeVisible();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Insert image' }).click(),
  ]);
  await chooser.setFiles({
    name: 'tile.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  const image = page.locator('.react-flow__node img[src^="/api/images/"]');
  await expect(image).toHaveCount(1);

  // An image has no fill or stroke of its own, so selecting one alone offers
  // no colours — but the rest of the toolbar is still there.
  await image.click();
  await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Color' })).toHaveCount(0);

  // Add the shape to the selection and the palette returns: it has something
  // to colour again. Select-all rather than a shift-click, because the inserted
  // image lands in the middle of the viewport and can sit over the rectangle.
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByRole('button', { name: 'Color' })).toBeVisible();
});

test('a shape can be swapped from the toolbar and a new kind drawn from the rail', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await page.keyboard.press('r');
  await pane.click({ position: { x: 400, y: 300 } });
  const rect = page.locator('.react-flow__node').first();
  await expect(rect).toBeVisible();

  // The floating toolbar's Shape button redraws what is already there. The
  // rail carries the same labels, so the popover has to be the scope.
  await rect.click();
  await page.getByRole('button', { name: 'Shape', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Shape picker' });
  await picker.getByRole('button', { name: 'Star' }).click();

  const star = rect.locator('[data-shape="star"]');
  await expect(star).toHaveCount(1);
  // A star is one of the shapes drawn as a filled outline rather than a box.
  await expect(star.locator('svg path')).toHaveCount(1);

  // The rail's "More shapes" menu picks a tool, which then draws on click.
  await page.getByRole('button', { name: 'More shapes' }).click();
  await page.getByRole('dialog', { name: 'More shapes' }).getByRole('button', { name: 'Cloud' }).click();
  await pane.click({ position: { x: 900, y: 300 } });

  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__node [data-shape="cloud"]')).toHaveCount(1);
});

test('the Style popover shadows and fades a shape', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await page.keyboard.press('r');
  await pane.click({ position: { x: 400, y: 300 } });
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await node.click();

  // The shadow is the wrapper's own; the selection ring lives on the box inside
  // it, so an unshadowed wrapper really is bare.
  const shape = node.locator('.shape-wrapper');
  await expect(shape).toHaveCSS('box-shadow', 'none');

  await page.getByRole('button', { name: 'Style' }).click();
  const stylePanel = page.getByRole('dialog', { name: 'Style' });
  await stylePanel.getByRole('button', { name: 'Drop shadow' }).click();
  await expect(shape).not.toHaveCSS('box-shadow', 'none');

  // A range input set without a pointer commits as its own edit rather than
  // waiting for a drag that never happens.
  await stylePanel.getByLabel('Opacity').fill('0.5');
  await expect(shape).toHaveCSS('opacity', '0.5');
});

test('the format bar underlines a label being edited', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await page.keyboard.press('r');
  await pane.click({ position: { x: 400, y: 300 } });
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();

  await node.dblclick();
  await page.keyboard.type('Hi');
  await page.getByRole('button', { name: 'Underline' }).click();
  await page.keyboard.press('Escape');

  await expect(node).toContainText('Hi');
  await expect(node.locator('[contenteditable]')).toHaveCSS('text-decoration-line', 'underline');
});

test('a second tab editing the same diagram is caught before its work is overwritten', async ({ page, context }) => {
  // Two pages, three debounced saves and a refused fourth: give it more than the default budget.
  test.setTimeout(90_000);
  await signUp(page);
  const pane = await newDiagram(page);

  await page.keyboard.press('r');
  await pane.click({ position: { x: 400, y: 300 } });
  const first = page.locator('.react-flow__node').first();
  await first.dblclick();
  await page.keyboard.type('First tab');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Saved')).toBeVisible();

  // The same diagram, in the same session, in a second tab.
  const second = await context.newPage();
  await second.goto(page.url());
  const secondPane = second.locator('.react-flow__pane');
  await expect(secondPane).toBeVisible();
  await expect(second.locator('.react-flow__node').first()).toContainText('First tab');

  await second.keyboard.press('r');
  await secondPane.click({ position: { x: 800, y: 300 } });
  const added = second.locator('.react-flow__node').nth(1);
  await added.dblclick();
  await second.keyboard.type('Second tab');
  await second.keyboard.press('Escape');
  await expect(second.getByText('Saved')).toBeVisible();

  // Back to the first tab, the way the user would switch to it. Explicit
  // because a background tab has its animation frames throttled by the
  // browser, and every actionability check Playwright makes on it waits on
  // one — which is what left this test a few seconds off its own timeout.
  await page.bringToFront();

  // The first tab is now building on a version the server has moved past, so
  // its next autosave is refused rather than silently dropping "Second tab".
  await first.dblclick();
  await page.keyboard.type(' edited');
  await page.keyboard.press('Escape');
  const banner = page.getByRole('alert').filter({ hasText: 'changed in another tab' });
  await expect(banner).toBeVisible();

  // Reload takes the other tab's version, discarding this one's unsaved edit.
  await banner.getByRole('button', { name: 'Reload' }).click();
  await expect(banner).toBeHidden();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__node').nth(1)).toContainText('Second tab');

  await second.close();
});

test('a public link opens the diagram read-only, and revoking it kills the URL', async ({ page, browser }) => {
  await signUp(page);
  const pane = await newDiagram(page);
  await drawLabelledShape(page, pane, 'Public shape');

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  await expect(dialog).toBeVisible();
  // `click`, not `check`: the box reflects what the server says, so it only
  // ticks once `POST …/share` has answered with a token.
  await dialog.getByLabel('Anyone with the link can view').click();
  await expect(dialog.getByLabel('Public link')).toBeVisible();

  const link = await dialog.getByLabel('Public link').inputValue();
  expect(link).toMatch(/\/s\/[^/]+$/);

  // A brand new context: no cookies, so nobody is signed in to anything.
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(link);

  await expect(visitorPage.locator('.react-flow__node', { hasText: 'Public shape' })).toBeVisible();
  await expect(visitorPage.getByText('View only')).toBeVisible();
  // Read-only means the drawing tools are not there at all, not merely inert.
  await expect(visitorPage.getByRole('button', { name: 'Rectangle' })).toHaveCount(0);

  // Turning the link off leaves the old URL pointing at nothing.
  await dialog.getByRole('button', { name: 'Turn off' }).click();
  await expect(dialog.getByLabel('Public link')).toHaveCount(0);

  await visitorPage.reload();
  await expect(visitorPage.getByText('This link is no longer active')).toBeVisible();
  await expect(visitorPage.locator('.react-flow__node')).toHaveCount(0);

  await visitor.close();
});

test('an invited editor finds the diagram, edits it, and loses that when demoted', async ({ page, browser }) => {
  await signUp(page);
  const pane = await newDiagram(page);
  await drawLabelledShape(page, pane, 'Owner shape');
  const diagramUrl = page.url();

  // A second account, in its own context so the two sessions never mix.
  const invitee = await browser.newContext();
  const inviteePage = await invitee.newPage();
  const inviteeEmail = await signUp(inviteePage);

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  await dialog.getByLabel('Invite by email').fill(inviteeEmail);
  await dialog.getByLabel('Invite as').selectOption('editor');
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(dialog.getByText(inviteeEmail)).toBeVisible();

  // It is not theirs, so it lands in its own section rather than among their own.
  await inviteePage.goto('/');
  await expect(inviteePage.getByRole('heading', { name: 'Shared with me' })).toBeVisible();
  await expect(inviteePage.getByText('Can edit')).toBeVisible();
  await inviteePage.getByText('Untitled').first().click();
  await expect(inviteePage).toHaveURL(/\/d\/[^/]+$/);

  // An editor edits: the second shape is saved under their own session.
  const inviteePane = inviteePage.locator('.react-flow__pane');
  await expect(inviteePane).toBeVisible();
  await expect(inviteePage.locator('.react-flow__node')).toHaveCount(1);
  await inviteePage.keyboard.press('r');
  await inviteePane.click({ position: { x: 900, y: 260 } });
  await expect(inviteePage.locator('.react-flow__node')).toHaveCount(2);
  await expect(inviteePage.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // Demoted to viewer, their next load of the same diagram is read-only.
  await page.getByRole('button', { name: 'Share' }).click();
  await dialog.getByLabel(`Role for ${inviteeEmail}`).selectOption('viewer');
  await expect(dialog.getByLabel(`Role for ${inviteeEmail}`)).toHaveValue('viewer');

  await inviteePage.reload();
  await expect(inviteePage.getByText('View only')).toBeVisible();
  await expect(inviteePage.getByRole('button', { name: 'Rectangle' })).toHaveCount(0);
  // And the board is still there to read — this is a demotion, not a removal.
  await expect(inviteePage.locator('.react-flow__node')).toHaveCount(2);

  expect(page.url()).toBe(diagramUrl);
  await invitee.close();
});

test('two people on one diagram see each other, their pointers and their selections', async ({ page, browser }) => {
  // Distinct names, because the whole of what presence shows is who: the
  // avatars, the label on a cursor and the tooltip are all the name.
  await signUp(page, 'Ada Lovelace');
  const pane = await newDiagram(page);
  const node = await drawLabelledShape(page, pane, 'Shared shape');

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestEmail = await signUp(guestPage, 'Grace Hopper');

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  await dialog.getByLabel('Invite by email').fill(guestEmail);
  await dialog.getByLabel('Invite as').selectOption('editor');
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(dialog.getByText(guestEmail)).toBeVisible();
  // Out of the way: it covers the canvas the cursor is about to move over.
  await page.getByRole('button', { name: 'Close share dialog' }).click();

  await guestPage.goto(page.url());
  const guestPane = guestPage.locator('.react-flow__pane');
  await expect(guestPane).toBeVisible();

  // Each sees the other in the top bar, and is told the socket is live.
  // `exact`, because a cursor is labelled "<name>'s cursor" and one of these
  // two is about to have one on screen.
  await expect(page.getByLabel('Grace Hopper', { exact: true })).toHaveText('GH');
  await expect(guestPage.getByLabel('Ada Lovelace', { exact: true })).toHaveText('AL');
  await expect(page.locator('[data-collab-status="connected"]')).toBeVisible();
  await expect(guestPage.locator('[data-collab-status="connected"]')).toBeVisible();

  // Grace moves her pointer across the board; Ada sees it, labelled.
  await guestPane.hover({ position: { x: 500, y: 300 } });
  await guestPane.hover({ position: { x: 560, y: 340 } });
  const guestCursor = page.locator('.presence-cursor');
  await expect(guestCursor).toHaveCount(1);
  await expect(guestCursor).toContainText('Grace Hopper');

  // Ada's selection, seen from Grace's window. Cleared first, so what is
  // asserted is the selection arriving rather than one that was already there.
  const guestView = guestPage.locator('.react-flow__node').first();
  await pane.click({ position: { x: 200, y: 500 } });
  await expect(guestView.locator('[data-peer-selected]')).toHaveCount(0);

  await node.click();
  await expect(guestView.locator('[data-peer-selected="Ada Lovelace"]')).toBeVisible();

  // And it goes away again when she lets go of it.
  await pane.click({ position: { x: 200, y: 500 } });
  await expect(guestView.locator('[data-peer-selected]')).toHaveCount(0);

  // Leaving takes the cursor and the avatar with it, rather than stranding a
  // pointer on the board for as long as the tab that drew it is closed.
  await guest.close();
  await expect(page.locator('.presence-cursor')).toHaveCount(0);
  await expect(page.getByLabel('Grace Hopper', { exact: true })).toHaveCount(0);
});

test('a labelled snapshot can be taken and restored from the history panel', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);
  const node = await drawLabelledShape(page, pane, 'Version one');

  await page.getByRole('button', { name: 'History' }).click();
  const panel = page.getByRole('dialog', { name: 'Version history' });
  await expect(panel).toBeVisible();

  await panel.getByLabel('Snapshot label').fill('Checkpoint');
  await panel.getByRole('button', { name: 'Snapshot now' }).click();
  const checkpoint = panel.getByRole('listitem').filter({ hasText: 'Checkpoint' });
  await expect(checkpoint).toHaveCount(1);

  // Preview fetches the version's body and draws it from that version's own
  // coordinates — one shape, at this point in the diagram's life.
  await checkpoint.getByRole('button', { name: 'Preview' }).click();
  const preview = checkpoint.getByRole('img', { name: 'Version preview' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('rect')).toHaveCount(1);
  await checkpoint.getByRole('button', { name: 'Preview' }).click();
  await expect(preview).toHaveCount(0);

  // The panel covers the right of the canvas, so it goes away while the board
  // is edited and comes back to do the restore.
  await panel.getByRole('button', { name: 'Close history' }).click();
  await expect(panel).toBeHidden();

  await node.dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Version two');
  await page.keyboard.press('Escape');
  await expect(node).toContainText('Version two');
  await expect(page.getByText('Saved')).toBeVisible();

  await page.getByRole('button', { name: 'History' }).click();
  await checkpoint.getByRole('button', { name: 'Restore' }).click();
  await expect(panel.getByText('Your current state is saved first')).toBeVisible();
  await panel.getByRole('button', { name: 'Restore this version' }).click();

  // The board goes back to the snapshot...
  await expect(page.locator('.react-flow__node').first()).toContainText('Version one');
  // ...and what it replaced is itself now a version, so the restore is undoable.
  await expect(panel.getByText('Before restore')).toBeVisible();

  // The restore wrote the row, and the client's conflict guard followed it —
  // an edit straight afterwards saves rather than colliding with that write.
  await page.locator('.react-flow__node').first().dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Version three');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

/** The light canvas token. Nothing in dark mode may still be wearing it. */
const LIGHT_CANVAS = 'rgb(246, 247, 251)';
/** `--canvas` and `--canvas-dot` in the dark theme, and the default shape fill. */
const DARK_CANVAS = 'rgb(13, 14, 19)';
const DARK_CANVAS_DOT = 'rgb(48, 52, 70)';
const DEFAULT_SHAPE_FILL = 'rgb(219, 234, 254)';

test('dark mode follows the system, can be pinned, and never repaints the diagram itself', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signUp(page);

  const html = page.locator('html');
  const body = page.locator('body');

  // "System" is the absence of an attribute, not a third value written out —
  // that is what leaves the media query in charge.
  await expect(html).not.toHaveAttribute('data-theme', /.*/);
  await expect(body).toHaveCSS('background-color', DARK_CANVAS);
  await expect(body).not.toHaveCSS('background-color', LIGHT_CANVAS);

  const pane = await newDiagram(page);
  await page.keyboard.press('r');
  await pane.click({ position: { x: 640, y: 400 } });
  const shape = page.locator('.react-flow__node div[data-shape="rectangle"] > div').first();
  await expect(shape).toBeVisible();

  // A shape's fill is the user's, not the theme's: it is the same colour on a
  // dark board as on a light one.
  await expect(shape).toHaveCSS('background-color', DEFAULT_SHAPE_FILL);
  // The canvas underneath it is not — dots included, which are painted from
  // the token through React Flow's own custom property.
  await expect(page.locator('.react-flow__background-pattern.dots')).toHaveCSS('fill', DARK_CANVAS_DOT);

  // system → light → dark. The tooltip on each press names where it goes next.
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(body).toHaveCSS('background-color', LIGHT_CANVAS);

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(body).toHaveCSS('background-color', DARK_CANVAS);

  // The rectangle above was drawn inside the autosave debounce, so the reload
  // has to wait for it the way every other reload test does — otherwise the
  // shape this test goes on to read the fill of may never have been written.
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.react-flow__node div[data-shape="rectangle"] > div').first()).toHaveCSS(
    'background-color',
    DEFAULT_SHAPE_FILL,
  );

  // And the choice outranks the OS: still dark with a light machine underneath.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(body).toHaveCSS('background-color', DARK_CANVAS);
});

test('a comment pinned to a shape can be replied to, resolved, and found again', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);
  const node = await drawLabelledShape(page, pane, 'Checkout');

  // Right-clicking the shape offers "Comment" alongside the editing actions.
  await node.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment' }).click();

  const panel = page.getByRole('dialog', { name: 'Comments' });
  await expect(panel).toBeVisible();
  // The composer is already focused, so the remark can just be typed.
  await page.keyboard.type('Looks off');
  await panel.getByRole('button', { name: 'Comment', exact: true }).click();

  // The pin lands on the shape, and the button counts the open thread.
  const pin = page.getByRole('button', { name: 'Comment thread 1' });
  await expect(pin).toBeVisible();
  await expect(page.getByLabel('1 open thread')).toBeVisible();

  // Collapse the thread, then reopen it from the pin.
  await panel.getByRole('button', { name: /Checkout/ }).click();
  await pin.click();
  await expect(panel.getByText('Looks off')).toBeVisible();

  await panel.getByLabel('Reply').fill('Fixed');
  await panel.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(panel.getByText('Fixed')).toBeVisible();

  // Exact, or it also matches the "Resolved" filter tab.
  await panel.getByRole('button', { name: 'Resolve', exact: true }).click();

  // Resolved: no pin on the board, nothing under Open, no count on the button.
  await expect(pin).toHaveCount(0);
  await expect(page.getByLabel('1 open thread')).toHaveCount(0);
  await expect(panel.getByText('No comments yet.')).toBeVisible();

  await panel.getByRole('button', { name: 'Resolved', exact: true }).click();
  await expect(panel.getByText('Looks off')).toBeVisible();
  // And with the resolved threads showing, its pin is back on the board.
  await expect(page.getByRole('button', { name: 'Comment thread 1' })).toBeVisible();
});

test('an invited viewer can join the discussion but not call it settled', async ({ page, browser }) => {
  await signUp(page);
  const pane = await newDiagram(page);
  const node = await drawLabelledShape(page, pane, 'Owner shape');

  await node.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment' }).click();
  const ownerPanel = page.getByRole('dialog', { name: 'Comments' });
  await page.keyboard.type('Is this right?');
  await ownerPanel.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Comment thread 1' })).toBeVisible();
  // The sheet covers the top bar's right-hand buttons, Share included.
  await ownerPanel.getByRole('button', { name: 'Close comments' }).click();

  // A second account, in its own context so the two sessions never mix.
  const reviewer = await browser.newContext();
  const reviewerPage = await reviewer.newPage();
  const reviewerEmail = await signUp(reviewerPage);

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  await dialog.getByLabel('Invite by email').fill(reviewerEmail);
  await dialog.getByLabel('Invite as').selectOption('viewer');
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(dialog.getByText(reviewerEmail)).toBeVisible();

  await reviewerPage.goto('/');
  await reviewerPage.getByText('Untitled').first().click();
  await expect(reviewerPage).toHaveURL(/\/d\/[^/]+$/);
  await expect(reviewerPage.getByText('View only')).toBeVisible();

  // Reading a board they cannot edit, they can still say something about it —
  // a reviewer who cannot write anything down is not reviewing.
  await reviewerPage.getByRole('button', { name: 'Comments' }).click();
  const reviewerPanel = reviewerPage.getByRole('dialog', { name: 'Comments' });
  await reviewerPanel.getByRole('button', { name: /Owner shape/ }).click();
  await expect(reviewerPanel.getByText('Is this right?')).toBeVisible();

  await reviewerPanel.getByLabel('Reply').fill('No, the arrow is backwards');
  await reviewerPanel.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(reviewerPanel.getByText('No, the arrow is backwards')).toBeVisible();

  // What they may not do is call somebody else's thread settled.
  await expect(reviewerPanel.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0);

  await reviewer.close();
});

/**
 * Places one labelled rectangle at `at` and hands it back.
 *
 * `drawLabelledShape` above always targets the first node on the board, which
 * is exactly wrong once there is more than one; shapes are appended, so the
 * new one is the last.
 */
async function drawShapeAt(page: Page, pane: Locator, label: string, at: { x: number; y: number }) {
  const before = await page.locator('.react-flow__node').count();
  await page.keyboard.press('r');
  await pane.click({ position: at });
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);

  const node = page.locator('.react-flow__node').nth(before);
  await node.dblclick();
  await page.keyboard.type(label);
  await page.keyboard.press('Escape');
  await expect(node).toContainText(label);
  return node;
}

test('⌘F finds shapes by label, cycles the matches, and clears on Escape', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  // Down the board, which is the order the find bar cycles them in: "alpha"
  // matches the first and the third, and "Beta" is there to be skipped.
  await drawShapeAt(page, pane, 'Alpha', { x: 400, y: 200 });
  await drawShapeAt(page, pane, 'Beta', { x: 400, y: 340 });
  await drawShapeAt(page, pane, 'Alphabet', { x: 400, y: 480 });

  await page.keyboard.press('ControlOrMeta+f');
  const field = page.getByLabel('Find on canvas');
  await expect(field).toBeFocused();

  await page.keyboard.type('alpha');
  // Case-insensitive, so "Alpha" and "Alphabet" both match and "Beta" does not.
  await expect(page.getByText('1 of 2')).toBeVisible();
  await expect(page.locator('[data-search-hit]')).toHaveCount(2);

  // Enter steps to the next hit, which is selected and framed.
  await page.keyboard.press('Enter');
  await expect(page.getByText('2 of 2')).toBeVisible();
  const selected = page.locator('.react-flow__node.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText('Alphabet');

  // Escape closes the bar and takes every ring with it — but leaves the shape
  // it found selected, so the search hands the user something to work on.
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(page.locator('[data-search-hit]')).toHaveCount(0);
  await expect(page.locator('.react-flow__node.selected')).toContainText('Alphabet');
});

/** The React Flow node wrapper holding a node of the given kind. */
function nodesOfType(page: Page, type: 'shape' | 'group' | 'frame') {
  return page.locator('.react-flow__node').filter({ has: page.locator(`[data-node-type="${type}"]`) });
}

test('⌘G groups two shapes so they move as one, and ⌘⇧G lets them go', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await drawShapeAt(page, pane, 'Left', { x: 420, y: 300 });
  await drawShapeAt(page, pane, 'Right', { x: 760, y: 300 });

  const shapes = nodesOfType(page, 'shape');
  await expect(shapes).toHaveCount(2);
  const before = [await shapes.nth(0).boundingBox(), await shapes.nth(1).boundingBox()];

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');

  const group = nodesOfType(page, 'group');
  await expect(group).toHaveCount(1);

  // Grab the group by its own margin — the 16 px ring around its contents —
  // rather than by a child, which React Flow would drag on its own.
  const box = (await group.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 + 80, box.y + 6, { steps: 10 });
  await page.mouse.up();

  // Both children travelled with it.
  for (const [index, was] of before.entries()) {
    const now = (await shapes.nth(index).boundingBox())!;
    expect(now.x - was!.x).toBeGreaterThan(70);
    expect(now.x - was!.x).toBeLessThan(90);
    expect(Math.abs(now.y - was!.y)).toBeLessThan(5);
  }

  await page.keyboard.press('ControlOrMeta+Shift+g');
  await expect(nodesOfType(page, 'group')).toHaveCount(0);
  await expect(shapes).toHaveCount(2);
  await expect(page.locator('.react-flow__node', { hasText: 'Left' })).toBeVisible();
  await expect(page.locator('.react-flow__node', { hasText: 'Right' })).toBeVisible();
});

test('a shape dropped in a frame joins it and then travels with it', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  // Rail -> More shapes -> Frame, then click to place it.
  await page.getByRole('button', { name: 'More shapes' }).click();
  await page.getByRole('button', { name: 'Frame' }).click();
  await pane.click({ position: { x: 640, y: 400 } });

  const frame = nodesOfType(page, 'frame');
  await expect(frame).toHaveCount(1);
  const frameBox = (await frame.boundingBox())!;

  // A rectangle in the middle of the frame. The frame is a node, so this click
  // never reaches the pane — the canvas serves the drawing tools either way.
  await page.keyboard.press('r');
  await page.mouse.click(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  const shape = nodesOfType(page, 'shape');
  await expect(shape).toHaveCount(1);

  // Membership is settled on drop, so nudge it 10 px inside the frame.
  const shapeBox = (await shape.boundingBox())!;
  await page.mouse.move(shapeBox.x + shapeBox.width / 2, shapeBox.y + shapeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(shapeBox.x + shapeBox.width / 2 + 10, shapeBox.y + shapeBox.height / 2, { steps: 5 });
  await page.mouse.up();

  const frameId = await frame.getAttribute('data-id');
  await expect(shape.locator('[data-node-type="shape"]')).toHaveAttribute('data-parent-id', frameId!);

  // And now the frame carries it: drag the frame by its title strip.
  const movedShape = (await shape.boundingBox())!;
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + 6);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + 6 + 100, { steps: 10 });
  await page.mouse.up();

  // Within a snap of the 100 px the frame was dragged: the alignment guides
  // still apply to a container, so the drop can land a few pixels short.
  const after = (await shape.boundingBox())!;
  expect(after.y - movedShape.y).toBeGreaterThan(80);
  expect(after.y - movedShape.y).toBeLessThan(120);
  expect(Math.abs(after.x - movedShape.x)).toBeLessThan(5);
});

test('a diagram can be filed in a folder, found there, and outlives the folder', async ({ page }) => {
  await signUp(page);

  // A folder is made from the sidebar, named in place.
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Client work');
  await page.getByRole('textbox', { name: 'New folder name' }).press('Enter');
  // The count rides in the row's accessible name, so asserting the name is
  // asserting how many diagrams the sidebar says are in there.
  const emptyFolder = page.getByRole('button', { name: 'Client work, 0 diagrams' });
  await expect(emptyFolder).toBeVisible();

  await newDiagram(page);
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  const card = page.getByText('Untitled').first();
  await expect(card).toBeVisible();

  // File it from the card's own menu.
  await card.hover();
  await page.getByRole('button', { name: 'Diagram actions' }).click();
  await page.getByRole('button', { name: 'Move to…' }).click();
  // `exact`, because the sidebar row for the same folder is named with its count.
  await page.getByRole('button', { name: 'Client work', exact: true }).click();

  const filledFolder = page.getByRole('button', { name: 'Client work, 1 diagram' });
  await expect(filledFolder).toBeVisible();

  // The folder lists it…
  await filledFolder.click();
  await expect(page.getByRole('heading', { name: 'Client work' })).toBeVisible();
  await expect(page.getByText('Untitled')).toBeVisible();

  // …and so does "All diagrams": filing narrows the view, it does not hide it.
  await page.getByRole('button', { name: 'All diagrams' }).click();
  await expect(page.getByText('Untitled')).toBeVisible();

  // The filing survives a round trip rather than only living in the page.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Client work, 1 diagram' })).toBeVisible();

  // Rename it in place.
  const folderRow = page.getByRole('button', { name: 'Client work, 1 diagram' });
  await folderRow.hover();
  await page.getByRole('button', { name: 'Actions for Client work' }).click();
  await page.getByRole('button', { name: 'Rename folder' }).click();
  await page.getByRole('textbox', { name: 'Folder name' }).fill('Clients');
  await page.getByRole('textbox', { name: 'Folder name' }).press('Enter');
  const renamed = page.getByRole('button', { name: 'Clients, 1 diagram' });
  await expect(renamed).toBeVisible();

  // Deleting asks first, and says what will happen to what is inside.
  await renamed.hover();
  await page.getByRole('button', { name: 'Actions for Clients' }).click();
  await page.getByRole('button', { name: 'Delete folder' }).click();
  await expect(page.getByText('Its diagrams are kept')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm delete folder' }).click();

  // The row is gone; the diagram is not — it is back under All diagrams.
  await expect(page.getByRole('button', { name: 'Clients, 1 diagram' })).toHaveCount(0);
  await expect(page.getByText('No folders yet.')).toBeVisible();
  await expect(page.getByText('Untitled')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Untitled')).toBeVisible();
  await expect(page.getByText('No folders yet.')).toBeVisible();
});
