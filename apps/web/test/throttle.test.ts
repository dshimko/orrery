// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createThrottle } from '../src/lib/throttle.js';

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('delivers at most once per interval with the latest value', () => {
    const delivered: number[] = [];
    const throttle = createThrottle<number>((value) => delivered.push(value), 250);
    throttle.push(1);
    vi.advanceTimersByTime(0);
    throttle.push(2);
    throttle.push(3);
    vi.advanceTimersByTime(249);
    expect(delivered).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(delivered).toEqual([1, 3]);
  });

  test('cancel drops pending values', () => {
    const delivered: number[] = [];
    const throttle = createThrottle<number>((value) => delivered.push(value), 250);
    throttle.push(1);
    throttle.cancel();
    vi.advanceTimersByTime(1000);
    expect(delivered).toEqual([]);
  });
});
