// SPDX-License-Identifier: Apache-2.0
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FIXED } from './fixtures.js';

const DISMISSED_KEY = 'orrery.orloj.howToRead.dismissed';

async function openHome(page: Page, query = FIXED): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/?${query}`);
  await page
    .locator('[data-testid="orloj"][data-ready="true"] canvas')
    .waitFor({ timeout: 20_000 });
}

async function seriousViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('Orloj guidance', () => {
  test('shows the annotation on a first visit', async ({ page }) => {
    await openHome(page);
    await expect(page.getByTestId('how-to-read')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('howto-hint')).toBeVisible();
  });

  test('toggling off is remembered across a reload', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('how-to-read').click();
    await expect(page.getByTestId('how-to-read')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate((key) => localStorage.getItem(key), DISMISSED_KEY)).toBe('1');
    await page.reload();
    await page
      .locator('[data-testid="orloj"][data-ready="true"] canvas')
      .waitFor({ timeout: 20_000 });
    await expect(page.getByTestId('how-to-read')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('howto-hint')).toHaveCount(0);
  });

  test('? toggles the annotation and Escape closes it', async ({ page }) => {
    await openHome(page);
    const toggle = page.getByTestId('how-to-read');
    await page.keyboard.press('?');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('?');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('? is ignored while typing in a form control', async ({ page }) => {
    await openHome(page);
    const toggle = page.getByTestId('how-to-read');
    await page.getByTestId('scrubber').focus();
    await page.keyboard.press('?');
    // A range input is a form control: the key must not toggle.
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('Tab reaches the toggle and Enter operates it', async ({ page }) => {
    await openHome(page, `${FIXED}&howto=0`);
    const toggle = page.getByTestId('how-to-read');
    await expect(toggle).toHaveAttribute('aria-keyshortcuts', '?');
    await page.getByTestId('scrubber').focus();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('howto=1 forces it on after a dismissal and howto=0 forces it off', async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, '1');
    }, DISMISSED_KEY);
    await openHome(page, `${FIXED}&howto=1`);
    await expect(page.getByTestId('how-to-read')).toHaveAttribute('aria-pressed', 'true');
    await openHome(page, `${FIXED}&howto=0`);
    await expect(page.getByTestId('how-to-read')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the legend is closed by default and lists the parts when opened', async ({ page }) => {
    await openHome(page, `${FIXED}&howto=0`);
    const legend = page.getByTestId('orloj-legend');
    await expect(legend).not.toHaveAttribute('open', '');
    await legend.locator('summary').click();
    await expect(legend).toHaveAttribute('open', '');
    expect(await legend.locator('li').count()).toBeGreaterThan(3);
    await expect(legend.locator('li').first()).not.toBeEmpty();
  });

  test('axe finds no serious violations with the legend open and annotation on', async ({
    page,
  }) => {
    await openHome(page, `${FIXED}&howto=1`);
    await page.getByTestId('orloj-legend').locator('summary').click();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('wall mode shows the key strip and no legend, toggle, or annotation', async ({ page }) => {
    await openHome(page, `${FIXED}&wall=1&howto=1`);
    await expect(page.getByTestId('wall-key')).toBeVisible();
    await expect(page.getByTestId('orloj-legend')).toHaveCount(0);
    await expect(page.getByTestId('how-to-read')).toHaveCount(0);
    await expect(page.getByTestId('howto-hint')).toHaveCount(0);
  });
});
