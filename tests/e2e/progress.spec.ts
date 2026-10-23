import { expect, test, type Page } from '@playwright/test';
import {
  beginLevel1,
  candidates,
  centerOf,
  circleFrom,
  drag,
  earnedStars,
  expectCount,
  inputOf,
  pointCenter,
  selectTool,
  solveLevel1,
  tap,
  type Input,
  type Pt,
} from './helpers';

const solved = (page: Page) => page.getByRole('heading', { name: 'Solved' });
const d = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Levels 2 and 3 start alike: two circles, then the line through their crossings. */
async function bisectAB(page: Page, input: Input): Promise<void> {
  await circleFrom(page, 'A', 'B', input);
  await circleFrom(page, 'B', 'A', input);
  await expectCount(page, 'candidate', 2);
  const cs = await candidates(page);
  await selectTool(page, 2);
  // Starting and ending on candidate dots creates both crossing points implicitly.
  await drag(page, cs[0]!, cs[cs.length - 1]!, input);
}

async function solveLevel2(page: Page, input: Input): Promise<void> {
  await bisectAB(page, input);
}

async function solveLevel3(page: Page, input: Input): Promise<void> {
  await bisectAB(page, input);
  const a = await pointCenter(page, 'A');
  const b = await pointCenter(page, 'B');
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const [m] = (await candidates(page)).sort((p, q) => d(p, mid) - d(q, mid));
  await tap(page, m!, input);
}

const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();

test('levels 1–3 solved, unlock persists across reload, level 4 with the new tool', async ({
  page,
}, info) => {
  const input = inputOf(info.project.name);
  await beginLevel1(page);
  await solveLevel1(page, input);
  await expect(solved(page)).toBeVisible();
  await next(page);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Perpendicular Bisector');
  await solveLevel2(page, input);
  await expect(solved(page)).toBeVisible();
  await next(page);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Midpoint');
  await solveLevel3(page, input);
  await expect(solved(page)).toBeVisible();
  await expect(page.locator('.completion-unlock')).toHaveText('New tool: Perpendicular Bisector');
  await page.locator('.completion').getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.map-summary')).toContainText('3 of 6 solved');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('apollonius:v1')!));
  expect(saved.unlockedTools).toContain('perp-bisector');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Perpendicular at a Point');
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.map-summary')).toContainText('3 of 6 solved');
  await page.getByRole('button', { name: /^Level 4:/ }).click();

  const perp = page.getByRole('button', { name: 'Perpendicular bisector', exact: true });
  await expect(perp).toBeVisible();

  // Level 4 in two moves: circle P→A marks A′ on ℓ, then the bisector of A and A′.
  await circleFrom(page, 'P', 'A', input);
  const a = await pointCenter(page, 'A');
  const [far] = (await candidates(page)).sort((p, q) => d(q, a) - d(p, a));
  await tap(page, far!, input);
  const aPrime = page.locator('[data-kind="point"][data-label="C"]');
  await expect(aPrime).toBeVisible();
  await selectTool(page, 4);
  await drag(page, a, await centerOf(aPrime), input);
  await expect(solved(page)).toBeVisible();
  await expect(page.locator('.topbar .counter')).toHaveText('L 2/2 · E 4/4');
  expect(await earnedStars(page)).toEqual([true, true, true]);
});

test('resizing to a phone mid-level keeps the givens in view and moves the palette down', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'starts at desktop size');
  await beginLevel1(page);
  await circleFrom(page, 'A', 'B', 'mouse');
  const palette = page.getByRole('navigation', { name: 'Tools' });
  const wide = (await palette.boundingBox())!;
  expect(wide.x).toBeLessThan(10);
  expect(wide.height).toBeGreaterThan(wide.width);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = (await palette.boundingBox())!;
      return box.width > box.height && Math.abs(box.y + box.height - 844) <= 1;
    })
    .toBe(true);
  for (const label of ['A', 'B']) {
    await expect
      .poll(async () => {
        const c = await pointCenter(page, label);
        return c.x >= 0 && c.x <= 390 && c.y >= 0 && c.y <= 844;
      })
      .toBe(true);
  }
  // Givens also stay clear of the bars, inside the canvas.
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  for (const label of ['A', 'B']) {
    const c = await pointCenter(page, label);
    expect(c.x).toBeGreaterThan(canvas.x);
    expect(c.x).toBeLessThan(canvas.x + canvas.width);
    expect(c.y).toBeGreaterThan(canvas.y);
    expect(c.y).toBeLessThan(canvas.y + canvas.height);
  }
});

test('the game stays playable when localStorage throws', async ({ page }, info) => {
  await page.addInitScript(() => {
    const deny = () => {
      throw new Error('denied');
    };
    Storage.prototype.getItem = deny;
    Storage.prototype.setItem = deny;
  });
  await beginLevel1(page);
  await solveLevel1(page, inputOf(info.project.name));
  await expect(solved(page)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Perpendicular Bisector');
});
