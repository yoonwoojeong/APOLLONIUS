import { expect, test } from '@playwright/test';
import {
  beginLevel1,
  candidates,
  circleFrom,
  drag,
  expectCount,
  inputOf,
  pointCenter,
  selectTool,
  tap,
} from './helpers';

// Key screens in both themes, for visual review (§6, §5.5). Written to test-results/screens/.
for (const theme of ['light', 'dark'] as const) {
  test(`key screens in ${theme} theme`, async ({ page }, info) => {
    const input = inputOf(info.project.name);
    // Final frames only: animations settle at once.
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `test-results/screens/${info.project.name}-${theme}-${name}.png`,
      });
    };

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Begin' })).toBeVisible();
    await shot('1-title');

    await beginLevel1(page);
    await circleFrom(page, 'A', 'B', input);
    await circleFrom(page, 'B', 'A', input);
    await expectCount(page, 'circle', 2);
    await shot('2-level1-mid');

    await page.getByRole('button', { name: 'Hint' }).click();
    const more = page.getByRole('button', { name: 'More help' });
    await more.click();
    await more.click();
    await expectCount(page, 'hint-ghost', 1);
    await shot('3-hint-tier3');
    await page.getByRole('button', { name: 'Close hint' }).click();

    const [top] = await candidates(page);
    await tap(page, top!, input);
    await selectTool(page, 2);
    await drag(page, await pointCenter(page, 'C'), await pointCenter(page, 'A'), input);
    await drag(page, await pointCenter(page, 'C'), await pointCenter(page, 'B'), input);
    await expect(page.getByRole('heading', { name: 'Solved' })).toBeVisible();
    await shot('4-completion');

    await page.locator('.completion').getByRole('button', { name: 'Map' }).click();
    await expect(page.locator('.map-summary')).toBeVisible();
    await shot('5-map');
  });
}
