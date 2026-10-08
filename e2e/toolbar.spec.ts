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
async function drawRectangle(page: Page) {
  const pane = await newDiagram(page);
  await page.keyboard.press('r');
  await pane.click({ position: { x: 420, y: 300 } });
  await page.keyboard.press('Escape'); // leave the new shape's label editor
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await node.click();
  return { node, toolbar: page.getByRole('toolbar', { name: 'Selection toolbar' }) };
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
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();

  await toolbar.getByRole('button', { name: 'Color' }).click();
  const grid = page.getByRole('group', { name: 'Colors' });
  const customInput = page.locator('[data-testid="custom-colour-input"]');
  await customInput.evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, '#123456');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(undo).toBeDisabled();

  await customInput.evaluate((input) => input.dispatchEvent(new Event('change', { bubbles: true })));
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(undo).toBeEnabled();
  await expect(grid.locator('button[aria-pressed="true"]')).toHaveCount(0);

  // A focused colour input belongs to its popover; ⌘Z there must not reach the
  // canvas history handler. Close it before testing the one committed edit.
  await customInput.evaluate((input) => (input as HTMLElement).focus());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(shapeBox(node)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(undo).toBeDisabled();
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

test('Dash combines with Transparent, Fill clears it, and Transparent from Fill selects Outline', async ({ page }) => {
  await signUp(page);
  const { node, toolbar } = await drawRectangle(page);
  const box = shapeBox(node);
  const fill = toolbar.getByRole('button', { name: 'Fill', exact: true });
  const outline = toolbar.getByRole('button', { name: 'Outline', exact: true });
  const dash = toolbar.getByRole('button', { name: 'Dash', exact: true });
  const transparent = toolbar.getByRole('button', { name: 'Transparent', exact: true });

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
