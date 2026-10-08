// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import { createFreshnessTracker } from '../src/lib/freshness.js';

describe('freshness tracker', () => {
  test('reports the newest success across sources', () => {
    const tracker = createFreshnessTracker();
    expect(tracker.summary()).toEqual({ lastOkMs: null, isStale: false });
    tracker.ok('dev', 1000);
    tracker.ok('prod', 5000);
    expect(tracker.summary()).toEqual({ lastOkMs: 5000, isStale: false });
  });

  test('is stale after two consecutive failures, not one', () => {
    const tracker = createFreshnessTracker();
    tracker.ok('dev', 1000);
    tracker.fail('dev');
    expect(tracker.summary().isStale).toBe(false);
    tracker.fail('dev');
    expect(tracker.summary()).toEqual({ lastOkMs: 1000, isStale: true });
  });

  test('a success clears staleness, and failures in one source are not reset by another', () => {
    const tracker = createFreshnessTracker();
    tracker.fail('dev');
    tracker.fail('dev');
    tracker.ok('prod', 2000);
    expect(tracker.summary().isStale).toBe(true);
    tracker.ok('dev', 3000);
    expect(tracker.summary()).toEqual({ lastOkMs: 3000, isStale: false });
  });
});
