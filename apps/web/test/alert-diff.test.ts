// SPDX-License-Identifier: Apache-2.0
import type { Alert } from '@orrery/core';
import { describe, expect, test } from 'vitest';
import {
  announcementForNew,
  countAttention,
  diffAlerts,
  type OpenAlert,
  type SeenAlerts,
} from '../src/lib/alerts.js';

function alert(id: string, severity: Alert['severity']): Alert {
  return {
    id,
    severity,
    kind: 'k',
    title: `T ${id}`,
    text: '',
    openedAt: '2026-01-01T10:00:00Z',
    targets: [],
  };
}
const open = (envId: string, id: string, severity: Alert['severity']): OpenAlert => ({
  envId,
  alert: alert(id, severity),
});
const EMPTY: SeenAlerts = new Map();

describe('diffAlerts', () => {
  test('reports nothing on first load, even for incidents', () => {
    const diff = diffAlerts(EMPTY, ['prod'], [open('prod', 'a', 'incident')]);
    expect(diff.fresh).toEqual([]);
    expect(diff.seen.get('prod')).toEqual(new Set(['a']));
  });

  test('reports new warnings and incidents but not info', () => {
    const first = diffAlerts(EMPTY, ['prod'], [open('prod', 'a', 'warning')]);
    const next = diffAlerts(
      first.seen,
      ['prod'],
      [
        open('prod', 'a', 'warning'),
        open('prod', 'b', 'incident'),
        open('prod', 'c', 'info'),
        open('prod', 'd', 'warning'),
      ],
    );
    expect(next.fresh.map((item) => item.alert.id)).toEqual(['b', 'd']);
    const again = diffAlerts(next.seen, ['prod'], [open('prod', 'b', 'incident')]);
    expect(again.fresh).toEqual([]);
  });

  test('tracks environments separately and baselines a late-loading one silently', () => {
    const first = diffAlerts(EMPTY, ['dev'], [open('dev', 'a', 'warning')]);
    const next = diffAlerts(
      first.seen,
      ['dev', 'prod'],
      [open('dev', 'a', 'warning'), open('prod', 'a', 'incident')],
    );
    expect(next.fresh).toEqual([]);
    const later = diffAlerts(
      next.seen,
      ['dev', 'prod'],
      [open('dev', 'a', 'warning'), open('prod', 'a', 'incident'), open('prod', 'z', 'warning')],
    );
    expect(later.fresh.map((item) => `${item.envId}:${item.alert.id}`)).toEqual(['prod:z']);
  });

  test('an environment with no alerts at load still reports its first new alert', () => {
    const first = diffAlerts(EMPTY, ['prod'], []);
    const next = diffAlerts(first.seen, ['prod'], [open('prod', 'a', 'warning')]);
    expect(next.fresh).toHaveLength(1);
  });
});

describe('alert counts and announcements', () => {
  test('counts warnings and incidents only', () => {
    expect(
      countAttention([alert('a', 'info'), alert('b', 'warning'), alert('c', 'incident')]),
    ).toBe(2);
  });

  test('announces the first and how many more', () => {
    expect(announcementForNew([])).toBe('');
    expect(
      announcementForNew([
        { envName: 'Prod', alert: alert('a', 'incident') },
        { envName: 'Dev', alert: alert('b', 'warning') },
      ]),
    ).toBe('New incident on Prod: T a and 1 more.');
  });
});
