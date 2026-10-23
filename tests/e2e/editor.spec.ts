import { expect, test, type Page } from '@playwright/test';
import {
  candidates,
  circleFrom,
  drag,
  expectCount,
  inputOf,
  pointCenter,
  selectTool,
  tap,
  type Input,
  type Pt,
} from './helpers';

const TITLE = 'Equilateral on AB';
const GOAL = 'Construct an equilateral triangle on AB.';
const AUTHOR = 'Tess';

const setupCanvas = (page: Page) => page.getByTestId('setup-canvas');
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const solved = (page: Page) => page.getByRole('heading', { name: 'Solved' });

/** A point at fractions (`fx`, `fy`) of the Setup canvas, in page coordinates. */
async function at(page: Page, fx: number, fy: number): Promise<Pt> {
  const box = (await setupCanvas(page).boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** From a fresh visit: title → Create → My problems → New problem, landing in Setup. */
async function newProblem(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'My problems' })).toBeVisible();
  await page.getByRole('button', { name: 'New problem' }).first().click();
  await expect(tab(page, 'Setup')).toHaveAttribute('aria-selected', 'true');
  await expect(setupCanvas(page)).toBeVisible();
}

/** Setup: places A and B (and D far to the right when `far`), then the segment AB. */
async function setupAB(page: Page, input: Input, far = false): Promise<void> {
  await tap(page, await at(page, 0.3, 0.6), input);
  await expectCount(page, 'point', 1);
  await tap(page, await at(page, 0.55, 0.6), input);
  await expectCount(page, 'point', 2);
  if (far) {
    await tap(page, await at(page, 0.85, 0.35), input);
    await expectCount(page, 'point', 3);
  }
  await page.getByRole('button', { name: 'Segment', exact: true }).click();
  await drag(page, await pointCenter(page, 'A'), await pointCenter(page, 'B'), input);
  await expectCount(page, 'line', 1);
}

/** The equilateral construction: circles A→B and B→A, the upper crossing C, lines CA and CB. */
async function equilateral(page: Page, input: Input): Promise<void> {
  await selectTool(page, 3);
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

/** Solve: the construction, then ☆ on both lines (steps 4 and 5). */
async function solveAndMark(page: Page, input: Input): Promise<void> {
  await tab(page, 'Solve').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await equilateral(page, input);
  await expect(page.locator('.step-row')).toHaveCount(5);
  for (const n of [4, 5]) {
    const star = page.getByRole('button', { name: new RegExp(`^Step ${n} target:`) });
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('.steps-meta')).toHaveText('5 steps · 2 targets');
}

async function fillDetails(page: Page): Promise<void> {
  await tab(page, 'Details').click();
  await page.getByLabel('Title', { exact: true }).fill(TITLE);
  await page.getByLabel('Goal sentence', { exact: true }).fill(GOAL);
  await page.getByLabel('Author', { exact: true }).fill(AUTHOR);
  await expect(page.locator('.checks .check-row.is-ok')).toHaveText('Ready to test');
}

/** Saved built-in progress: level 1 with one star. Playing problems must never change it. */
const SEEDED = JSON.stringify({
  version: 1,
  levels: { equilateral: { stars: [true, false, false], hintsUsed: 2 } },
  unlockedTools: [],
});

test('author, test-play, export, import and play a problem; progress untouched', async ({
  page,
}, info) => {
  const input = inputOf(info.project.name);
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('apollonius:v1', s);
      sessionStorage.setItem('seeded', '1');
    }
  }, SEEDED);
  await page.goto('/');
  await newProblem(page);
  await setupAB(page, input);
  await expect(tab(page, 'Setup')).toHaveAccessibleName('Setup, done');
  await solveAndMark(page, input);
  await fillDetails(page);

  // Test: play it as a player, complete it, come back marked Tested.
  await tab(page, 'Test').click();
  await page.getByRole('button', { name: 'Play test' }).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('.topbar')).toContainText(TITLE);
  await equilateral(page, input);
  await expect(solved(page)).toBeVisible();
  await expect(page.locator('.completion .star[data-earned="true"]')).toHaveCount(3);
  await page.locator('.completion').getByRole('button', { name: 'Back' }).click();
  await expect(tab(page, 'Test')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tested-badge')).toHaveText('Tested ✓');

  // My problems shows it Tested; export it.
  await page.getByRole('button', { name: 'Back to My problems' }).click();
  const card = page.locator('.pb-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.pb-status')).toHaveText('Tested ✓');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: `Export “${TITLE}”` }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('equilateral-on-ab.apollonius.json');
  const path = info.outputPath(file.suggestedFilename());
  await file.saveAs(path);

  // Import that file: a second card appears, and Play completes it.
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('.pb-toast-region')).toContainText(`Imported “${TITLE}”.`);
  await expect(card).toHaveCount(2);
  await page
    .getByRole('button', { name: `Play “${TITLE}”` })
    .first()
    .click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await equilateral(page, input);
  await expect(solved(page)).toBeVisible();
  await page.locator('.completion').getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'My problems' })).toBeVisible();
  // Both copies carry three stars: the original from its test, the import from this play.
  await expect(page.locator('.pb-card .pb-stars[aria-label="3 of 3 stars"]')).toHaveCount(2);

  // Built-in progress is exactly as seeded; level 1 still shows its one star.
  expect(await page.evaluate(() => localStorage.getItem('apollonius:v1'))).toBe(SEEDED);
  await page.getByRole('button', { name: 'Back to levels' }).click();
  await expect(page.locator('.map-summary')).toHaveText('1 of 6 solved · 1 of 18 stars');
  await expect(page.getByRole('button', { name: /^Level 1: .*, 1 of 3 stars$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Level 1:/ }).click();
  await expect(page.locator('.topbar .counter')).toHaveText('L 0/4 · E 0/4');
  expect(await page.evaluate(() => localStorage.getItem('apollonius:v1'))).toBe(SEEDED);
});

