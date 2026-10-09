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

/** An empty diagram made through the API, opened and ready to draw on. */
async function openEmptyBoard(page: Page, title: string): Promise<void> {
  const id = await page.evaluate(async (boardTitle) => {
    const r = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: boardTitle, data: { version: 3, nodes: [], edges: [] } }),
    });
    return ((await r.json()) as { id: string }).id;
  }, title);
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  await page.locator('.react-flow__pane').click({ position: { x: 400, y: 300 } });
}

/**
 * Puts `text` on the system clipboard, from inside the page.
 *
 * Through a cast because the `navigator` this file's types know about is
 * Node's, which has no `clipboard` — the same reason `e2e/diagram.spec.ts`
 * casts in its own paste tests.
 */
async function writeClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (value) =>
      (navigator as unknown as { clipboard: { writeText(t: string): Promise<void> } }).clipboard.writeText(value),
    text,
  );
}

const tableNode = (page: Page) => page.locator('.react-flow__node [data-node-type="table"]');

test('E draws a 3×3 table, and its cells are typed into and tabbed through', async ({ page }) => {
  await signUp(page);
  await openEmptyBoard(page, 'Tables');

  await page.keyboard.press('e');
  await page.locator('.react-flow__pane').click({ position: { x: 420, y: 260 } });

  await expect(tableNode(page)).toHaveCount(1);
  await expect(tableNode(page).locator('tr')).toHaveCount(3);
  await expect(tableNode(page).locator('tr').first().locator('td')).toHaveCount(3);

  // Double-click opens a cell; Tab commits it and moves to the next one.
  const firstCell = tableNode(page).locator('tr').first().locator('td').first();
  await firstCell.dblclick();
  await page.keyboard.type('Name');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Role');
  await page.keyboard.press('Escape');

  await expect(tableNode(page).getByText('Name', { exact: true })).toBeVisible();
  await expect(tableNode(page).getByText('Role', { exact: true })).toBeVisible();
  // Nothing but the table: an open cell reports `editingNodeId`, so a letter
  // that is also a tool key ("m", the mind map) stays in the cell it was typed
  // into rather than reaching the canvas's keyboard handler.
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
});

test('the toolbar adds a row to the selected table', async ({ page }) => {
  await signUp(page);
  await openEmptyBoard(page, 'Table rows');

  await page.keyboard.press('e');
  await page.locator('.react-flow__pane').click({ position: { x: 420, y: 260 } });
  await expect(tableNode(page).locator('tr')).toHaveCount(3);

  await tableNode(page).click();
  const toolbar = page.getByRole('toolbar', { name: 'Selection toolbar' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Add row' }).click();

  await expect(tableNode(page).locator('tr')).toHaveCount(4);

  // One click, one ⌘Z.
  await page.keyboard.press('Meta+z');
  await expect(tableNode(page).locator('tr')).toHaveCount(3);
});

test('a pasted Markdown table becomes a table with a header row', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signUp(page);
  await openEmptyBoard(page, 'Pasted table');

  await writeClipboard(page, '| Name | Role |\n| --- | --- |\n| Ada | Maths |\n| Alan | Machines |');

  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 300, y: 220 } });
  await page.getByRole('menuitem', { name: 'Paste as table' }).click();

  await expect(tableNode(page)).toHaveCount(1);
  await expect(tableNode(page).locator('tr')).toHaveCount(3);
  for (const cell of ['Name', 'Role', 'Ada', 'Maths', 'Alan', 'Machines']) {
    await expect(tableNode(page).getByText(cell, { exact: true })).toBeVisible();
  }

  // The `|---|` rule is what says the first row is a header, and the toolbar
  // reads it back as the pressed state of its own button.
  await tableNode(page).click();
  await expect(
    page.getByRole('toolbar', { name: 'Selection toolbar' }).getByRole('button', { name: 'Header row' }),
  ).toHaveClass(/bg-accent-500/);
});

