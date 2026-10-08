// SPDX-License-Identifier: Apache-2.0
import type { Alert, Snapshot, Topology } from '@orrery/core';
import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/lib/api.js';
import {
  aggregateAlerts,
  alertHref,
  buildFace,
  buildGlanceRow,
  type EnvFeedState,
  friendlyEnvError,
  healthError,
  isFirstLoadDone,
  nextEvent,
  orderEnvironments,
  promotionOrderOf,
  withHealth,
} from '../src/lib/home.js';
import { seedFor } from '../src/lib/seed.js';

const NOW = new Date('2026-03-04T10:00:00Z');
const topology = { envId: 'x' } as unknown as Topology;

function alert(
  id: string,
  severity: Alert['severity'],
  openedAt: string,
  targets: Alert['targets'] = [],
): Alert {
  return { id, severity, kind: 'k', title: `Title ${id}`, text: '', openedAt, targets };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    envId: 'x',
    at: NOW.toISOString(),
    spokes: [{}, {}, {}, {}],
    backlog: 0.42,
    alerts: [],
    schedule: [],
    counts: { openIncidents: 2, spokesPastTarget: 1 },
    ...overrides,
  } as unknown as Snapshot;
}

const feed = (snap: Snapshot | null, error: string | null = null): EnvFeedState => ({
  topology: snap ? topology : null,
  snapshot: snap,
  error,
});

const DEV = { id: 'dev', name: 'Development', tier: 'dev' };
const STG = { id: 'stg', name: 'Staging', tier: 'stg' };
const PROD = { id: 'prod', name: 'Production', tier: 'prod' };

