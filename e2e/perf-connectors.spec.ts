/**
 * Frame-time benchmark for the gestures that hurt on a big board: dragging a
 * connected shape, drawing a connector with the connector tool, dragging a
 * connector's end across other shapes, dragging a shape along a row with the
 * alignment guides firing, box-selecting and dragging a block of shapes, and
 * panning and zooming with the wheel.
 *
 * It is a measurement, not an assertion, so it is **skipped unless `PERF=1`**
 * — the normal `npm run test:e2e` and CI never run it:
 *
 *     PERF=1 npx playwright test e2e/perf-connectors.spec.ts
 *
 * The board is 150 rectangles in a grid with 100 elbow connectors between
 * neighbours (`PERF_SIZE=large`: 600 rectangles and 450 connectors), written through `POST /api/diagrams` before it is first opened
 * (so it is seeded into its document exactly as any stored diagram is). Each
 * gesture is 60 pointer moves, one per animation frame — the cadence a real
 * pointer is delivered at — while a `requestAnimationFrame` sampler records
 * frame intervals and a `longtask` observer counts tasks over 50 ms. Results
 * go to stdout and to `test-results/perf-connectors[-large].json`.
 *
 * `PERF_PROFILE=1` also records a CPU profile of every gesture through the
 * DevTools protocol and prints the functions with the most self time (the
 * profiler slows the page, so frame times from such a run are not comparable
 * with a plain one).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type CDPSession, type Page } from '@playwright/test';

test.skip(!process.env.PERF, 'benchmark: run with PERF=1');
// The config's `retain-on-failure` trace snapshots the whole DOM after every
// pointer move — on the large board that alone was ~1.8 s of main-thread work
// per gesture, and none of it the app's.
test.use({ trace: 'off', screenshot: 'off' });

const LARGE = process.env.PERF_SIZE === 'large';
const COLS = LARGE ? 30 : 15;
const ROWS = LARGE ? 20 : 10;
const EDGES = LARGE ? 450 : 100;
const PROFILE = !!process.env.PERF_PROFILE;
const STEP_X = 200;
const STEP_Y = 130;
const W = 120;
const H = 60;
const STEPS = 60;

const nodeId = (r: number, c: number) => `n-${r}-${c}`;

function board() {
  const nodes = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      nodes.push({
        id: nodeId(r, c),
        type: 'shape',
        position: { x: c * STEP_X, y: r * STEP_Y },
        width: W,
        height: H,
        data: { label: `${r}·${c}`, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
      });
    }
  }
  // The shape of `makeEdgeData('elbow')`, pinned to the middles of the facing
  // sides the way `onConnect` pins a handle-drawn connector.
  const edge = (id: string, source: string, target: string, from: string, to: string) => ({
    id,
    source,
    target,
    type: 'connector',
    data: {
      connectorType: 'elbow',
      stroke: '#788896',
      strokeStyle: 'solid',
      label: '',
      startArrowStyle: 'none',
      endArrowStyle: 'arrow',
      sourceAnchor: { side: from, t: 0.5 },
      targetAnchor: { side: to, t: 0.5 },
    },
  });
  const horizontal = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      if ((r + c) % 2 === 0) horizontal.push(edge(`h-${r}-${c}`, nodeId(r, c), nodeId(r, c + 1), 'right', 'left'));
    }
  }
  const vertical = [];
  for (let c = 1; c < COLS; c += 3) {
    for (let r = 0; r < ROWS - 1; r++) vertical.push(edge(`v-${r}-${c}`, nodeId(r, c), nodeId(r + 1, c), 'bottom', 'top'));
  }
  const edges = [...horizontal, ...vertical].slice(0, EDGES);
  return { version: 3, nodes, edges, viewport: { x: 40, y: 120, zoom: 0.4 } };
}

async function signUp(page: Page) {
  const email = `e2e-perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Perf User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My Diagrams' })).toBeVisible();
}

interface GestureStats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  longTasks: number;
  longTaskMs: number;
  totalMs: number;
}

async function startSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __perf: { stamps: number[]; long: number[]; running: boolean; obs?: PerformanceObserver } };
    const perf = { stamps: [] as number[], long: [] as number[], running: true, obs: undefined as PerformanceObserver | undefined };
    w.__perf = perf;
    const tick = (t: number) => {
      if (!perf.running) return;
      perf.stamps.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      perf.obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) perf.long.push(entry.duration);
      });
      perf.obs.observe({ type: 'longtask', buffered: false });
    } catch {
      // No longtask support: the count stays at zero.
    }
  });
}

async function stopSampler(page: Page): Promise<GestureStats> {
  const raw = await page.evaluate(async () => {
    // One more frame, so the work the last move scheduled is inside the window.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const w = window as unknown as { __perf: { stamps: number[]; long: number[]; running: boolean; obs?: PerformanceObserver } };
    w.__perf.running = false;
    w.__perf.obs?.disconnect();
    return { stamps: w.__perf.stamps, long: w.__perf.long };
  });
  const deltas = raw.stamps.slice(1).map((t, i) => t - raw.stamps[i]).sort((a, b) => a - b);
  const pct = (p: number) => deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))] ?? 0;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    frames: deltas.length,
    p50: round(pct(0.5)),
    p95: round(pct(0.95)),
    max: round(deltas[deltas.length - 1] ?? 0),
    longTasks: raw.long.length,
    longTaskMs: round(raw.long.reduce((a, b) => a + b, 0)),
    totalMs: round((raw.stamps[raw.stamps.length - 1] ?? 0) - (raw.stamps[0] ?? 0)),
  };
}

/** Moves the pointer from `from` to `to` in `STEPS` moves, one per frame. */
async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
}

