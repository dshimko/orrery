// SPDX-License-Identifier: Apache-2.0
// Opt-in (ORRERY_SCREENSHOTS=1): regenerates the README screenshots in docs/images at a fixed
// seed and time. Run with `ORRERY_SCREENSHOTS=1 pnpm exec playwright test e2e/readme-screenshots.spec.ts`.
import { test } from '@playwright/test';
import { OPENLINEAGE_PORT } from '../playwright.config.js';

test.skip(!process.env.ORRERY_SCREENSHOTS, 'Set ORRERY_SCREENSHOTS=1 to regenerate README images.');

const FIXED = 'date=2026-10-07&t=10:45&paused=1';
const VIEWPORT = { width: 1600, height: 900 };

test('Orloj home', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/?${FIXED}&howto=0`);
  await page
    .locator('[data-testid="orloj"][data-ready="true"] canvas')
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/images/orloj-home.png' });
});

test('system view (prod)', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`/env/prod?${FIXED}`);
  await page.getByTestId('scene').locator('canvas').waitFor();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'docs/images/system-view-prod.png' });
});

test('system view (OpenLineage sample)', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`http://127.0.0.1:${OPENLINEAGE_PORT}/env/sample?${FIXED}`);
  await page.getByTestId('scene').locator('canvas').waitFor();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'docs/images/system-view-openlineage.png' });
});