test('plain paste leaves a single HTML cell alone and falls back to text for unsupported table HTML', async ({ page }) => {
  await signUp(page);
  await openEmptyBoard(page, 'Paste fall-through');

  const dispatchPaste = (html: string, plainText: string) => page.evaluate(({ htmlText, text }) => {
    const browser = globalThis as unknown as {
      DataTransfer: new () => { setData(type: string, value: string): void };
      ClipboardEvent: new (
        type: string,
        init: { bubbles: boolean; cancelable: boolean; clipboardData: object },
      ) => { defaultPrevented: boolean };
      dispatchEvent(event: object): boolean;
    };
    const clipboardData = new browser.DataTransfer();
    clipboardData.setData('text/plain', text);
    clipboardData.setData('text/html', htmlText);
    const event = new browser.ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    browser.dispatchEvent(event);
    return event.defaultPrevented;
  }, { htmlText: html, text: plainText });

  // A copied 1×1 Excel range is prose for the table parser, and the browser's
  // ordinary paste remains available.
  expect(await dispatchPaste('<table><tr><td>Only cell</td></tr></table>', 'Only cell')).toBe(false);
  await expect(tableNode(page)).toHaveCount(0);

  // A page-layout navigation table is not spreadsheet data when its plain
  // clipboard text is ordinary prose, so the browser's paste remains available.
  expect(await dispatchPaste(
    '<table><tr><td><a href="/">Home</a></td><td><a href="/products">Products</a></td></tr><tr><td><a href="/about">About</a></td><td><a href="/contact">Contact</a></td></tr></table>',
    'Home Products About Contact',
  )).toBe(false);
  await expect(tableNode(page)).toHaveCount(0);

  // A page-layout table is refused, then the valid TSV representation is used.
  expect(await dispatchPaste(
    '<table><tr><td>Logo <img src="logo.png" alt="Logo"></td><td>Navigation</td></tr><tr><td>Article</td><td>Footer</td></tr></table>',
    'Name\tRole\nAda\tMaths',
  )).toBe(true);
  await expect(tableNode(page).locator('tr')).toHaveCount(2);
  for (const cell of ['Name', 'Role', 'Ada', 'Maths']) {
    await expect(tableNode(page).getByText(cell, { exact: true })).toBeVisible();
  }
});

