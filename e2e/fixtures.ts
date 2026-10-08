// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';

/** A fixed, paused moment: same seed and time give the same scene (stability rule 5). */
export const FIXED = 'date=2026-10-07&t=10:45&paused=1';

export async function openSystem(page: Page, envId: string, query = FIXED): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/env/${envId}?${query}`);
  await page.getByTestId('scene').locator('canvas').waitFor();
  // Let the first snapshot, events, and the camera tween settle.
  await page.waitForTimeout(2500);
  return errors;
}
