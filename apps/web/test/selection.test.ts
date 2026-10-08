// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology } from '@orrery/core';
import { describe, expect, test } from 'vitest';
import { describePick } from '../src/lib/selection.js';

const topology = {
  envId: 'prod',
  hub: { id: 'hub', name: 'Core', metastore: 'm' },
  spokes: [
    {
      id: 'sales',
      name: 'Sales',
      role: 'domain',
      metastore: 'm',
      freshness: { cadenceMinutes: 30, targetMinutes: 60, offsetMinutes: 0 },
      metrics: { pipelines: 1, products: 1, complexity: 1, volume: 1 },
      hasMl: false,
      isShared: false,
    },
  ],
  sourceGroups: [{ id: 'eu', name: 'Europe', utcOffset: 1, sites: [{ id: 'par', name: 'Paris' }] }],
  useCases: [{ id: 'bi', name: 'BI', reads: ['sales'] }],
  metastores: [],
  foreignCatalogs: [{ id: 'erp', name: 'ERP' }],
} as unknown as Topology;

const snapshot = {
  hub: { activity: 0.5 },
  spokes: [{ id: 'sales', ageMinutes: 90, targetMinutes: 60, pastTarget: true, activity: 0.25 }],
  useCases: [{ id: 'bi', activity: 0.1, status: 'warning', note: 'Slow refresh.' }],
} as unknown as Snapshot;

describe('describePick', () => {
  test('describes a spoke with freshness', () => {
    const info = describePick({ kind: 'spoke', id: 'sales' }, topology, snapshot);
    expect(info?.title).toBe('Sales');
    expect(info?.lines.join(' ')).toContain('past target');
    expect(info?.lines.join(' ')).toContain('1 h 30 min');
  });

  test('describes hub, site, use case, foreign catalog, and shipyard', () => {
    expect(describePick({ kind: 'hub' }, topology, snapshot)?.title).toBe('Core');
    expect(describePick({ kind: 'site', id: 'par' }, topology, snapshot)?.lines[0]).toContain(
      'Europe',
    );
    expect(describePick({ kind: 'useCase', id: 'bi' }, topology, snapshot)?.lines[0]).toContain(
      'warning',
    );
    expect(describePick({ kind: 'foreign', id: 'erp' }, topology, snapshot)?.title).toBe('ERP');
    expect(describePick({ kind: 'shipyard' }, topology, snapshot)?.title).toBe('Shipyard');
  });

  test('returns null for unknown ids', () => {
    expect(describePick({ kind: 'spoke', id: 'nope' }, topology, snapshot)).toBeNull();
    expect(describePick({ kind: 'site', id: 'nope' }, topology, snapshot)).toBeNull();
    expect(describePick({ kind: 'useCase', id: 'nope' }, topology, snapshot)).toBeNull();
    expect(describePick({ kind: 'foreign', id: 'nope' }, topology, snapshot)).toBeNull();
  });
});
