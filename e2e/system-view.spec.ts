// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { openSystem } from './fixtures.js';

test.describe('system view', () => {
  test('renders prod with header, tier badge, alerts, and the data table', async ({ page }) => {
    const errors = await openSystem(page, 'prod');
    await expect(page.getByRole('img', { name: /system view: 7 spokes/i })).toBeVisible();
    await expect(page.getByText('Tier: PROD')).toBeVisible();
    await expect(page.getByTestId('alerts')).toContainText('Cross-domain quality alert');
    const table = page.getByTestId('data-table');
    for (const spoke of [
      'Regional ingest',
      'Supply',
      'Operations',
      'Quality',
      'Customer',
      'Sales',
      'Finance',
    ]) {
      await expect(table.getByText(spoke, { exact: true }).first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('stability rule 8: paused with no input, consecutive frames are identical', async ({
    page,
  }) => {
    await openSystem(page, 'prod');
    const scene = page.getByTestId('scene');
    const first = await scene.screenshot({ animations: 'disabled' });
    await page.waitForTimeout(1000);
    const second = await scene.screenshot({ animations: 'disabled' });
    expect(second.equals(first)).toBe(true);
  });

  test('switching environments navigates and keeps the page healthy', async ({ page }) => {
    const errors = await openSystem(page, 'prod');
    await page.getByTestId('env-switcher').selectOption('dev');
    await expect(page).toHaveURL(/\/env\/dev/);
    await expect(page.getByText('Tier: DEV')).toBeVisible();
    await expect(page.getByTestId('data-table')).not.toContainText('Finance');
    expect(errors).toEqual([]);
  });

  test('keyboard-only: controls are reachable and the scene takes camera keys', async ({
    page,
  }) => {
    await openSystem(page, 'prod');
    const reached = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? '',
      );
      if (id) reached.add(id);
    }
    expect([...reached]).toEqual(expect.arrayContaining(['env-switcher', 'play', 'scrubber']));
    const canvas = page.getByTestId('scene').locator('canvas');
    await canvas.focus();
    const before = await canvas.screenshot();
    await page.keyboard.press('3');
    await page.waitForTimeout(1500);
    expect((await canvas.screenshot()).equals(before)).toBe(false);
  });

  test('an unknown environment shows a friendly error with a way home', async ({ page }) => {
    await page.goto('/env/nope');
    await expect(page.getByRole('link', { name: /all environments|home/i }).first()).toBeVisible();
    await expect(page.locator('body')).toContainText(/does not exist|unavailable/i);
  });
});
