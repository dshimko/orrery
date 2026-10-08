// SPDX-License-Identifier: Apache-2.0
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAILING_PORT } from '../playwright.config.js';
import { FIXED, openSystem } from './fixtures.js';

async function openHome(page: Page, width = 1600, base = ''): Promise<void> {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${base}/?${FIXED}`);
  await page
    .locator('[data-testid="orloj"][data-ready="true"] canvas')
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
}

/** Columns from the canvas aspect ratio: 3 faces give 1, 2, or 3 rows of 440×820 faces. */
async function columns(page: Page): Promise<number> {
  const box = await page.getByTestId('orloj').locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const ratio = box.height / box.width;
  const byColumns = { 3: 820 / (3 * 440), 2: (2 * 820) / (2 * 440), 1: (3 * 820) / 440 };
  return Number(
    Object.entries(byColumns).sort(
      ([, a], [, b]) => Math.abs(a - ratio) - Math.abs(b - ratio),
    )[0]?.[0],
  );
}

test.describe('Orloj home', () => {
  test('renders a face per environment with the glance table and alerts', async ({ page }) => {
    await openHome(page);
    const table = page.getByTestId('glance-table');
    for (const name of ['Development', 'Staging', 'Production'])
      await expect(table).toContainText(name);
    await expect(page.getByTestId('home-alerts')).toContainText('Cross-domain quality alert');
  });

  test('switches layout at 1,150 and 720 px', async ({ page }) => {
    test.setTimeout(90_000);
    for (const [width, expected] of [
      [1600, 3],
      [1100, 2],
      [760, 2],
      [700, 1],
    ] as const) {
      await openHome(page, width);
      expect(await columns(page), `columns at ${width}px`).toBe(expected);
    }
  });

  test('a failing environment shows an error face while the others render', async ({ page }) => {
    await openHome(page, 1600, `http://127.0.0.1:${FAILING_PORT}`);
    const rows = page.getByTestId('glance-table').locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).not.toContainText(/unavailable/i);
    await expect(rows.nth(1)).toContainText(/unavailable/i);
    await expect(rows.nth(2)).toContainText(/unavailable/i);
    await expect(page.getByTestId('orloj').locator('canvas')).toHaveAttribute(
      'aria-label',
      /Development/,
    );
  });

  test('summary dialog opens from the table and links to the system view', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'Show summary for Staging' }).click();
    const summary = page.getByTestId('summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByRole('link', { name: /open system view/i })).toHaveAttribute(
      'href',
      /\/env\/stg/,
    );
    await page.keyboard.press('Escape');
    await expect(summary).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show summary for Staging' })).toBeFocused();
  });

  test('shows a tooltip for a part of the clock', async ({ page }) => {
    await openHome(page);
    const canvas = page.getByTestId('orloj').locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    const scale = box.width / (3 * 440);
    // The first face's moon-free dial hub at face units (220, 345).
    await page.mouse.move(box.x + 220 * scale, box.y + 345 * scale);
    await expect(page.getByTestId('tooltip')).toBeVisible();
  });

  test('has no serious or critical axe violations', async ({ page }) => {
    await openHome(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id),
    ).toEqual([]);
  });
});

test.describe('navigation', () => {
  test('deep link restores time and focus: /env/stg?t=11:00&focus=spoke:sales', async ({
    page,
  }) => {
    await openSystem(page, 'stg', 'date=2026-10-07&t=11:00&paused=1&focus=spoke:sales');
    await expect(page.getByText('11:00', { exact: true })).toBeVisible();
    await expect(page.locator('body')).toContainText(/Sales/);
    await expect(page).toHaveURL(/focus=spoke(%3A|:)sales/);
  });

  test('compare mode shows two system views on one clock', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/compare?envs=stg,prod&${FIXED}`);
    const root = page.getByTestId('compare');
    await expect(root.locator('canvas')).toHaveCount(2);
    await expect(root).toContainText('Staging');
    await expect(root).toContainText('Production');
  });

  test('wall display toggle enters wall mode', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('wall-toggle').click();
    await expect(page).toHaveURL(/wall=1/);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/wall=1/);
  });

  test('system view has no serious or critical axe violations', async ({ page }) => {
    await openSystem(page, 'prod');
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id),
    ).toEqual([]);
  });
});
