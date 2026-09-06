import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
  await expect(edgePath).toHaveAttribute('marker-end', /circle/);
  await expect(page.locator('marker[id*="circle"]')).toHaveCount(1);
});