async function centreOf(page: Page, id: string) {
  const box = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}

/** The functions with the most self time in a CDP CPU profile, in ms. */
function topSelf(profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }, n = 12) {
  const byNode = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<string, number>();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    const { functionName, url, lineNumber } = byNode.get(id)!.callFrame;
    const file = url.replace(/^.*\/(src|node_modules\/\.vite\/deps)\//, '').replace(/\?.*$/, '');
    const key = `${functionName || '(anonymous)'} ${file ? `${file}:${lineNumber + 1}` : ''}`.trim();
    self.set(key, (self.get(key) ?? 0) + dt);
    if (functionName !== '(idle)' && functionName !== '(program)') total += dt;
  });
  return {
    busyMs: Math.round(total),
    top: [...self.entries()]
      .filter(([k]) => !k.startsWith('(idle)'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, ms]) => `${ms.toFixed(1).padStart(7)} ms  ${k}`),
  };
}

/** Measures one gesture: frame times always, a CPU profile with `PERF_PROFILE`. */
async function measure(page: Page, cdp: CDPSession | null, profiles: Record<string, unknown>, name: string, gesture: () => Promise<void>) {
  if (cdp) await cdp.send('Profiler.start');
  await startSampler(page);
  await gesture();
  const stats = await stopSampler(page);
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    profiles[name] = topSelf(profile as never);
    // The whole profile too, for DevTools' Performance panel.
    mkdirSync('test-results/profiles', { recursive: true });
    writeFileSync(`test-results/profiles/${name}${LARGE ? '-large' : ''}.cpuprofile`, JSON.stringify(profile));
  }
  return stats;
}

