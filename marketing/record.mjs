// Records gameplay clips for the vertical (9:16, 1080×1920) marketing video.
//
//   pnpm build && node marketing/record.mjs [clip names…]
//
// Uses a running preview at $APOLLONIUS_URL (default http://localhost:4173) or, when none
// answers, starts `pnpm vite preview` on dist/ itself and stops it at the end. Frames come from
// CDP Page.startScreencast (a 360×640 CSS-px window at DPR 3 → 1080×1920 PNGs) with their real
// timestamps, and ffmpeg turns each clip into a constant-30-fps H.264 MP4 at real-time speed.
// Output: marketing/out/*.mp4 and marketing/out/poster.png (git-ignored).

import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'marketing', 'out');
const FRAMES = path.join(OUT, 'frames');
const URL_BASE = process.env.APOLLONIUS_URL ?? 'http://localhost:4173';
const FPS = 30;
const CRF = 16;
const STORAGE_KEY = 'apollonius:v1';
const LEVEL_IDS = [
  'equilateral',
  'perp-bisector',
  'midpoint',
  'perpendicular',
  'angle-bisector',
  'circle-center',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** A short "human" pause: around `ms`, give or take 15 %. */
const beat = (ms = 550) => sleep(ms * (0.85 + Math.random() * 0.3));

// ---------------------------------------------------------------------------------------------
// Preview server

async function reachable(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(URL_BASE)) return null;
  const port = new URL(URL_BASE).port || '4173';
  console.log(`no server at ${URL_BASE}; starting vite preview on dist/`);
  const child = spawn('pnpm', ['vite', 'preview', '--port', port, '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 100; i++) {
    if (await reachable(URL_BASE)) return child;
    await sleep(200);
  }
  throw new Error('vite preview did not come up (did you run `pnpm build`?)');
}

// ---------------------------------------------------------------------------------------------
// Screencast recorder: every frame saved with its CDP timestamp.

class Recorder {
  constructor(cdp, name) {
    this.cdp = cdp;
    this.name = name;
    this.dir = path.join(FRAMES, name);
    this.frames = []; // { file, t }
    this.marks = {};
    this.writes = [];
    this.onFrame = ({ data, metadata, sessionId }) => {
      const file = path.join(this.dir, `f${String(this.frames.length).padStart(5, '0')}.png`);
      this.frames.push({ file, t: metadata.timestamp ?? now() });
      this.writes.push(writeFile(file, Buffer.from(data, 'base64')));
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    };
  }

  async start() {
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
    this.cdp.on('Page.screencastFrame', this.onFrame);
    await this.cdp.send('Page.startScreencast', {
      format: 'png',
      maxWidth: 1080,
      maxHeight: 1920,
      everyNthFrame: 1,
    });
    this.t0 = now();
    // Nudge one repaint so the first frame arrives even on a still page.
    await this.cdp.send('Runtime.evaluate', {
      expression: `document.documentElement.style.outline='0px solid transparent';
        requestAnimationFrame(() => document.documentElement.style.outline='')`,
    });
  }

  mark(label) {
    this.marks[label] = now();
  }

  async stop() {
    this.t1 = now();
    await this.cdp.send('Page.stopScreencast');
    this.cdp.off('Page.screencastFrame', this.onFrame);
    await Promise.all(this.writes);
    if (this.frames.length === 0) throw new Error(`${this.name}: no frames captured`);
    console.log(
      `${this.name}: ${this.frames.length} frames over ${(this.t1 - this.t0).toFixed(2)} s`,
    );
  }

  /** The frame on screen at time `t`. */
  frameAt(t) {
    let f = this.frames[0];
    for (const x of this.frames) if (x.t <= t) f = x;
    return f;
  }

  /** Encodes the span [from, to] (seconds, absolute) as a CFR MP4. */
  async encode(outName, from = this.t0, to = this.t1) {
    const fs = this.frames;
    const first = fs[0].t;
    from = Math.max(from, Math.min(first, to));
    const span = [];
    for (let i = 0; i < fs.length; i++) {
      const start = Math.max(fs[i].t, from);
      const end = Math.min(i + 1 < fs.length ? fs[i + 1].t : to, to);
      if (end > start) span.push({ file: fs[i].file, d: end - start });
    }
    const lines = ['ffconcat version 1.0'];
    for (const s of span) lines.push(`file '${s.file}'`, `duration ${s.d.toFixed(6)}`);
    lines.push(`file '${span[span.length - 1].file}'`); // the demuxer drops the last duration
    const list = path.join(this.dir, `${outName}.ffconcat`);
    await writeFile(list, lines.join('\n') + '\n');
    const out = path.join(OUT, outName);
    const r = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-vf',
        `fps=${FPS},scale=1080:1920:flags=lanczos,format=yuv420p`,
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        String(CRF),
        '-r',
        String(FPS),
        '-movflags',
        '+faststart',
        '-an',
        out,
      ],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${outName}`);
    console.log(`  → ${path.relative(ROOT, out)} (${(to - from).toFixed(2)} s)`);
  }
}

// ---------------------------------------------------------------------------------------------
// Human-looking touch input over CDP (so the canvas sees real touch pointers and the loupe).

function inputFor(page, cdp) {
  const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1, radiusX: 1, radiusY: 1 })),
    });

  /** Finger down at `pts[0]`, eased moves through each waypoint, release at the last one. */
  async function drag(pts, { ms = 600, hold = 140, settle = 160 } = {}) {
    const durations = Array.isArray(ms) ? ms : [ms];
    await touch('touchStart', [pts[0]]);
    await sleep(hold);
    for (let s = 1; s < pts.length; s++) {
      const a = pts[s - 1];
      const b = pts[s];
      const d = durations[Math.min(s - 1, durations.length - 1)];
      const t0 = Date.now();
      for (;;) {
        const t = Math.min(1, (Date.now() - t0) / d);
        await touch('touchMove', [lerp(a, b, ease(t))]);
        if (t >= 1) break;
        await sleep(14);
      }
    }
    await sleep(settle);
    await touch('touchEnd', []);
  }

  async function tap(pt) {
    await touch('touchStart', [pt]);
    await sleep(90);
    await touch('touchEnd', []);
  }

  async function centerOf(loc) {
    const dot = loc.locator('circle.dot, circle.candidate').first();
    const target = (await dot.count()) > 0 ? dot : loc;
    const box = await target.boundingBox();
    if (!box) throw new Error('element has no bounding box');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  const point = (label) => centerOf(page.locator(`[data-kind="point"][data-label="${label}"]`));
  const candidates = async () => {
    const all = await page.locator('[data-kind="candidate"]').all();
    const pts = await Promise.all(all.map((c) => centerOf(c)));
    return pts.sort((a, b) => a.y - b.y || a.x - b.x);
  };
  const tapButton = async (name) => {
    const btn = page.getByRole('button', { name, exact: true }).first();
    await btn.waitFor({ state: 'visible' });
    await tap(await centerOf(btn));
  };
  const count = (kind) => page.locator(`[data-kind="${kind}"]`).count();
  const waitCount = (kind, n) =>
    page.waitForFunction(
      ([k, m]) => document.querySelectorAll(`[data-kind="${k}"]`).length === m,
      [kind, n],
    );

  return { drag, tap, point, candidates, tapButton, count, waitCount };
}

// ---------------------------------------------------------------------------------------------
// Sessions

function seed(levelsSolved, { tools = [] } = {}) {
  const levels = Object.fromEntries(
    LEVEL_IDS.slice(0, levelsSolved).map((id) => [id, { stars: [true, true, true], hintsUsed: 0 }]),
  );
  return { version: 1, levels, unlockedTools: tools, theme: 'light' };
}

async function session(browser, progress) {
  // No viewport emulation: the window itself is 360×640 at a forced DPR of 3 (see launch), the
  // only way the screencast delivers device pixels; viewport emulation caps it at CSS pixels.
  const context = await browser.newContext({ viewport: null, colorScheme: 'light' });
  if (progress) {
    await context.addInitScript(
      ([k, v]) => {
        // Seed once per context, so progress made while recording survives reloads.
        if (!sessionStorage.getItem('seeded')) {
          localStorage.setItem(k, v);
          sessionStorage.setItem('seeded', '1');
        }
      },
      [STORAGE_KEY, JSON.stringify(progress)],
    );
  }
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const io = inputFor(page, cdp);
  const ready = async () => {
    await page.evaluate(() => document.fonts.ready);
    await sleep(400);
  };
  return { context, page, cdp, io, ready };
}

/** Opens level `n` from the map (via Continue on the title screen). */
async function openFromMap(page, n) {
  await page.goto(URL_BASE);
  await page.getByRole('button', { name: /Continue|Begin/ }).click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^Level ${n}:`) }).click();
  await page.locator('[data-testid="canvas"]').waitFor();
}

