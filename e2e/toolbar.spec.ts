import { expect, test, type Locator, type Page } from '@playwright/test';

/** Creates a fresh account through the real sign-up form. */
async function signUp(page: Page) {
  const email = `toolbar-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Toolbar E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();
}

/** Opens a fresh diagram and returns its canvas pane. */
async function newDiagram(page: Page) {
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();
  return pane;
}

/** Draws a rectangle and returns the selection toolbar and shape node. */
async function drawRectangle(page: Page, position = { x: 420, y: 300 }) {
  const pane = await newDiagram(page);
  await page.keyboard.press('r');
  await pane.click({ position });
  await page.keyboard.press('Escape'); // leave the new shape's label editor
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await node.click();
  return { node, toolbar: page.getByRole('toolbar', { name: 'Selection toolbar' }) };
}

/** Draws two quick-added shapes joined by one connector and returns its hitbox. */
async function drawConnectedPair(page: Page) {
  await newDiagram(page);
  await page.keyboard.press('r');
  await page.locator('.react-flow__pane').click({ position: { x: 500, y: 400 } });
  await page.keyboard.press('Escape');
  const node = page.locator('.react-flow__node').first();
  await node.hover();
  await node.locator('.quick-add-btn').nth(1).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  return (await page.locator('.react-flow__edge-interaction').first().boundingBox())!;
}

/** The inner box on which ShapeNode paints fill and border. */
function shapeBox(node: Locator) {
  return node.locator('[data-shape] > div').first();
}

test('the colour picker has a keyboard-accessible 4 by 4 grid and Escape keeps the shape selected', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);

  await toolbar.getByRole('button', { name: 'Color' }).click();
  const grid = page.getByRole('group', { name: 'Colors' });
  const popover = page.getByRole('dialog', { name: 'Colors' });
  await expect(grid.getByRole('button')).toHaveCount(16);
  await expect(grid.getByRole('button', { name: 'White', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const white = grid.getByRole('button', { name: 'White', exact: true });
  const blue = grid.getByRole('button', { name: 'Blue', exact: true });
  await expect(white).toBeFocused();

  const box = await popover.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - 126)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.height - 126)).toBeLessThanOrEqual(1);

  // Horizontal grid navigation follows the documented keyboard path from
  // White to Blue; Enter applies the focused swatch.
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
  await expect(blue).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(41, 135, 215)');

  // Opening on an existing colour should focus that colour, so the default
  // Enter action keeps the shape Blue instead of recolouring it White.
  await toolbar.getByRole('button', { name: 'Color' }).click();
  await expect(blue).toHaveAttribute('aria-pressed', 'true');
  await expect(blue).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(41, 135, 215)');

  // Picking a swatch closes the popover. Reopen it to check Escape's focus and
  // selection behavior independently.
  await toolbar.getByRole('button', { name: 'Color' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Colors' })).toHaveCount(0);
  await expect(node).toHaveClass(/selected/);
});

test('a custom colour commits only on change as one undo step', async ({ page }) => {
  await signUp(page);
  const diagramId = await page.evaluate(async () => {
    const response = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Custom colour',
        data: {
          version: 3,
          nodes: [{
            id: 'baseline',
            type: 'shape',
            position: { x: 300, y: 220 },
            width: 180,
            height: 80,
            data: { label: 'Baseline', shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' },
          }],
          edges: [],
        },
      }),
    });
    if (!response.ok) throw new Error(`Could not create baseline diagram: ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  });
  await page.goto(`/d/${diagramId}`);
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await node.click();
  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  // No assertion on Undo being empty here: on main, a plain click on a shape
  // records an undo step of its own (a separate bug), so "empty" would race it.
  // What this test owns is the colour: dragging records nothing, the release
  // records one step, and one ⌘Z takes the shape back to where it started.
  await toolbar.getByRole('button', { name: 'Color' }).click();
  const grid = page.getByRole('group', { name: 'Colors' });
  const customInput = page.locator('[data-testid="custom-colour-input"]');
  await customInput.evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    // A drag through the system picker: several values, `input` only.
    for (const value of ['#111111', '#222222', '#123456']) {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  await customInput.evaluate((input) => input.dispatchEvent(new Event('change', { bubbles: true })));
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(grid.locator('button[aria-pressed="true"]')).toHaveCount(0);

  // A focused colour input belongs to its popover; ⌘Z there must not reach the
  // canvas history handler. Close it before testing the one committed edit.
  await customInput.evaluate((input) => (input as HTMLElement).focus());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  // One ⌘Z is the whole colour change: had any `input` been committed, this
  // would land on #111111 or #222222 rather than on the original white.
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('Space picks the focused swatch without panning the canvas', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);

  await toolbar.getByRole('button', { name: 'Color' }).click();
  const grid = page.getByRole('group', { name: 'Colors' });
  const blue = grid.getByRole('button', { name: 'Blue', exact: true });
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
  await expect(blue).toBeFocused();
  await page.keyboard.press('Space');
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(41, 135, 215)');
});

