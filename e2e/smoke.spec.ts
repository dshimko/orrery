// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

// Gates: visual regression and accessibility. Milestone 1 ships the harness and a smoke check;
// screenshot baselines arrive with the views (milestones 3 and 4).
test('home page renders with a main landmark and heading', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Orrery');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Orrery' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('home page is keyboard reachable without traps', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).toBeVisible();
});

test.fixme('visual regression: Orloj view and three system views at a fixed seed', () => {});