// ---------------------------------------------------------------------------------------------
// Clips

/** 01-hook + 02-solve: Level 1, coach hidden (seeded as solved), solved by the classic apex. */
async function clipHookSolve(browser) {
  const { context, page, cdp, io, ready } = await session(browser, seed(1));
  await openFromMap(page, 1);
  await ready();
  const rec = new Recorder(cdp, 'level1');
  await rec.start();
  await sleep(1700); // a beat of stillness on the givens

  await io.drag([await io.point('A'), await io.point('B')], { ms: 650 });
  await io.waitCount('circle', 1);
  await sleep(1300);
  rec.mark('split');
  await beat(450);

  await io.drag([await io.point('B'), await io.point('A')], { ms: 650 });
  await io.waitCount('circle', 2);
  await beat(600);
  const [top] = await io.candidates();
  await io.tap(top);
  await page.locator('[data-kind="point"][data-label="C"]').waitFor();
  await beat(550);
  await io.tapButton('Line');
  await beat(450);
  await io.drag([await io.point('C'), await io.point('A')], { ms: 560 });
  await beat(500);
  await io.drag([await io.point('C'), await io.point('B')], { ms: 560 });
  await page.getByRole('heading', { name: 'Solved' }).waitFor();
  rec.mark('solved');
  await sleep(3800);
  await rec.stop();

  await rec.encode('01-hook.mp4', rec.t0, rec.marks.split);
  await rec.encode('02-solve.mp4', rec.marks.split, rec.t1);
  await copyFile(rec.frameAt(rec.marks.solved + 2.6).file, path.join(OUT, 'poster.png'));
  await context.close();
}

