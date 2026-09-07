/**
 * Dot voting and the board timer, which are only really themselves with two
 * people on one board: the point of a round is that everybody's dots are hidden
 * until it closes, and the point of a timer is that the same countdown is on
 * everybody's screen.
 *
 * Both live in the diagram — the round and the countdown in the collaborative
 * document's `meta` map, the dots as ordinary node data — so what these tests
 * exercise is the whole path: store, binding, document, socket, other browser.
 */
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

/** Opens a new diagram and waits for its canvas. */
async function newDiagram(page: Page) {
  await page.getByRole('button', { name: 'New Diagram' }).first().click();
  await expect(page).toHaveURL(/\/d\/[^/]+$/);
  const pane = page.locator('.react-flow__pane');
  await expect(pane).toBeVisible();
  return pane;
}

/** Drops one sticky note on the canvas and hands back its node. */
async function drawSticky(page: Page, pane: Locator, at: { x: number; y: number }) {
  const before = await page.locator('.react-flow__node').count();
  await page.keyboard.press('s');
  await pane.click({ position: at });
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
  return page.locator('.react-flow__node').nth(before);
}

/** Everything this window has done has reached the server. */
async function expectSynced(page: Page) {
  await expect(page.locator('[data-collab-sync="synced"]')).toBeVisible();
}

/** Invites `email` as an editor of the open diagram, through the share dialog. */
async function inviteEditor(page: Page, email: string) {
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share' });
  await dialog.getByLabel('Invite by email').fill(email);
  await dialog.getByLabel('Invite as').selectOption('editor');
  await dialog.getByRole('button', { name: 'Invite' }).click();
  await expect(dialog.getByText(email)).toBeVisible();
  // Out of the way: it covers the canvas the two of them are about to work on.
  await page.getByRole('button', { name: 'Close share dialog' }).click();
}

test('two people vote on one sticky and see the total only when the round closes', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signUp(page, 'Ada Lovelace');
  const pane = await newDiagram(page);
  await drawSticky(page, pane, { x: 400, y: 300 });
  await drawSticky(page, pane, { x: 800, y: 300 });
  await expectSynced(page);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestEmail = await signUp(guestPage, 'Grace Hopper');
  await inviteEditor(page, guestEmail);

  await guestPage.goto(page.url());
  await expect(guestPage.locator('.react-flow__node')).toHaveCount(2);
  await expect(guestPage.locator('[data-collab-status="connected"]')).toBeVisible();

  // The two of them vote on the *last* sticky and address it by id in both
  // windows. Last, because React Flow paints the nodes in array order and a
  // neighbour drawn after this one would sit over the badge on its corner; by
  // id, because "the same sticky" is the whole point of the assertions below.
  const votedId = await page.locator('.react-flow__node').last().getAttribute('data-id');
  const voted = page.locator(`.react-flow__node[data-id="${votedId}"]`);
  const guestVoted = guestPage.locator(`.react-flow__node[data-id="${votedId}"]`);
  const otherSticky = page.locator(`.react-flow__node:not([data-id="${votedId}"])`);

  // Ada opens a round with two dots each.
  // Exact: "End voting & show totals" inside the panel would otherwise match too.
  const voteButton = page.getByRole('button', { name: 'Voting', exact: true });
  await voteButton.click();
  const votePanel = page.getByRole('dialog', { name: 'Voting' });
  await votePanel.getByLabel('Dots per person').fill('2');
  await votePanel.getByRole('button', { name: 'Start voting' }).click();
  await voteButton.click();

  // Grace is in the same round: it is board state, so it reaches her window
  // without her asking for it.
  await expect(guestVoted.getByRole('button', { name: 'Vote for this shape' })).toBeVisible({
    timeout: 15_000,
  });

  // Both of them put a dot on it.
  await voted.getByRole('button', { name: 'Vote for this shape' }).click();
  await expect(voted.getByLabel('Your votes: 1')).toBeVisible();
  await guestVoted.getByRole('button', { name: 'Vote for this shape' }).click();
  await expect(guestVoted.getByLabel('Your votes: 1')).toBeVisible();

  // …and neither of them can see a total. That is the whole point of the round:
  // Grace sees her own dot and nothing at all about Ada's.
  await expect(guestVoted.getByLabel(/^\d+ votes?$/)).toHaveCount(0);
  await expect(voted.getByLabel(/^\d+ votes?$/)).toHaveCount(0);
  await expect(guestVoted.getByLabel('Your votes: 1')).toBeVisible();

  // Ada closes the round. The totals appear on both boards, and they agree.
  await voteButton.click();
  await votePanel.getByRole('button', { name: /End voting/ }).click();
  await voteButton.click();

  await expect(voted.getByLabel('2 votes')).toBeVisible({ timeout: 15_000 });
  await expect(guestVoted.getByLabel('2 votes')).toBeVisible({ timeout: 15_000 });
  // The sticky nobody chose gets no badge at all.
  await expect(otherSticky.getByLabel(/^\d+ votes?$/)).toHaveCount(0);

  await guest.close();
});

test('a timer started by one person counts down in the other’s window', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signUp(page, 'Ada Lovelace');
  const pane = await newDiagram(page);
  await drawSticky(page, pane, { x: 400, y: 300 });
  await expectSynced(page);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestEmail = await signUp(guestPage, 'Grace Hopper');
  await inviteEditor(page, guestEmail);

  await guestPage.goto(page.url());
  await expect(guestPage.locator('.react-flow__node')).toHaveCount(1);
  await expect(guestPage.locator('[data-collab-status="connected"]')).toBeVisible();
  // Nobody has started one, so both windows say there is no timer.
  const guestTimer = guestPage.locator('[data-timer-state]');
  await expect(guestTimer).toHaveAttribute('data-timer-state', 'none');

  await page.getByRole('button', { name: 'Timer' }).click();
  await page.getByRole('dialog', { name: 'Timer' }).getByRole('button', { name: '1 minute' }).click();

  // A timer is an *end time*, so Grace's window computes its own countdown from
  // her own clock — there is no ticking number on the wire.
  await expect(guestTimer).toHaveAttribute('data-timer-state', 'running', { timeout: 15_000 });
  await expect(guestTimer).toContainText(/0:5\d/);

  // And anybody on the board can take it down again.
  await guestPage.getByRole('button', { name: 'Stop timer' }).click();
  await expect(page.locator('[data-timer-state]')).toHaveAttribute('data-timer-state', 'none', {
    timeout: 15_000,
  });

  await guest.close();
});