test('the theme switch ArrowRight does not nudge the selected shape', async ({ page }) => {
  await signUp(page);
  const { node } = await drawRectangle(page);
  const before = await node.evaluate((element) => element.style.transform);

  await page.getByRole('button', { name: 'Account' }).click();
  const theme = page.getByRole('radiogroup', { name: 'Theme' });
  const system = theme.getByRole('radio', { name: 'System' });
  const light = theme.getByRole('radio', { name: 'Light' });
  await system.focus();
  await page.keyboard.press('ArrowRight');

  await expect(light).toHaveAttribute('aria-checked', 'true');
  const after = await node.evaluate((element) => element.style.transform);
  expect(after).toBe(before);
});

test('shape and style popovers keep canvas shortcuts off the selected shape', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);
  const before = await node.boundingBox();
  expect(before).not.toBeNull();

  for (const [trigger, dialog] of [
    ['Change shape', 'Shape picker'],
    ['Style', 'Style'],
  ] as const) {
    await toolbar.getByRole('button', { name: trigger, exact: true }).click();
    const popover = page.getByRole('dialog', { name: dialog });
    await expect(popover).toBeVisible();
    await expect(popover.locator(':focus')).toHaveCount(1);

    await page.keyboard.press('ArrowRight');
    await expect(popover.locator(':focus')).toHaveCount(1);
    await expect(node).toBeVisible();
    let current = await node.boundingBox();
    expect(current).not.toBeNull();
    expect(current!.x).toBe(before!.x);
    expect(current!.y).toBe(before!.y);

    await page.keyboard.press('Backspace');
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    current = await node.boundingBox();
    expect(current).not.toBeNull();
    expect(current!.x).toBe(before!.x);
    expect(current!.y).toBe(before!.y);
    await toolbar.getByRole('button', { name: trigger, exact: true }).click();
    await expect(page.getByRole('dialog', { name: dialog })).toHaveCount(0);
  }
});

test('connector picker popovers keep canvas shortcuts off the selected connector', async ({ page }) => {
  await signUp(page);
  const hitbox = await drawConnectedPair(page);
  await page.mouse.click(hitbox.x + hitbox.width * 0.25, hitbox.y + hitbox.height / 2);

  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  const nodes = page.locator('.react-flow__node');
  const edges = page.locator('.react-flow__edge');
  const beforeNodes = await nodes.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y };
  }));
  const edgePath = page.locator('.react-flow__edge-path').first();
  const beforePath = await edgePath.getAttribute('d');
  expect(beforePath).not.toBeNull();

  for (const [trigger, dialog] of [
    ['Start arrowhead', 'Start arrowhead'],
    ['End arrowhead', 'End arrowhead'],
    ['Line', 'Line'],
  ] as const) {
    await toolbar.getByRole('button', { name: trigger, exact: true }).click();
    await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(edges).toHaveCount(1);
    await expect(nodes).toHaveCount(2);
    let positions = await nodes.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }));
    expect(positions).toEqual(beforeNodes);
    expect(await edgePath.getAttribute('d')).toBe(beforePath);

    await page.keyboard.press('Backspace');
    await expect(edges).toHaveCount(1);
    await expect(nodes).toHaveCount(2);
    positions = await nodes.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }));
    expect(positions).toEqual(beforeNodes);
    expect(await edgePath.getAttribute('d')).toBe(beforePath);
    await toolbar.getByRole('button', { name: trigger, exact: true }).click();
    await expect(page.getByRole('dialog', { name: dialog })).toHaveCount(0);
  }
});

