import { expect, test, type Locator, type Page } from '@playwright/test';

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

async function newDiagram(page: Page) {
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();
  return pane;
}

/** One labelled rectangle, placed with the rail's R tool. Returns its wrapper. */
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

test('⌘-click reaches inside a group and selects the one shape it landed on', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  await drawShapeAt(page, pane, 'Left', { x: 420, y: 300 });
  await drawShapeAt(page, pane, 'Right', { x: 760, y: 300 });

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');

  // ⌘G leaves the group itself as the whole selection: one node selected, and
  // it is not either of the two shapes.
  const selected = page.locator('.react-flow__node.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected).not.toContainText('Left');

  // ⌘-click one member. ⌘ is also React Flow's multi-select key (its default
  // `multiSelectionKeyCode`, which `Canvas` does not override), so what makes
  // this a drill-in rather than an add is that nothing but this shape's own
  // group was selected — see `deepSelectTarget`. This is the contract the rule
  // guarantees whatever React Flow does with the modifier underneath.
  const left = page.locator('.react-flow__node', { hasText: 'Left' });
  await left.click({ modifiers: ['ControlOrMeta'] });

  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText('Left');

  // The floating toolbar is now acting on that member, not on the group: a
  // group has no shape to swap, and a rectangle does.
  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Shape' })).toBeVisible();

  // The other half of the rule — that ⌘ keeps its multi-select meaning once
  // something else is selected — is `deepSelect.test.ts`'s: a held modifier
  // during a synthetic click does not reliably reach React Flow's own
  // `multiSelectionKeyCode` handling, so asserting it here would be asserting
  // something about Playwright.
});

test('⌥+arrow grows a connected shape and opens its label', async ({ page }) => {
  await signUp(page);
  const pane = await newDiagram(page);

  const root = await drawShapeAt(page, pane, 'Root', { x: 400, y: 300 });
  await root.click();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);

  await page.keyboard.press('Alt+ArrowRight');

  // Two shapes, one connector between them…
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // …and the new one is open for typing, which is the half the buttons on the
  // shape do not do: ⌥→ is the middle of type-⌥→-type.
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toHaveCount(1);
  await page.keyboard.type('Grown');
  await page.keyboard.press('Escape');
  const grown = page.locator('.react-flow__node').nth(1);
  await expect(grown).toContainText('Grown');

  // The row carries on growing from whichever shape is selected — Escape
  // closes the editor *and* clears the selection, so the next one is picked
  // the way a pointer would pick it.
  await grown.click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.keyboard.press('Escape');
});

test.describe('on a short window', () => {
  test.use({ viewport: { width: 1280, height: 700 } });

  test('the left rail stays on the board, whole and clear of the bottom bar', async ({ page }) => {
    await signUp(page);
    await newDiagram(page);

    const viewport = page.viewportSize()!;
    const rail = page.getByRole('toolbar', { name: 'Tools' });
    await expect(rail).toBeVisible();

    const railBox = (await rail.boundingBox())!;
    expect(railBox.y).toBeGreaterThanOrEqual(0);
    expect(railBox.y + railBox.height).toBeLessThanOrEqual(viewport.height);

    // Nothing is scrolled out of sight either: at this height the compact
    // spacing is enough on its own, and the rail's own scrolling is the
    // reserve for a window shorter still.
    const overflow = await rail.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);

    // The boxes of the bottom-right controls, which the rail must not reach.
    const bottomBoxes = [];
    for (const name of ['Undo', 'Redo', 'Fit to view']) {
      bottomBoxes.push((await page.getByRole('button', { name, exact: true }).boundingBox())!);
    }

    const buttons = rail.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(10);
    for (let i = 0; i < count; i++) {
      const box = (await buttons.nth(i).boundingBox())!;
      expect(box, `rail button ${i} has no box`).not.toBeNull();
      expect(box.x, `rail button ${i} off the left edge`).toBeGreaterThanOrEqual(0);
      expect(box.y, `rail button ${i} off the top edge`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `rail button ${i} off the bottom edge`).toBeLessThanOrEqual(viewport.height);
      expect(box.x + box.width, `rail button ${i} off the right edge`).toBeLessThanOrEqual(viewport.width);
      for (const other of bottomBoxes) {
        const overlaps =
          box.x < other.x + other.width &&
          other.x < box.x + box.width &&
          box.y < other.y + other.height &&
          other.y < box.y + box.height;
        expect(overlaps, `rail button ${i} overlaps the bottom bar`).toBe(false);
      }
    }

    // Every tool is still there and still opens what it opened: the fix is
    // spacing, never a button moved into a popover.
    await page.getByRole('button', { name: 'More shapes' }).click();
    await expect(page.getByRole('button', { name: 'Frame', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
