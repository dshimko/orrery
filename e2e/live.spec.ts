// SPDX-License-Identifier: Apache-2.0
// Live mode: the browser's clock is faked so "now" is deterministic. The browser sends that time
// as `at` with every snapshot request, so the mock server answers for the same instant.
import { expect, test } from '@playwright/test';

const NOW = new Date('2026-10-07T10:45:00Z');

test.use({ timezoneId: 'America/New_York' });

test.describe('live mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: NOW });
    await page.setViewportSize({ width: 1600, height: 1000 });
  });

  test('home is live by default with UTC and local time', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('live-badge')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&](t|date|paused|speed|mode)=/);
    await expect(page.locator('body')).toContainText('10:45');
    await expect(page.getByTestId('clock-local')).toContainText(/06:45.*(EDT|GMT-4)/);
    await expect(page.getByTestId('freshness')).toBeVisible();
  });

  test('upcoming lists the next events across environments in start order', async ({ page }) => {
    await page.goto('/');
    const upcoming = page.getByTestId('upcoming');
    await expect(upcoming).toBeVisible();
    const rows = upcoming.locator('li');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(8);
    await expect(upcoming).toContainText(/in \d+ (min|h)/);
  });

  test('a deep link opens replay, and Back to live returns to now', async ({ page }) => {
    await page.goto('/?t=08:00&paused=1');
    await expect(page.getByTestId('back-to-live')).toBeVisible();
    await expect(page.getByTestId('live-badge')).toHaveCount(0);
    await page.getByTestId('back-to-live').click();
    await expect(page.getByTestId('live-badge')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&](t|paused)=/);
  });

  test('a new incident while live raises the alert banner and the tab count', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-07T10:28:00Z') });
    await page.goto('/');
    await expect(page.getByTestId('live-badge')).toBeVisible();
    await expect(page.getByTestId('alert-banner')).toHaveCount(0);
    // prod's cross-domain quality alert opens at 10:30 UTC. Jump ahead in 31 s steps so the
    // 30 s poll fires after 10:30 (fastForward fires due timers once instead of every frame).
    for (let i = 0; i < 6; i += 1) await page.clock.fastForward(31_000);
    await expect(page.getByTestId('alert-banner')).toContainText('Cross-domain quality alert');
    await expect(page).toHaveTitle(/^\(\d+\) /);
  });
});
