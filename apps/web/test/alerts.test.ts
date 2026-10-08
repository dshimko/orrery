// SPDX-License-Identifier: Apache-2.0
import type { Alert } from '@orrery/core';
import { describe, expect, test } from 'vitest';
import {
  announcementFor,
  firstFocusTarget,
  newIncidents,
  refToPickTarget,
  sortAlerts,
} from '../src/lib/alerts.js';

function alert(
  id: string,
  severity: Alert['severity'],
  openedAt: string,
  targets: Alert['targets'] = [],
): Alert {
  return { id, severity, kind: 'k', title: `T ${id}`, text: '', openedAt, targets };
}

describe('sortAlerts', () => {
  test('orders by severity, then newest first, then id', () => {
    const sorted = sortAlerts([
      alert('b', 'info', '2026-01-01T10:00:00Z'),
      alert('a', 'warning', '2026-01-01T09:00:00Z'),
      alert('c', 'incident', '2026-01-01T08:00:00Z'),
      alert('d', 'warning', '2026-01-01T11:00:00Z'),
      alert('e', 'warning', '2026-01-01T11:00:00Z'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['c', 'd', 'e', 'a', 'b']);
  });

  test('does not mutate its input', () => {
    const input = [
      alert('a', 'info', '2026-01-01T10:00:00Z'),
      alert('b', 'incident', '2026-01-01T10:00:00Z'),
    ];
    sortAlerts(input);
    expect(input.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('focus targets', () => {
  test('maps refs to pick targets', () => {
    expect(refToPickTarget('spoke:sales')).toEqual({ kind: 'spoke', id: 'sales' });
    expect(refToPickTarget('hub')).toEqual({ kind: 'hub' });
    expect(refToPickTarget('shipyard')).toEqual({ kind: 'shipyard' });
    expect(refToPickTarget('metastore:m1')).toBeNull();
    expect(refToPickTarget('spoke')).toBeNull();
    expect(refToPickTarget('bogus:x')).toBeNull();
  });

  test('picks the first focusable target of an alert', () => {
    const target = firstFocusTarget(
      alert('a', 'info', '2026-01-01T10:00:00Z', ['metastore:m', 'useCase:bi']),
    );
    expect(target).toEqual({ kind: 'useCase', id: 'bi' });
    expect(firstFocusTarget(alert('b', 'info', '2026-01-01T10:00:00Z'))).toBeNull();
  });
});

describe('incident announcements', () => {
  test('finds unseen incidents only', () => {
    const alerts = [
      alert('a', 'incident', '2026-01-01T10:00:00Z'),
      alert('b', 'incident', '2026-01-01T10:00:00Z'),
      alert('c', 'warning', '2026-01-01T10:00:00Z'),
    ];
    expect(newIncidents(new Set(['a']), alerts).map((item) => item.id)).toEqual(['b']);
  });

  test('words the announcement', () => {
    const one = alert('a', 'incident', '2026-01-01T10:00:00Z');
    expect(announcementFor([])).toBe('');
    expect(announcementFor([one])).toBe('New incident: T a.');
    expect(announcementFor([one, one, one])).toBe('New incident: T a and 2 more.');
  });
});
