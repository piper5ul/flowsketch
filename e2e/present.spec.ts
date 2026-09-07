import { expect, test, type Page } from '@playwright/test';

/**
 * Presentation mode: one slide per frame.
 *
 * Its own file rather than an addition to `diagram.spec.ts`, which every branch
 * appends to and every branch therefore conflicts over.
 */

/**
 * Creates a fresh account through the real sign-up form. Email verification is
 * not required to sign in, so this needs no mail server. (The same helper
 * `diagram.spec.ts` opens with — it is not exported from there, and importing
 * across spec files would make one suite's helpers the other's dependency.)
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

/**
 * A diagram of two frames, each holding one shape, built through the API so the
 * parentage and the positions are exact. The frames are laid out top to bottom,
 * so the deck reads "Overview" then "Details" with nothing arranged.
 */
async function twoFrameDeck(page: Page) {
  const id = await page.evaluate(async () => {
    const frame = (id: string, label: string, y: number) => ({
      id,
      type: 'frame',
      position: { x: 200, y },
      width: 600,
      height: 400,
      data: { label, shape: 'rectangle', fill: 'transparent', stroke: 'transparent' },
    });
    const child = (id: string, parentId: string) => ({
      id,
      type: 'shape',
      position: { x: 60, y: 120 },
      width: 200,
      height: 100,
      parentId,
      extent: 'parent',
      data: { label: id, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
    });
    const body = {
      title: 'Deck',
      data: {
        version: 3,
        nodes: [
          frame('f1', 'Overview', 0),
          child('one', 'f1'),
          frame('f2', 'Details', 900),
          child('two', 'f2'),
        ],
        edges: [],
      },
    };
    const res = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await res.json()) as { id: string }).id;
  });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  return id;
}

const overlay = (page: Page) => page.getByTestId('present-overlay');

test('Present runs one slide per frame, and Esc gives the board back', async ({ page }) => {
  await signUp(page);
  await twoFrameDeck(page);

  await page.getByRole('button', { name: 'Present', exact: true }).click();

  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toContainText('1 / 2');
  // The chrome is gone while a slide is up — the top bar's Export button is the
  // witness for all of it.
  await expect(page.getByRole('button', { name: 'Export' })).toBeHidden();

  // The arrow keys drive the deck, and it clamps rather than wrapping.
  await page.keyboard.press('ArrowRight');
  await expect(overlay(page)).toContainText('2 / 2');
  await page.keyboard.press('ArrowRight');
  await expect(overlay(page)).toContainText('2 / 2');
  await page.keyboard.press('ArrowLeft');
  await expect(overlay(page)).toContainText('1 / 2');

  await page.keyboard.press('Escape');
  await expect(overlay(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
});

test('the frame is framed and everything outside it is masked out', async ({ page }) => {
  await signUp(page);
  await twoFrameDeck(page);

  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(overlay(page)).toContainText('1 / 2');

  // Fitted with no padding, so the slide fills one axis of the window. The fit
  // is a 300 ms animation, hence the poll rather than a single read.
  const slide = page.locator('.react-flow__node[data-id="f1"]');
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => (await slide.boundingBox())?.width ?? 0)
    .toBeGreaterThan(viewport.width * 0.6);
  const frameBox = (await slide.boundingBox())!;
  // The shape inside the slide is still drawn; the one in the *other* frame is
  // outside the mask's hole, and painted over.
  await expect(page.locator('.react-flow__node[data-id="one"]')).toBeVisible();

  const two = (await page.locator('.react-flow__node[data-id="two"]').boundingBox())!;
  const insideSlide =
    two.x >= frameBox.x - 1 &&
    two.y >= frameBox.y - 1 &&
    two.x + two.width <= frameBox.x + frameBox.width + 1 &&
    two.y + two.height <= frameBox.y + frameBox.height + 1;
  expect(insideSlide, 'the other slide sits outside the hole in the mask').toBe(false);
});

test('Arrange slides reorders the deck, and Present from this frame starts there', async ({ page }) => {
  await signUp(page);
  await twoFrameDeck(page);

  // The caret next to Present opens the running order.
  await page.getByRole('button', { name: 'Presentation options' }).click();
  const panel = page.getByRole('button', { name: 'Move Overview down' });
  await expect(panel).toBeVisible();
  await panel.click();

  // Details is now slide 1, which is what "Start presenting" opens on.
  await page.getByRole('button', { name: 'Start presenting' }).click();
  await expect(overlay(page)).toContainText('1 / 2');
  await expect(overlay(page)).toHaveAttribute('aria-label', 'Presenting: Details');
  await page.keyboard.press('Escape');

  // Right-clicking a frame offers to present from it: Overview is slide 2 now.
  // The right-click selects the frame first, which is what the gate reads.
  await page.locator('.react-flow__node[data-id="f1"]').click({ button: 'right', position: { x: 20, y: 8 } });
  await page.getByRole('menuitem', { name: 'Present from this frame' }).click();
  await expect(overlay(page)).toContainText('2 / 2');
  await expect(overlay(page)).toHaveAttribute('aria-label', 'Presenting: Overview');

  // And the order survives a reload: it is written onto the frames.
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Presentation options' }).click();
  await expect(page.getByRole('button', { name: 'Move Details up' })).toBeDisabled();
});