/** 03-snap: a slow, wandering drag with the loupe, a snap onto B; then the LOWER apex. */
async function clipSnap(browser) {
  const { context, page, cdp, io, ready } = await session(browser, seed(1));
  await openFromMap(page, 1);
  await ready();
  const rec = new Recorder(cdp, 'snap');
  await rec.start();
  await sleep(700);

  const a = await io.point('A');
  const b = await io.point('B');
  const ab = dist(a, b);
  // Wander out past B, drift back until the ghost locks onto B, hold there, release.
  await io.drag(
    [
      a,
      { x: a.x + ab * 0.55, y: a.y - ab * 0.32 },
      { x: b.x + 26, y: b.y - 30 },
      { x: b.x + 9, y: b.y - 8 },
      b,
    ],
    { ms: [700, 650, 650, 450], hold: 220, settle: 650 },
  );
  await io.waitCount('circle', 1);
  await beat(650);
  await io.drag([await io.point('B'), await io.point('A')], { ms: 620 });
  await io.waitCount('circle', 2);
  await beat(700);
  const cs = await io.candidates();
  await io.tap(cs[cs.length - 1]); // the lower crossing
  await page.locator('[data-kind="point"][data-label="C"]').waitFor();
  await beat(600);
  await io.tapButton('Line');
  await beat(400);
  await io.drag([await io.point('C'), await io.point('A')], { ms: 560 });
  await beat(450);
  await io.drag([await io.point('C'), await io.point('B')], { ms: 560 });
  await page.getByRole('heading', { name: 'Solved' }).waitFor();
  await sleep(2400);
  await rec.stop();
  await rec.encode('03-snap.mp4');
  await context.close();
}