test('a crossing too close to a point blocks Play test until it is moved', async ({
  page,
}, info) => {
  const input = inputOf(info.project.name);
  await page.goto('/');
  await newProblem(page);
  // D far to the right fixes the scale, so moving B next to A packs the crossing near A.
  await setupAB(page, input, true);
  await solveAndMark(page, input);
  await fillDetails(page);

  await tab(page, 'Setup').click();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  const a = await pointCenter(page, 'A');
  const b = await pointCenter(page, 'B');
  const near = { x: a.x + (b.x - a.x) * 0.2, y: a.y };
  await drag(page, b, near, input);

  await tab(page, 'Test').click();
  // C is as far from A as from B: either may be named as the nearest point.
  const error = page.locator('.check-row.is-error', { hasText: /too close to point [AB] / });
  await expect(error).toHaveCount(1);
  await expect(error).toContainText(/Step 3: .* move [AB] or pick another construction\./);
  const play = page.getByRole('button', { name: 'Play test' });
  await expect(play).toHaveAttribute('aria-disabled', 'true');
  await play.dispatchEvent('click');
  await expect(page.getByTestId('canvas')).toHaveCount(0);
  await expect(page.locator('.test-reason')).toHaveText(/Fix \d+ problems? below to play\./);

  // Moving B back clears it.
  await tab(page, 'Setup').click();
  await drag(page, await pointCenter(page, 'B'), b, input);
  await tab(page, 'Test').click();
  await expect(page.locator('.checks .check-row.is-ok')).toHaveText('Ready to test');
  await expect(play).toHaveAttribute('aria-disabled', 'false');
});

test('tapping the canvas while renaming a point keeps the typed label', async ({ page }, info) => {
  const input = inputOf(info.project.name);
  await page.goto('/');
  await newProblem(page);
  await tap(page, await at(page, 0.3, 0.6), input);
  const a = await pointCenter(page, 'A');
  await tap(page, a, input);
  await tap(page, a, input);
  const field = page.getByRole('textbox', { name: 'Point label' });
  await expect(field).toBeFocused();
  await field.fill('P');
  await tap(page, await at(page, 0.7, 0.4), input);
  await expect(field).toHaveCount(0);
  await expect(page.locator('[data-kind="point"][data-label="P"]')).toHaveCount(1);
  await expect(page.locator('[data-kind="point"][data-label="A"]')).toHaveCount(0);
});

// My problems, each editor mode and the custom completion card in both themes, for visual
// review (§6). Written to test-results/screens/.
for (const theme of ['light', 'dark'] as const) {
  test(`editor screens in ${theme} theme`, async ({ page }, info) => {
    const input = inputOf(info.project.name);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `test-results/screens/${info.project.name}-${theme}-editor-${name}.png`,
      });
    };

    await page.goto('/');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'No problems yet' })).toBeVisible();
    await shot('1-problems-empty');

    await page.getByRole('button', { name: 'New problem' }).first().click();
    await expect(setupCanvas(page)).toBeVisible();
    await shot('2-setup-empty');
    await setupAB(page, input);
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    await shot('3-setup');

    await solveAndMark(page, input);
    await shot('4-solve');

    await tab(page, 'Details').click();
    await expect(page.locator('.check-row.is-error').first()).toBeVisible();
    await shot('5-details-errors');
    await fillDetails(page);
    await page.getByLabel('Explanation', { exact: true }).fill('C is AB away from both A and B.');
    await shot('6-details');

    await tab(page, 'Test').click();
    await shot('7-test');
    await page.getByRole('button', { name: 'Play test' }).click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await shot('8-test-play');
    await equilateral(page, input);
    await expect(solved(page)).toBeVisible();
    await shot('9-completion');
    await page.locator('.completion').getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('.tested-badge')).toBeVisible();
    await shot('10-test-tested');

    await page.getByRole('button', { name: 'Back to My problems' }).click();
    await expect(page.locator('.pb-card')).toHaveCount(1);
    await shot('11-problems');
  });
}
