// SPDX-License-Identifier: Apache-2.0
// Gate: visual regression at a fixed seed and time. Baselines are Linux-only (rendered in the
// official Playwright container) because font rasterization differs per OS; refresh them with
// `pnpm test:visual:update`, which runs that container.
import { expect, test } from '@playwright/test';
import { openSystem } from './fixtures.js';

test.skip(process.platform !== 'linux', 'Visual baselines are rendered on Linux only.');

for (const envId of ['dev', 'stg', 'prod']) {
  test(`system view ${envId} matches its baseline`, async ({ page }) => {
    await openSystem(page, envId);
    await expect(page.getByTestId('scene')).toHaveScreenshot(`system-${envId}.png`, {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
}

test('Orloj home matches its baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?date=2026-10-07&t=10:45&paused=1');
  await page
    .locator('[data-testid="orloj"][data-ready="true"] canvas')
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('orloj')).toHaveScreenshot('orloj-home.png', {
    timeout: 20_000,
    maxDiffPixelRatio: 0.01,
    animations: 'disabled',
  });
});