test('Dash combines with Transparent, Fill clears it, and Transparent from Fill selects Outline', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);
  const box = shapeBox(node);
  const fill = toolbar.getByRole('button', { name: 'Fill', exact: true });
  const outline = toolbar.getByRole('button', { name: 'Outline', exact: true });
  const dash = toolbar.getByRole('button', { name: 'Dash', exact: true });
  const transparent = toolbar.getByRole('button', { name: 'Transparent', exact: true });
  const transparentIcon = transparent.locator('svg');
  await expect(transparentIcon).toHaveAttribute('viewBox', '0 0 20 20');
  await expect(transparentIcon.locator('rect')).toHaveCount(5);

  await dash.click();
  await expect(dash).toHaveAttribute('aria-pressed', 'true');
  await expect(box).toHaveCSS('border-top-style', 'dashed');

  await transparent.click();
  await expect(box).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(box).not.toHaveCSS('border-top-width', '0px');
  await expect(box).toHaveCSS('border-top-style', 'dashed');
  await expect(dash).toHaveAttribute('aria-pressed', 'true');
  await expect(transparent).toHaveAttribute('aria-pressed', 'true');

  await fill.click();
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  await expect(transparent).toHaveAttribute('aria-pressed', 'false');
  await expect(box).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(box).toHaveCSS('border-top-width', '0px');

  await transparent.click();
  await expect(outline).toHaveAttribute('aria-pressed', 'true');
  await expect(dash).toHaveAttribute('aria-pressed', 'false');
  await expect(transparent).toHaveAttribute('aria-pressed', 'true');
  await expect(box).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('a sticky note uses the Blue sticky tint', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);
  await page.keyboard.press('s');
  await pane.click({ position: { x: 420, y: 300 } });
  await page.keyboard.press('Escape');
  const node = page.locator('.react-flow__node').first();
  await expect(node.locator('[data-shape="sticky"]')).toBeVisible();
  await node.click();

  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  await toolbar.getByRole('button', { name: 'Color' }).click();
  await page.getByRole('group', { name: 'Colors' }).getByRole('button', { name: 'Blue', exact: true }).click();
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(202, 225, 245)');
});

test('the selection toolbar keeps its measured size and dark chrome in both themes', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);

  const assertMetrics = async () => {
    await expect(toolbar).toHaveCSS('height', '40px');
    await expect(toolbar).toHaveCSS('padding', '6px');
    await expect(toolbar).toHaveCSS('border-radius', '10px');
    await expect(toolbar).toHaveCSS('background-color', 'oklch(0.33 0.03 248)');
    const barBox = (await toolbar.boundingBox())!;
    const nodeBox = (await node.boundingBox())!;
    expect(nodeBox.y - barBox.y - barBox.height).toBe(39);
    const button = toolbar.getByRole('button', { name: 'Color' });
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBe(30);
    expect(box!.height).toBe(28);
    await expect(button).toHaveAttribute('data-popover', '');
    expect(await button.evaluate((el) => getComputedStyle(el, '::after').width)).toBe('5px');
    expect(await button.evaluate((el) => getComputedStyle(el, '::after').height)).toBe('5px');
    const icon = toolbar.getByRole('button', { name: 'Text' }).locator('svg');
    await expect(icon).toHaveCSS('width', '20px');
    await expect(icon).toHaveCSS('height', '20px');
    await expect(icon).toHaveCSS('stroke-width', '1.75px');
    const fillSegment = toolbar.getByRole('group', { name: 'Fill style' }).getByRole('button', { name: 'Fill', exact: true });
    expect((await fillSegment.boundingBox())!.width).toBe(32);
    await expect(toolbar.locator('.chrome-sep').first()).toHaveCSS('width', '1px');
    await expect(toolbar.locator('.chrome-sep').first()).toHaveCSS('height', '20px');
  };

  await assertMetrics();
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await assertMetrics();
});

