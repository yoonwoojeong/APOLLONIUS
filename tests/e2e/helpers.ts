import { expect, type CDPSession, type Locator, type Page } from '@playwright/test';

export type Pt = { x: number; y: number };
export type Input = 'mouse' | 'touch';

const cdps = new WeakMap<Page, CDPSession>();

/** One CDP session per page, for real touch input (Playwright's touchscreen only taps). */
async function cdp(page: Page): Promise<CDPSession> {
  let s = cdps.get(page);
  if (!s) {
    s = await page.context().newCDPSession(page);
    cdps.set(page, s);
  }
  return s;
}

type TouchType = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';

/** Dispatches one touch event; `points` are the fingers still down (empty for the last end). */
export async function touch(
  page: Page,
  type: TouchType,
  points: (Pt & { id: number })[],
): Promise<void> {
  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 1, radiusY: 1 })),
  });
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Bounding-box centre of the point labelled `label`, in page coordinates. */
export async function pointCenter(page: Page, label: string): Promise<Pt> {
  return centerOf(page.locator(`[data-kind="point"][data-label="${label}"]`));
}

/** Centre of an element's visible dot (its `.dot`/`.candidate` child when it has one). */
export async function centerOf(loc: Locator): Promise<Pt> {
  const dot = loc.locator('circle.dot, circle.candidate').first();
  const target = (await dot.count()) > 0 ? dot : loc;
  const box = await target.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press at `from`, move in small steps, release at `to`. */
export async function drag(page: Page, from: Pt, to: Pt, input: Input): Promise<void> {
  const steps = 8;
  if (input === 'mouse') {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    await page.mouse.up();
    return;
  }
  await touch(page, 'touchStart', [{ ...from, id: 1 }]);
  for (let i = 1; i <= steps; i++)
    await touch(page, 'touchMove', [{ ...lerp(from, to, i / steps), id: 1 }]);
  await touch(page, 'touchEnd', []);
}

/** A single tap (mouse click or a touch start/end) at `pt`. */
export async function tap(page: Page, pt: Pt, input: Input): Promise<void> {
  if (input === 'mouse') {
    await page.mouse.click(pt.x, pt.y);
    return;
  }
  await touch(page, 'touchStart', [{ ...pt, id: 1 }]);
  await touch(page, 'touchEnd', []);
}

/** Centres of the candidate intersection dots currently shown, top to bottom. */
export async function candidates(page: Page): Promise<Pt[]> {
  const all = await page.locator('[data-kind="candidate"]').all();
  const pts = await Promise.all(all.map((c) => centerOf(c)));
  return pts.sort((a, b) => a.y - b.y || a.x - b.x);
}

const TOOL_NAMES = ['Point', 'Line', 'Circle', 'Perpendicular bisector'] as const;

/** Selects tool `n` (1–4, palette order) by clicking its button; it must end up pressed. */
export async function selectTool(page: Page, n: 1 | 2 | 3 | 4): Promise<void> {
  const btn = page.getByRole('button', { name: TOOL_NAMES[n - 1], exact: true });
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
}

/** The input mode for a Playwright project: touch on the mobile project, mouse otherwise. */
export const inputOf = (projectName: string): Input =>
  projectName === 'mobile' ? 'touch' : 'mouse';

/** The top-bar move counter, e.g. "L 2/4 · E 2/4". */
export const counter = (page: Page): Locator => page.locator('.topbar .counter');

/** From a fresh visit: the title screen's Begin opens level 1. */
export async function beginLevel1(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('[data-kind="point"][data-label="A"]')).toBeVisible();
}

/** Waits until exactly `n` elements of `kind` are in the scene. */
export async function expectCount(page: Page, kind: string, n: number): Promise<void> {
  await expect(page.locator(`[data-kind="${kind}"]`)).toHaveCount(n);
}

/** Draws a circle from point `c` through point `p` (circle tool must be active). */
export async function circleFrom(page: Page, c: string, p: string, input: Input): Promise<void> {
  await drag(page, await pointCenter(page, c), await pointCenter(page, p), input);
}

/**
 * Level 1 by the coach's steps: circle A→B, circle B→A, tap the upper crossing, then lines
 * C→A and C→B.
 */
export async function solveLevel1(page: Page, input: Input): Promise<void> {
  await expect(page.getByRole('button', { name: 'Circle', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await circleFrom(page, 'A', 'B', input);
  await expectCount(page, 'circle', 1);
  await circleFrom(page, 'B', 'A', input);
  await expectCount(page, 'circle', 2);
  const [top] = await candidates(page);
  await tap(page, top!, input);
  await expect(page.locator('[data-kind="point"][data-label="C"]')).toBeVisible();
  await selectTool(page, 2);
  await drag(page, await pointCenter(page, 'C'), await pointCenter(page, 'A'), input);
  await drag(page, await pointCenter(page, 'C'), await pointCenter(page, 'B'), input);
}

/** The stars on the completion card, as earned flags. */
export async function earnedStars(page: Page): Promise<boolean[]> {
  const stars = page.locator('.completion .star');
  await expect(stars).toHaveCount(3);
  return (await stars.evaluateAll((els) => els.map((e) => e.getAttribute('data-earned')))).map(
    (v) => v === 'true',
  );
}