/** 04-hints: Level 2 with one circle drawn; Hint → More help → More help. */
async function clipHints(browser) {
  const { context, page, cdp, io, ready } = await session(browser, seed(1));
  await openFromMap(page, 2);
  await ready();
  await io.drag([await io.point('A'), await io.point('B')], { ms: 300, hold: 40, settle: 40 });
  await io.waitCount('circle', 1);
  await sleep(800);
  const rec = new Recorder(cdp, 'hints');
  await rec.start();
  await sleep(800);
  await io.tapButton('Hint');
  await sleep(1500);
  await io.tapButton('More help');
  await sleep(1500);
  await io.tapButton('More help');
  await io.waitCount('hint-ghost', 1);
  await sleep(2200);
  await rec.stop();
  await rec.encode('04-hints.mp4');
  await context.close();
}

/** 05-tool: Level 4 just after unlocking the bisector: reveal, tip, then one bisector A→P. */
async function clipTool(browser) {
  const { context, page, cdp, io, ready } = await session(
    browser,
    seed(3, { tools: ['perp-bisector'] }),
  );
  await page.goto(URL_BASE);
  await ready();
  const rec = new Recorder(cdp, 'tool');
  await rec.start();
  await sleep(300);
  rec.mark('open');
  await page.getByRole('button', { name: 'Continue' }).click(); // resumes Level 4
  await page.locator('[data-testid="canvas"]').waitFor();
  await sleep(2300); // the reveal ring and the tip
  await io.tapButton('Perpendicular bisector');
  await beat(550);
  await io.drag([await io.point('A'), await io.point('P')], { ms: 650 });
  await sleep(1800);
  await rec.stop();
  // Start just before the tap so the clip opens on the level appearing.
  await rec.encode('05-tool.mp4', rec.marks.open + 0.1, rec.t1);
  await context.close();
}

/** 06-endcard-bg: the fresh title screen, its arc underline drawing in. */
async function clipEndcard(browser) {
  const { context, page, cdp, ready } = await session(browser, null);
  await page.goto(URL_BASE);
  await ready();
  const rec = new Recorder(cdp, 'title');
  await rec.start();
  await sleep(300);
  // Blur the auto-focused button so no focus ring shows; then replay the entrance.
  await page.reload();
  rec.mark('load');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.activeElement?.blur?.());
  await sleep(5600);
  await rec.stop();
  await rec.encode('06-endcard-bg.mp4', rec.marks.load, rec.t1);
  await context.close();
}

const CLIPS = {
  level1: clipHookSolve,
  snap: clipSnap,
  hints: clipHints,
  tool: clipTool,
  title: clipEndcard,
};

async function main() {
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(CLIPS);
  for (const n of names)
    if (!CLIPS[n]) throw new Error(`unknown clip ${n}; one of ${Object.keys(CLIPS)}`);
  await mkdir(OUT, { recursive: true });
  const server = await ensureServer();
  // The headless shell honours these (new headless does not): a 360×640 CSS-px phone window
  // rendered at 1080×1920 device pixels.
  const browser = await chromium.launch({
    args: ['--force-device-scale-factor=3', '--window-size=360,640', '--hide-scrollbars'],
  });
  try {
    for (const n of names) await CLIPS[n](browser);
  } finally {
    await browser.close();
    if (server) process.kill(-server.pid, 'SIGTERM');
  }
  if (!process.env.KEEP_FRAMES) await rm(FRAMES, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
