/**
 * Three polish fixes around the board's `meta` — the state that is the board's
 * rather than any one shape's.
 *
 * 1. **It is undoable on a live diagram.** The document's `meta` map is inside
 *    the `Y.UndoManager`'s scope now (the camera is kept out of it by origin,
 *    not by key — see `src/lib/collab/binding.ts`), so ⌘Z takes back a timer or
 *    a saved default style the way it takes back a shape.
 * 2. **The countdown chimes**, quietly and only in the window that watched it
 *    run out. Not asserted here — a headless browser has no speakers and the
 *    audio is behind `navigator.userActivation` anyway; `src/lib/chime.test.ts`
 *    is where the notes are checked.
 * 3. **The public `/s/:token` page keeps up with it.** That page opens no
 *    socket, so it re-reads `GET /api/shared/:token` every 30 s and takes the
 *    timer and the round of voting off it — the board itself is not re-loaded.
 */
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

/** Opens a new diagram and waits for its canvas. */
async function newDiagram(page: Page) {
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  await expect(page.locator('.react-flow__pane')).toBeVisible();
}

/** Everything this window has done has reached the server. */
async function expectSynced(page: Page) {
  await expect(page.locator('[data-collab-sync="synced"]')).toBeVisible();
}

/**
 * Starts the board timer through the TopBar control.
 *
 * The control's accessible name *is* the countdown once one is running, so the
 * panel is only reachable by the name "Timer" while the board has none.
 */
async function startTimer(page: Page, preset: string) {
  await page.getByRole('button', { name: 'Timer' }).click();
  await page.getByRole('dialog', { name: 'Timer' }).getByRole('button', { name: preset }).click();
  await expect(page.locator('[data-timer-state]')).toHaveAttribute('data-timer-state', 'running');
}

test('⌘Z takes the board timer back on a live diagram, and the panel remembers the mute', async ({
  page,
}) => {
  await signUp(page);
  await newDiagram(page);

  // The chime's mute lives in this browser rather than on the board, so it
  // survives a reload of a diagram that knows nothing about it.
  await page.getByRole('button', { name: 'Timer' }).click();
  const panel = page.getByRole('dialog', { name: 'Timer' });
  await panel.getByRole('button', { name: 'Mute the timer chime' }).click();
  await expect(panel.getByRole('button', { name: 'Unmute the timer chime' })).toBeVisible();

  await page.reload();
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  await page.getByRole('button', { name: 'Timer' }).click();
  const reopened = page.getByRole('dialog', { name: 'Timer' });
  await expect(reopened.getByRole('button', { name: 'Unmute the timer chime' })).toBeVisible();

  // The panel is already open, so the timer is started from it directly.
  await reopened.getByRole('button', { name: '1 minute' }).click();
  await expect(page.locator('[data-timer-state]')).toHaveAttribute('data-timer-state', 'running');
  await expectSynced(page);

  // The countdown is in the document's `meta`, which the undo manager tracks —
  // so this is one ⌘Z, and it leaves the board with no timer at all.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-timer-state]')).toHaveAttribute('data-timer-state', 'none');

  // ...and redo puts the same countdown back up: an end time, so it comes back
  // as the instant it always was rather than as sixty fresh seconds.
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('[data-timer-state]')).toHaveAttribute('data-timer-state', 'running');
});

test('a timer started after the public page loaded turns up on it within a poll', async ({
  page,
  browser,
}) => {
  // One poll is 30 s, and the snapshot the shared route reads is itself a
  // couple of seconds behind the document. Two polls' worth of room.
  test.setTimeout(150_000);

  await signUp(page);
  await newDiagram(page);

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  // `click`, not `check`: the box reflects what the server says, so it only
  // ticks once `POST …/share` has answered with a token.
  await dialog.getByLabel('Anyone with the link can view').click();
  await expect(dialog.getByLabel('Public link')).toBeVisible();
  const link = await dialog.getByLabel('Public link').inputValue();
  await page.getByRole('button', { name: 'Close share dialog' }).click();

  // A brand new context: no cookies, so this is a reader with no session and
  // no socket — which is the whole reason the page has to poll.
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(link);
  await expect(visitorPage.locator('.react-flow__pane')).toBeVisible();
  // Nobody has started one, and a reader who cannot start one is shown nothing.
  await expect(visitorPage.locator('[data-timer-state]')).toHaveCount(0);

  await startTimer(page, '10 minutes');
  await expectSynced(page);

  // No reload: the page re-reads the two live fields and nothing else.
  const visitorTimer = visitorPage.locator('[data-timer-state]');
  await expect(visitorTimer).toHaveAttribute('data-timer-state', 'running', { timeout: 80_000 });
  await expect(visitorTimer).toContainText(/\d:\d\d/);

  // The board underneath it was never re-loaded — the page is still the one
  // that was handed over, with the reader's own view of it.
  await expect(visitorPage.getByText('View only')).toBeVisible();

  await visitor.close();
});
