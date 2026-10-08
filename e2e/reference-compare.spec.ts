// SPDX-License-Identifier: Apache-2.0
// Opt-in (ORRERY_REFERENCE_COMPARE=1): captures the reference prototype and the port at the same
// environment and time of day for side-by-side human review. Not a pixel gate: the reference
// places stars, belt, and vehicles with unseeded Math.random (see docs/decisions.md).
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { openSystem } from './fixtures.js';

test.skip(!process.env.ORRERY_REFERENCE_COMPARE, 'Set ORRERY_REFERENCE_COMPARE=1 to run.');

for (const envId of ['dev', 'stg', 'prod']) {
  test(`reference vs port: ${envId} at 10:40`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const reference = pathToFileURL(resolve('reference/system-view.html')).href;
    await page.goto(`${reference}#/env/${envId}`);
    await page.waitForTimeout(1500);
    await info.attach(`reference-${envId}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await openSystem(page, envId, 'date=2026-10-07&t=10:40&paused=1');
    await info.attach(`port-${envId}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('reference vs port: Orloj home at 10:40', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(pathToFileURL(resolve('reference/orloj-home.html')).href);
  await page.waitForTimeout(1500);
  await info.attach('reference-orloj', { body: await page.screenshot(), contentType: 'image/png' });
  await page.goto('/?date=2026-10-07&t=10:40&paused=1');
  await page.getByTestId('orloj').locator('canvas').waitFor();
  await page.waitForTimeout(2000);
  await info.attach('port-orloj', { body: await page.screenshot(), contentType: 'image/png' });
});
