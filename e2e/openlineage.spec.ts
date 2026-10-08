// SPDX-License-Identifier: Apache-2.0
// Milestone 7 acceptance: the server renders the public OpenLineage sample events.
import { expect, test } from '@playwright/test';
import { OPENLINEAGE_PORT } from '../playwright.config.js';

const BASE = `http://127.0.0.1:${OPENLINEAGE_PORT}`;

test.describe('OpenLineage public samples', () => {
  test('render on the Orloj home and the system view', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1600, height: 900 });

    await page.goto(`${BASE}/?date=2026-10-07&t=10:45&paused=1`);
    await page.getByTestId('orloj').locator('canvas').waitFor();
    await expect(page.getByTestId('glance-table').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('glance-table')).not.toContainText(/unavailable/i);

    await page.goto(`${BASE}/env/sample?date=2026-10-07&t=10:45&paused=1`);
    await expect(page.getByTestId('scene').locator('canvas')).toBeVisible();
    const table = page.getByTestId('data-table');
    for (const spoke of ['Raw tables', 'Orders mart', 'Delivery insights']) {
      await expect(table.getByText(spoke, { exact: true }).first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('serves sample events through the API', async ({ request }) => {
    const since = '2026-10-07T10:00:00.000Z';
    const until = '2026-10-07T11:00:00.000Z';
    const response = await request.get(
      `${BASE}/api/env/sample/events?since=${since}&until=${until}`,
    );
    expect(response.ok()).toBe(true);
    const { data } = (await response.json()) as { data: { type: string }[] };
    expect(data.length).toBeGreaterThan(0);
    expect(new Set(data.map((e) => e.type))).toContain('source.batch');
  });
});