test('connector gestures on a big board', async ({ page }) => {
  test.setTimeout(LARGE ? 600_000 : 180_000);
  await page.setViewportSize({ width: 1400, height: 800 });
  await signUp(page);
  const data = board();
  const id = await page.evaluate(async (body) => {
    const r = await fetch('/api/diagrams', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await r.json()) as { id: string }).id;
  }, { title: 'Perf board', data });
  await page.goto(`/d/${id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(ROWS * COLS);
  await expect(page.locator('.react-flow__edge')).toHaveCount(data.edges.length);
  await expect(page.locator('[data-collab-sync="synced"]')).toBeVisible();
  // Let the opening work (binding, thumbnail, fonts) settle.
  await page.waitForTimeout(LARGE ? 3000 : 1500);

  const results: Record<string, GestureStats> = {};
  const profiles: Record<string, unknown> = {};
  let cdp: CDPSession | null = null;
  if (PROFILE) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  }

  // (a) Drag one connected shape across the board.
  {
    const from = await centreOf(page, nodeId(4, 7));
    const to = { x: from.x + 360, y: from.y + 170 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    results.dragShape = await measure(page, cdp, profiles, 'dragShape', () => glide(page, from, to));
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // (b) Draw a connector with the connector tool from one shape to another.
  {
    await page.keyboard.press('c');
    const from = await centreOf(page, nodeId(1, 1));
    const to = await centreOf(page, nodeId(8, 12));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    results.drawConnector = await measure(page, cdp, profiles, 'drawConnector', () => glide(page, from, to));
    await page.mouse.up();
    await expect(page.locator('.react-flow__edge')).toHaveCount(data.edges.length + 1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // (c) Drag a connector's end across several shapes.
  {
    const a = await centreOf(page, nodeId(2, 2));
    const b = await centreOf(page, nodeId(2, 3));
    // The run between two facing sides of h-2-2, in the middle of the gap.
    await page.mouse.click((a.box.x + a.box.width + b.box.x) / 2, a.y);
    const end = page.locator('.connector-joint--endpoint').nth(1);
    await expect(end).toBeVisible();
    const e = (await end.boundingBox())!;
    const from = { x: e.x + e.width / 2, y: e.y + e.height / 2 };
    const to = await centreOf(page, nodeId(7, 11));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    results.dragConnectorEnd = await measure(page, cdp, profiles, 'dragConnectorEnd', () => glide(page, from, to));
    await page.mouse.up();
    // The end really travelled: it is pinned to the shape it was released on.
    const moved = (await page.locator('.connector-joint--endpoint').nth(1).boundingBox())!;
    const box = to.box;
    expect(moved.x + moved.width / 2).toBeGreaterThan(box.x - 20);
    expect(moved.x + moved.width / 2).toBeLessThan(box.x + box.width + 20);
    expect(moved.y + moved.height / 2).toBeGreaterThan(box.y - 20);
    expect(moved.y + moved.height / 2).toBeLessThan(box.y + box.height + 20);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // (d) Drag a shape along a row with the alignment guides firing: its top,
  // centre and bottom stay level with the row's, so every frame snaps.
  {
    const from = await centreOf(page, nodeId(9, 3));
    const to = { x: from.x + 420, y: from.y + 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    let sawGuide = false;
    results.dragWithGuides = await measure(page, cdp, profiles, 'dragWithGuides', async () => {
      await glide(page, from, to);
      sawGuide = (await page.locator('.alignment-guide').count()) > 0;
    });
    await page.mouse.up();
    expect(sawGuide).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // (e) Box-select a 4×5 block of shapes and drag the block.
  {
    const tl = await centreOf(page, nodeId(5, 1));
    const br = await centreOf(page, nodeId(8, 5));
    // From empty board above-left of the block to past its far corner.
    const start = { x: tl.box.x - 12, y: tl.box.y - 12 };
    const end = { x: br.box.x + br.box.width + 12, y: br.box.y + br.box.height + 12 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(20);
    const from = await centreOf(page, nodeId(6, 3));
    const to = { x: from.x + 300, y: from.y + 140 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    results.dragSelection = await measure(page, cdp, profiles, 'dragSelection', () => glide(page, from, to));
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // The dashboard thumbnail: the edits above leave it due, and once the board
  // has been quiet it is captured on an idle turn — measured on its own so it
  // does not land inside whichever gesture happens to follow it.
  {
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().endsWith(`/api/diagrams/${id}`) &&
        (r.request().postData() ?? '').includes('"thumbnail"'),
      { timeout: 45_000 },
    );
    results.thumbnail = await measure(page, cdp, profiles, 'thumbnail', async () => {
      await saved;
    });
    await page.waitForTimeout(500);
  }

  // (f) Pan across the board with the wheel, then zoom in and out (⌃ + wheel
  // is the browser's pinch).
  {
    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    results.panZoom = await measure(page, cdp, profiles, 'panZoom', async () => {
      for (let i = 0; i < STEPS; i++) {
        const k = i < STEPS / 2 ? 1 : -1;
        await page.mouse.wheel(28 * k, 14 * k);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      }
      await page.keyboard.down('Control');
      for (let i = 0; i < STEPS; i++) {
        await page.mouse.wheel(0, i < STEPS / 2 ? -6 : 6);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      }
      await page.keyboard.up('Control');
    });
  }

  const label = process.env.PERF_LABEL ?? 'run';
  const report = { label, at: new Date().toISOString(), board: { shapes: ROWS * COLS, connectors: data.edges.length }, results, profiles };
  console.log(`\nperf-connectors (${label}, ${ROWS * COLS} shapes, ${data.edges.length} connectors)`);
  console.table(results);
  for (const [name, p] of Object.entries(profiles)) {
    const { busyMs, top } = p as { busyMs: number; top: string[] };
    console.log(`\n${name}: ${busyMs} ms busy\n${top.join('\n')}`);
  }
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/perf-connectors${LARGE ? '-large' : ''}${PROFILE ? '-profile' : ''}.json`, JSON.stringify(report, null, 2));
});
