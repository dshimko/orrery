// SPDX-License-Identifier: Apache-2.0
import type { ScheduledWindow } from '@orrery/core';
import { describe, expect, test } from 'vitest';
import { UPCOMING_HORIZON_MS, upcomingEvents } from '../src/lib/upcoming.js';

const NOW = new Date('2026-03-04T10:00:00Z');
const DEV = { id: 'dev', name: 'Dev', tier: 'bronze' };
const PROD = { id: 'prod', name: 'Prod', tier: 'gold' };

function win(id: string, start: string): ScheduledWindow {
  return { id, title: `W ${id}`, kind: 'release', severity: 'info', start, end: start };
}

describe('upcomingEvents', () => {
  test('keeps windows that start within the next 24 hours, across UTC dates', () => {
    const items = upcomingEvents(
      [
        {
          env: DEV,
          snapshot: {
            schedule: [
              win('past', '2026-03-04T09:59:00Z'),
              win('now', '2026-03-04T10:00:00Z'),
              win('soon', '2026-03-04T10:30:00Z'),
              win('tomorrow', '2026-03-05T09:59:00Z'),
              win('too-far', '2026-03-05T10:00:00Z'),
              win('bad', 'not a date'),
            ],
          },
        },
      ],
      NOW,
    );
    expect(items.map((item) => item.window.id)).toEqual(['soon', 'tomorrow']);
    expect(UPCOMING_HORIZON_MS).toBe(86_400_000);
  });

  test('sorts by start, then by environment order, and limits the result', () => {
    const entries = [
      {
        env: DEV,
        snapshot: {
          schedule: [win('a', '2026-03-04T12:00:00Z'), win('b', '2026-03-04T11:00:00Z')],
        },
      },
      { env: PROD, snapshot: { schedule: [win('c', '2026-03-04T12:00:00Z')] } },
    ];
    const all = upcomingEvents(entries, NOW);
    expect(all.map((item) => item.key)).toEqual(['dev:b', 'dev:a', 'prod:c']);
    expect(upcomingEvents(entries, NOW, { limit: 2 }).map((item) => item.key)).toEqual([
      'dev:b',
      'dev:a',
    ]);
  });

  test('skips environments without a snapshot', () => {
    expect(upcomingEvents([{ env: DEV, snapshot: null }], NOW)).toEqual([]);
  });
});