test('pasting Excel HTML keeps cell formatting', async ({ page }) => {
  await signUp(page);
  await openEmptyBoard(page, 'Excel table formatting');

  const plain = 'Metric Amount Transaction Value $0.12 Total $0.12';
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta name="ProgId" content="Excel.Sheet"><style>
        .xl65 { background: #203764; color: #FFFFFF; font-weight: 700; }
        .xl66 { font-weight: 700; }
        .xl68 { background: yellow; color: windowtext; font-weight: 700; }
      </style></head>
      <body><table>
        <col width="180"><col width="100">
        <tr><td class="xl65">Metric</td><td class="xl65">Amount</td></tr>
        <tr><td class="xl66">Transaction Value</td><td>$0.12</td></tr>
        <tr><td class="xl68">Total</td><td class="xl68">$0.12</td></tr>
      </table></body>
    </html>`;

  await page.evaluate(({ plainText, htmlText }) => {
    // `page.evaluate` runs in the browser, but this test file is typechecked
    // with Node globals. Describe only the browser APIs this callback uses.
    const browser = globalThis as unknown as {
      DataTransfer: new () => { setData(type: string, value: string): void };
      ClipboardEvent: new (
        type: string,
        init: { bubbles: boolean; cancelable: boolean; clipboardData: object },
      ) => object;
      dispatchEvent(event: object): boolean;
    };
    const clipboardData = new browser.DataTransfer();
    clipboardData.setData('text/plain', plainText);
    clipboardData.setData('text/html', htmlText);
    browser.dispatchEvent(new browser.ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, { plainText: plain, htmlText: html });

  await expect(tableNode(page)).toHaveCount(1);
  const header = tableNode(page).locator('tr').first().locator('td').first();
  await expect.poll(() => header.evaluate((cell) => (
    globalThis as unknown as {
      getComputedStyle(element: object): { backgroundColor: string };
    }
  ).getComputedStyle(cell).backgroundColor)).toBe('rgb(32, 55, 100)');

  const section = tableNode(page).getByText('Transaction Value', { exact: true });
  await expect.poll(() => section.evaluate((cell) => (
    globalThis as unknown as {
      getComputedStyle(element: object): { fontWeight: string };
    }
  ).getComputedStyle(cell).fontWeight)).toBe('700');

  const totalCell = tableNode(page).locator('tr').nth(2).locator('td').first();
  await expect.poll(() => totalCell.evaluate((cell) => (
    globalThis as unknown as {
      getComputedStyle(element: object): { backgroundColor: string };
    }
  ).getComputedStyle(cell).backgroundColor)).toBe('rgb(255, 255, 0)');
  await expect.poll(() => totalCell.locator('div').evaluate((label) => (
    globalThis as unknown as {
      getComputedStyle(element: object): { color: string };
    }
  ).getComputedStyle(label).color)).toBe('rgb(24, 26, 36)');
});

test('desktop Excel puts a picture of the range on the clipboard too, and the table wins', async ({ page }) => {
  await signUp(page);
  await openEmptyBoard(page, 'Excel table over picture');

  // What desktop Excel copies: tab-separated text, its HTML, and a PNG of the
  // range. The PNG used to win and the paste arrived as a picture of a table.
  const plain = 'Metric\tAmount\nTotal\t$0.12';
  const html = `
    <html xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta name="ProgId" content="Excel.Sheet"><style>
        .xl65 { background: #203764; color: #FFFFFF; font-weight: 700; }
      </style></head>
      <body><table>
        <tr><td class="xl65">Metric</td><td class="xl65">Amount</td></tr>
        <tr><td>Total</td><td>$0.12</td></tr>
      </table></body>
    </html>`;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  await page.evaluate(({ plainText, htmlText, pngBase64 }) => {
    const browser = globalThis as unknown as {
      DataTransfer: new () => {
        setData(type: string, value: string): void;
        items: { add(file: object): void };
      };
      File: new (bits: object[], name: string, init: { type: string }) => object;
      Uint8Array: { from(data: string, map: (c: string) => number): object };
      atob(data: string): string;
      ClipboardEvent: new (
        type: string,
        init: { bubbles: boolean; cancelable: boolean; clipboardData: object },
      ) => object;
      dispatchEvent(event: object): boolean;
    };
    const clipboardData = new browser.DataTransfer();
    clipboardData.setData('text/plain', plainText);
    clipboardData.setData('text/html', htmlText);
    const bytes = browser.Uint8Array.from(browser.atob(pngBase64), (c) => c.charCodeAt(0));
    clipboardData.items.add(new browser.File([bytes], 'image.png', { type: 'image/png' }));
    browser.dispatchEvent(new browser.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, { plainText: plain, htmlText: html, pngBase64: png });

  await expect(tableNode(page)).toHaveCount(1);
  await expect(page.locator('.react-flow__node img')).toHaveCount(0);
  const header = tableNode(page).locator('tr').first().locator('td').first();
  await expect.poll(() => header.evaluate((cell) => (
    globalThis as unknown as { getComputedStyle(element: object): { backgroundColor: string } }
  ).getComputedStyle(cell).backgroundColor)).toBe('rgb(32, 55, 100)');
});

test('a screenshot that is not a spreadsheet still pastes as an image', async ({ page }) => {
  await signUp(page);
  await openEmptyBoard(page, 'Plain image paste');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.evaluate((pngBase64) => {
    const browser = globalThis as unknown as {
      DataTransfer: new () => { items: { add(file: object): void } };
      File: new (bits: object[], name: string, init: { type: string }) => object;
      Uint8Array: { from(data: string, map: (c: string) => number): object };
      atob(data: string): string;
      ClipboardEvent: new (
        type: string,
        init: { bubbles: boolean; cancelable: boolean; clipboardData: object },
      ) => object;
      dispatchEvent(event: object): boolean;
    };
    const clipboardData = new browser.DataTransfer();
    const bytes = browser.Uint8Array.from(browser.atob(pngBase64), (c) => c.charCodeAt(0));
    clipboardData.items.add(new browser.File([bytes], 'screenshot.png', { type: 'image/png' }));
    browser.dispatchEvent(new browser.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, png);
  await expect(page.locator('.react-flow__node img')).toHaveCount(1);
  await expect(tableNode(page)).toHaveCount(0);
});
