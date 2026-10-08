// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test, vi } from 'vitest';
import { ORLOJ_FONT_FACES, whenFontsReady } from '../src/lib/fonts.js';

describe('whenFontsReady', () => {
  test('resolves at once when there is no font set', async () => {
    await expect(whenFontsReady(undefined)).resolves.toBeUndefined();
  });

  test('loads every face the canvas draws with, then waits for ready', async () => {
    const load = vi.fn().mockResolvedValue([]);
    await whenFontsReady({ load, ready: Promise.resolve() });
    expect(load.mock.calls.map((call) => call[0])).toEqual(ORLOJ_FONT_FACES);
  });

  test('still resolves when a font fails to load', async () => {
    const load = vi.fn().mockRejectedValue(new Error('network'));
    await expect(whenFontsReady({ load, ready: Promise.resolve() })).resolves.toBeUndefined();
  });

  test('gives up waiting after the timeout', async () => {
    const never = new Promise<never>(() => undefined);
    await expect(whenFontsReady({ load: () => never, ready: never }, 10)).resolves.toBeUndefined();
  });
});