describe('orderEnvironments', () => {
  const listed = [PROD, DEV, STG];

  test('follows the promotion order', () => {
    expect(orderEnvironments(listed, ['dev', 'stg', 'prod']).map((env) => env.id)).toEqual([
      'dev',
      'stg',
      'prod',
    ]);
  });

  test('appends environments the promotion list omits and ignores unknown ids', () => {
    expect(orderEnvironments(listed, ['stg', 'ghost']).map((env) => env.id)).toEqual([
      'stg',
      'prod',
      'dev',
    ]);
  });

  test('keeps config order without a promotion list', () => {
    expect(orderEnvironments(listed, null).map((env) => env.id)).toEqual(['prod', 'dev', 'stg']);
  });

  test('reads promotion.order defensively', () => {
    expect(promotionOrderOf({ order: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(promotionOrderOf(null)).toBeNull();
    expect(promotionOrderOf({ order: [1] })).toBeNull();
    expect(promotionOrderOf('x')).toBeNull();
  });
});

describe('nextEvent', () => {
  const windows = [
    {
      id: 'c',
      title: 'Late',
      kind: 'release',
      severity: 'info',
      start: '2026-03-04T15:00:00Z',
      end: '',
    },
    {
      id: 'b',
      title: 'Soon B',
      kind: 'transfer',
      severity: 'info',
      start: '2026-03-04T11:00:00Z',
      end: '',
    },
    {
      id: 'a',
      title: 'Soon A',
      kind: 'transfer',
      severity: 'info',
      start: '2026-03-04T11:00:00Z',
      end: '',
    },
    {
      id: 'p',
      title: 'Past',
      kind: 'release',
      severity: 'info',
      start: '2026-03-04T08:00:00Z',
      end: '',
    },
  ];

  test('picks the earliest window after now, breaking ties by id', () => {
    const snap = snapshot({ schedule: windows as unknown as Snapshot['schedule'] });
    expect(nextEvent(snap, NOW)).toEqual({ title: 'Soon A', at: '2026-03-04T11:00:00Z' });
  });

  test('skips windows that already started', () => {
    const snap = snapshot({ schedule: windows as unknown as Snapshot['schedule'] });
    expect(nextEvent(snap, new Date('2026-03-04T11:00:00Z'))?.title).toBe('Late');
  });

  test('returns null when nothing is left today', () => {
    expect(nextEvent(snapshot(), NOW)).toBeNull();
    const snap = snapshot({ schedule: windows as unknown as Snapshot['schedule'] });
    expect(nextEvent(snap, new Date('2026-03-04T23:00:00Z'))).toBeNull();
  });
});

describe('buildGlanceRow', () => {
  test('summarizes a healthy environment', () => {
    const row = buildGlanceRow(STG, feed(snapshot()), NOW);
    expect(row).toMatchObject({
      isLoading: false,
      error: null,
      openIncidents: 2,
      spokesPastTarget: 1,
      spokeCount: 4,
      backlog: 0.42,
      next: null,
    });
  });

  test('a failing environment keeps its error and no numbers', () => {
    const row = buildGlanceRow(PROD, feed(null, 'This environment is unavailable right now.'), NOW);
    expect(row.error).toBe('This environment is unavailable right now.');
    expect(row.isLoading).toBe(false);
    expect(row.openIncidents).toBeNull();
    expect(row.spokeCount).toBeNull();
  });

  test('a refresh failure after data still shows the error', () => {
    expect(buildGlanceRow(PROD, feed(snapshot(), 'down'), NOW).error).toBe('down');
  });

  test('an environment without data or error is loading', () => {
    expect(buildGlanceRow(DEV, feed(null), NOW)).toMatchObject({ isLoading: true, error: null });
  });
});

describe('aggregateAlerts', () => {
  const feeds = {
    dev: feed(snapshot({ alerts: [alert('d1', 'warning', '2026-03-04T09:00:00Z')] })),
    stg: feed(
      snapshot({
        alerts: [
          alert('s1', 'incident', '2026-03-04T08:00:00Z', ['spoke:sales']),
          alert('s2', 'info', '2026-03-04T09:30:00Z'),
        ],
      }),
    ),
    prod: feed(null, 'down'),
  };

  test('sorts by severity, then newest first, across environments', () => {
    const items = aggregateAlerts([DEV, STG, PROD], feeds);
    expect(items.map((item) => item.key)).toEqual(['stg:s1', 'dev:d1', 'stg:s2']);
  });

  test('breaks full ties by promotion order and skips failing environments', () => {
    const tie = alert('same', 'warning', '2026-03-04T09:00:00Z');
    const items = aggregateAlerts([PROD, DEV], {
      dev: feed(snapshot({ alerts: [tie] })),
      prod: feed(snapshot({ alerts: [{ ...tie, id: 'same' }] })),
    });
    expect(items.map((item) => item.env.id)).toEqual(['prod', 'dev']);
    expect(aggregateAlerts([PROD], { prod: feed(null, 'x') })).toEqual([]);
  });

  test('links each alert to the system view at its time, focused on its first target', () => {
    const items = aggregateAlerts([DEV, STG], feeds);
    expect(items[0]?.href).toBe('/env/stg?focus=spoke%3Asales&t=08%3A00');
    expect(items[1]?.href).toBe('/env/dev?t=09%3A00');
  });

  test('adds the date when the alert opened on another day', () => {
    const old = alert('o', 'warning', '2026-03-03T22:15:00Z', ['hub']);
    expect(alertHref('prod', old, NOW)).toBe('/env/prod?date=2026-03-03&focus=hub&t=22%3A15');
  });
});

describe('errors, health, and faces', () => {
  test('maps API errors to friendly messages', () => {
    expect(friendlyEnvError(new ApiError('boom', 503, 'adapter_unavailable'))).toBe(
      'This environment is unavailable right now.',
    );
    expect(friendlyEnvError(new ApiError('x', 0, 'network_error'))).toBe(
      'Could not reach the server.',
    );
    expect(friendlyEnvError(new ApiError('Not here.', 404, 'not_found'))).toBe('Not here.');
    expect(friendlyEnvError(new Error('secret detail'))).toBe(
      'This environment could not be loaded.',
    );
  });

  test('reads a failing health status', () => {
    expect(healthError({ status: 'error', message: 'Token expired.' })).toBe('Token expired.');
    expect(healthError({ status: 'error' })).toBe('The data source reports an error.');
    expect(healthError({ status: 'ok' })).toBeNull();
    expect(healthError(undefined)).toBeNull();
  });

  test('health only marks an environment that has no data yet', () => {
    expect(withHealth(undefined, 'bad').error).toBe('bad');
    expect(withHealth(feed(snapshot()), 'bad').error).toBeNull();
    expect(withHealth(feed(null, 'own'), 'bad').error).toBe('own');
    expect(withHealth(undefined, undefined).error).toBeNull();
  });

  test('builds a face with the shared seed and tier color, and sets error only on failure', () => {
    const ok = buildFace(STG, feed(snapshot()), { stg: '#ffb020' });
    expect(ok.seed).toBe(seedFor('stg'));
    expect(ok.tierColor).toBe('#ffb020');
    expect('error' in ok).toBe(false);
    const failing = buildFace(PROD, feed(null, 'down'), {});
    expect(failing.error).toBe('down');
    expect(failing.tierColor).toMatch(/^#/);
  });

  test('knows when the first load is over', () => {
    expect(isFirstLoadDone([DEV, PROD], { dev: feed(snapshot()) })).toBe(false);
    expect(isFirstLoadDone([DEV, PROD], { dev: feed(snapshot()), prod: feed(null, 'x') })).toBe(
      true,
    );
    expect(isFirstLoadDone([], {})).toBe(true);
  });
});

describe('seedFor', () => {
  test('is a stable FNV-1a hash', () => {
    expect(seedFor('')).toBe(0x811c9dc5);
    expect(seedFor('prod')).toBe(seedFor('prod'));
    expect(seedFor('prod')).not.toBe(seedFor('stg'));
  });
});