test('Text switches into the inline text bar and edits the selected label', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);

  await toolbar.getByRole('button', { name: 'Text' }).click();
  const label = node.locator('[contenteditable="true"]');
  await expect(label).toBeFocused();
  await expect(toolbar.getByRole('button', { name: 'Finish editing' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Change shape' })).toHaveCount(0);
  await page.keyboard.type('Inline text');
  await toolbar.getByRole('button', { name: 'Text size' }).click();
  await page.getByRole('dialog', { name: 'Text size' }).getByRole('button', { name: 'L', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Finish editing' }).click();
  await expect(node).toContainText('Inline text');
  const renderedLabel = node.locator('[contenteditable="false"]');
  await expect(renderedLabel).toHaveCSS('font-size', '18px');
  await expect(toolbar.getByRole('button', { name: 'Change shape' })).toBeVisible();
});

test('choosing text size by keyboard returns to the editor and Finish editing commits', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);

  await toolbar.getByRole('button', { name: 'Text' }).click();
  const editor = node.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await page.keyboard.type('First');

  await toolbar.getByRole('button', { name: 'Text size' }).click();
  const dialog = page.getByRole('dialog', { name: 'Text size' });
  await expect(dialog).toBeVisible();
  const large = page.getByRole('dialog', { name: 'Text size' }).getByRole('button', { name: 'L', exact: true });
  await large.press('Enter');

  await expect(editor).toBeFocused();
  await page.keyboard.type(' after');
  await toolbar.getByRole('button', { name: 'Finish editing' }).click();

  await expect(node.locator('[contenteditable="false"]')).toContainText('First after');
  await expect(node.locator('[contenteditable="true"]')).toHaveCount(0);
});

test('Escape leaves multi-selection text mode without clearing the selection', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  for (const position of [{ x: 420, y: 300 }, { x: 700, y: 300 }]) {
    await page.keyboard.press('r');
    await pane.click({ position });
    await page.keyboard.press('Escape');
  }

  await page.keyboard.press('ControlOrMeta+a');
  const selected = page.locator('.react-flow__node.selected');
  await expect(selected).toHaveCount(2);
  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  await toolbar.getByRole('button', { name: 'Text' }).click();
  await expect(toolbar.getByRole('button', { name: 'Finish editing' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Change shape' })).toHaveCount(0);

  await page.keyboard.press('Escape');

  await expect(selected).toHaveCount(2);
  await expect(toolbar.getByRole('button', { name: 'Change shape' })).toBeVisible();

  await toolbar.getByRole('button', { name: 'Text' }).click();
  await toolbar.getByRole('button', { name: 'Text size' }).click();
  const sizePicker = page.getByRole('dialog', { name: 'Text size' });
  await expect(sizePicker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sizePicker).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Finish editing' })).toBeVisible();
  await expect(selected).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(selected).toHaveCount(2);
  await expect(toolbar.getByRole('button', { name: 'Change shape' })).toBeVisible();
});

test('text toolbar clamps by its rendered width near the viewport edge', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await signUp(page);
  const { toolbar } = await drawRectangle(page, { x: 10, y: 300 });

  await toolbar.getByRole('button', { name: 'Text' }).click();
  await expect(toolbar.getByRole('button', { name: 'Finish editing' })).toBeVisible();
  await expect.poll(async () => {
    const box = (await toolbar.boundingBox())!;
    return box.x >= 0 && box.x + box.width <= 800 && box.width > 400;
  }).toBe(true);
});

test('the selection toolbar flips below a shape when its above-position overlaps the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await signUp(page);
  const diagramId = await page.evaluate(async () => {
    const response = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Top bar toolbar',
        data: {
          version: 3,
          nodes: [{
            id: 'top-bar-edge',
            type: 'shape',
            position: { x: 350, y: 100 },
            width: 180,
            height: 80,
            data: { label: 'Top bar edge', shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' },
          }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      }),
    });
    if (!response.ok) throw new Error(`Could not create top-edge diagram: ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  });
  await page.goto(`/d/${diagramId}`);
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await node.click();
  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });

  const viewport = page.viewportSize()!;
  const barBox = (await toolbar.boundingBox())!;
  const shape = (await shapeBox(node).boundingBox())!;
  expect(barBox.x).toBeGreaterThanOrEqual(0);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(viewport.width);
  expect(barBox.y).toBeGreaterThanOrEqual(0);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(viewport.height);
  const share = (await page.getByRole('button', { name: 'Share' }).boundingBox())!;
  expect(barBox.y).toBeGreaterThanOrEqual(share.y + share.height);
  expect(barBox.y - (shape.y + shape.height)).toBe(39);
});

test('Delete lives in More actions and both Delete and Backspace work', async ({ page }) => {
  await signUp(page);
  const { toolbar } = await drawRectangle(page);
  await expect(toolbar.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await toolbar.getByRole('button', { name: 'More actions' }).click();
  const deleteItem = page.getByRole('menuitem', { name: 'Delete', exact: true });
  await expect(deleteItem).toContainText('Backspace');
  await deleteItem.click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);

  const pane = page.locator('.react-flow__pane');
  await page.keyboard.press('r');
  await pane.click({ position: { x: 420, y: 300 } });
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);

  await page.keyboard.press('r');
  await pane.click({ position: { x: 420, y: 300 } });
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
});

test('opening Link commits the live label before the URL field takes focus', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);

  await node.dblclick();
  const editor = node.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Linked label');
  await toolbar.getByRole('button', { name: 'Link' }).click();

  const url = page.getByRole('textbox', { name: 'Link URL' });
  await expect(url).toBeFocused();
  await expect(node).toContainText('Linked label');
  await expect(editor).toHaveCount(0);
  await url.fill('https://example.test');
  await url.press('Enter');
  await expect(node.locator('a')).toHaveAttribute('href', 'https://example.test');
});

test('More actions uses command shortcuts and exposes checked Lock state', async ({ page }) => {
  await signUp(page);
  const { toolbar } = await drawRectangle(page);
  const more = toolbar.getByRole('button', { name: 'More actions' });
  const expectedCopyShortcut = await page.evaluate(async () => {
    const source = '/src/commands/commands.ts';
    const { formatShortcut, registry } = await import(source);
    return formatShortcut(registry.find('clipboard.copy')?.shortcut).replaceAll('+', '');
  });

  await more.click();
  const menu = page.getByRole('menu', { name: 'More actions' });
  const copyItem = menu.getByRole('menuitem', { name: 'Copy', exact: true });
  const saveDefaultItem = menu.getByRole('menuitem', { name: 'Save as default style', exact: true });
  const arrangeItem = menu.getByRole('menuitem', { name: 'Arrange', exact: true });
  const lockItem = menu.getByRole('menuitemcheckbox', { name: 'Lock / unlock' });
  const wrapItem = menu.getByRole('menuitem', { name: 'Wrap in frame', exact: true });
  const snapItem = menu.getByRole('menuitemcheckbox', { name: 'Snap to grid' });
  const thumbnailItem = menu.getByRole('menuitem', { name: 'Set as board thumbnail', exact: true });
  const menuBox = (await menu.boundingBox())!;
  const copyBox = (await copyItem.boundingBox())!;
  expect(menuBox.width).toBeGreaterThanOrEqual(272);
  const copyText = (await copyItem.locator(':scope > span.flex-1').boundingBox())!;
  for (const row of [saveDefaultItem, arrangeItem, lockItem, wrapItem, snapItem, thumbnailItem]) {
    const text = (await row.locator(':scope > span.flex-1').boundingBox())!;
    expect(Math.abs(text.x - copyText.x)).toBeLessThanOrEqual(1);
    await expect(row).toHaveCSS('height', '30px');
  }
  await expect(menu).toHaveCSS('min-width', '272px');
  await expect(saveDefaultItem.locator(':scope > span.flex-1')).toHaveCSS('white-space', 'nowrap');
  const lastShortcut = (await copyItem.locator('kbd').last().boundingBox())!;
  expect(lastShortcut.x + lastShortcut.width).toBe(copyBox.x + copyBox.width - 8);
  await expect(toolbar.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
  const copy = page.getByRole('menuitem', { name: 'Copy', exact: true });
  await expect(copy).toContainText(expectedCopyShortcut);
  const lock = page.getByRole('menuitemcheckbox', { name: /Lock/ });
  await expect(lock).toHaveAttribute('aria-checked', 'false');
  await lock.click();

  await more.click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Lock/ })).toHaveAttribute('aria-checked', 'true');
});

test('a selected connector gets the derived connector toolbar and default Gray', async ({ page }) => {
  await signUp(page);
  const box = await drawConnectedPair(page);
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);

  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  for (const label of ['Text', 'Color', 'Straight line', 'Elbow line', 'Curved line', 'Start arrowhead', 'End arrowhead', 'More actions']) {
    await expect(toolbar.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(toolbar.getByRole('button', { name: 'Line', exact: true })).toBeVisible();
  await toolbar.getByRole('button', { name: 'Color' }).click();
  await expect(page.getByRole('group', { name: 'Colors' }).getByRole('button', { name: 'Gray', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a version 3 outline keeps its old paint and has no active preset swatch', async ({ page }) => {
  await signUp(page);
  const id = await page.evaluate(async () => {
    const body = {
      title: 'Legacy outline',
      data: {
        version: 3,
        nodes: [{
          id: 'legacy',
          type: 'shape',
          position: { x: 300, y: 220 },
          width: 180,
          height: 80,
          data: {
            label: 'Legacy',
            shape: 'rectangle',
            fill: '#2C88D9',
            stroke: '#236DAE',
            fillStyle: 'outline',
          },
        }],
        edges: [],
      },
    };
    const response = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Could not create legacy diagram: ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  });

  await page.goto(`/d/${id}`);
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await expect(shapeBox(node)).toHaveCSS('border-color', 'rgb(35, 109, 174)');
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  await node.click();
  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  await toolbar.getByRole('button', { name: 'Color' }).click();
  const grid = page.getByRole('group', { name: 'Colors' });
  await expect(grid.locator('button[aria-pressed="true"]')).toHaveCount(0);
});
