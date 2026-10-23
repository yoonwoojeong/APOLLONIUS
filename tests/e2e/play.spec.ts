import { expect, test } from '@playwright/test';
import {
  beginLevel1,
  circleFrom,
  counter,
  drag,
  earnedStars,
  expectCount,
  inputOf,
  pointCenter,
  solveLevel1,
  touch,
} from './helpers';

const LEVEL1_WHY = 'C lies on both circles, so CA = AB = CB.';

test('level 1 is solved by following the coach', async ({ page }, info) => {
  const input = inputOf(info.project.name);
  await beginLevel1(page);
  await expect(page.locator('.coach')).toContainText('Drag from A to B to draw a circle.');
  await solveLevel1(page, input);
  await expect(page.getByRole('heading', { name: 'Solved' })).toBeVisible();
  expect(await earnedStars(page)).toEqual([true, true, true]);
  await expect(page.locator('.completion-why')).toHaveText(LEVEL1_WHY);
  await expect(counter(page)).toHaveText('L 4/4 · E 4/4');
});

test('undo, redo and reset change the move counter', async ({ page }, info) => {
  const input = inputOf(info.project.name);
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  const reset = page.getByRole('button', { name: 'Reset' });
  await beginLevel1(page);
  await expect(counter(page)).toHaveText('L 0/4 · E 0/4');
  await circleFrom(page, 'A', 'B', input);
  await circleFrom(page, 'B', 'A', input);
  await expect(counter(page)).toHaveText('L 2/4 · E 2/4');

  await undo.click();
  await expect(counter(page)).toHaveText('L 1/4 · E 1/4');
  await expectCount(page, 'circle', 1);
  await redo.click();
  await expect(counter(page)).toHaveText('L 2/4 · E 2/4');
  await expectCount(page, 'circle', 2);

  await reset.click();
  await expect(counter(page)).toHaveText('L 0/4 · E 0/4');
  await expectCount(page, 'circle', 0);
  // Reset is itself one undoable step.
  await undo.click();
  await expect(counter(page)).toHaveText('L 2/4 · E 2/4');
  await expectCount(page, 'circle', 2);
});

test('rapid undo during the draw-on leaves no stale circle and drops the redo tail', async ({
  page,
}, info) => {
  const input = inputOf(info.project.name);
  const undo = page.getByRole('button', { name: 'Undo' });
  const circles = page.locator('[data-kind="circle"]');
  const retained = page.locator('.retained > *');
  await beginLevel1(page);
  // Slow every CSS animation tenfold: the 220 ms draw-on now lasts 2.2 s, so the undo below
  // lands inside it however slow the machine is.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });

  await circleFrom(page, 'A', 'B', input);
  // The circle is still drawing on (its stroke is partly hidden) when Undo is pressed.
  const stroke = circles.locator('.stroke.draw-in');
  await expect(stroke).toHaveCount(1);
  const offset = await stroke.evaluate((el) => parseFloat(getComputedStyle(el).strokeDashoffset));
  expect(offset).toBeGreaterThan(0.05);
  await undo.click();

  // Only the reverse draw-out copy may remain, and it must go away too.
  await expect(circles).toHaveCount(0);
  await expect(retained).toHaveCount(0);
  // Nothing comes back for the rest of the (slowed) draw-on plus a margin.
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    expect(await circles.count()).toBe(0);
    expect(await retained.count()).toBe(0);
  }
  await expect(counter(page)).toHaveText('L 0/4 · E 0/4');

  // A new command after undo drops the redo tail.
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  await circleFrom(page, 'B', 'A', input);
  await expect(circles).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
});

test('each hint tier: nudge, glowing inputs, then one ghost', async ({ page }) => {
  await beginLevel1(page);
  await page.getByRole('button', { name: 'Hint' }).click();
  const panel = page.getByRole('dialog', { name: 'Hint' });
  await expect(panel.locator('.hint-nudge')).toHaveText('Which points are exactly AB away from A?');
  await expect(page.locator('.is-hint')).toHaveCount(0);
  await expectCount(page, 'hint-ghost', 0);

  await panel.getByRole('button', { name: 'More help' }).click();
  await expect(page.locator('[data-kind="point"][data-label="A"]')).toHaveClass(/\bis-hint\b/);
  await expect(page.locator('[data-kind="point"][data-label="B"]')).toHaveClass(/\bis-hint\b/);
  await expectCount(page, 'hint-ghost', 0);

  await panel.getByRole('button', { name: 'More help' }).click();
  await expectCount(page, 'hint-ghost', 1);
  await expect(panel.getByRole('button', { name: 'More help' })).toHaveCount(0);
});

test('releasing a line drag over empty space commits nothing and clears the ghost', async ({
  page,
}, info) => {
  const input = inputOf(info.project.name);
  await beginLevel1(page);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const a = await pointCenter(page, 'A');
  const b = await pointCenter(page, 'B');
  await drag(page, a, { x: (a.x + b.x) / 2, y: a.y - 120 }, input);
  // Only the given segment AB remains.
  await expect(page.locator('[data-kind="line"]:not(.is-given)')).toHaveCount(0);
  await expectCount(page, 'ghost', 0);
  await expect(counter(page)).toHaveText('L 0/4 · E 0/4');
});

test('a second finger during a circle drag commits nothing', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'needs touch input');
  await beginLevel1(page);
  const a = await pointCenter(page, 'A');
  const b = await pointCenter(page, 'B');
  await touch(page, 'touchStart', [{ ...a, id: 1 }]);
  for (let i = 1; i <= 6; i++) {
    await touch(page, 'touchMove', [{ x: a.x + ((b.x - a.x) * i) / 6, y: a.y, id: 1 }]);
  }
  await expectCount(page, 'ghost', 1);
  // A second finger lands: the construction gesture hands over to pinch.
  const f2 = { x: b.x, y: b.y + 140, id: 2 };
  await touch(page, 'touchStart', [{ ...b, id: 1 }, f2]);
  await touch(page, 'touchMove', [
    { x: b.x + 10, y: b.y - 10, id: 1 },
    { x: f2.x, y: f2.y + 30, id: 2 },
  ]);
  await expectCount(page, 'ghost', 0);
  await touch(page, 'touchEnd', [{ x: f2.x, y: f2.y + 30, id: 2 }]);
  await touch(page, 'touchEnd', []);
  await expectCount(page, 'circle', 0);
  await expectCount(page, 'ghost', 0);
  await expect(counter(page)).toHaveText('L 0/4 · E 0/4');
});

test('level 1 completes with reduced motion', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await beginLevel1(page);
  await solveLevel1(page, inputOf(info.project.name));
  await expect(page.getByRole('heading', { name: 'Solved' })).toBeVisible();
  expect(await earnedStars(page)).toEqual([true, true, true]);
  await expect(page.locator('.completion-why')).toHaveText(LEVEL1_WHY);
});
