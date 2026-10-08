// SPDX-License-Identifier: Apache-2.0
import { collect } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { at, demoEnv, started } from './helpers.js';

const spoke = async (envId: 'dev' | 'stg' | 'prod', id: string, hhmm: string) => {
  const adapter = await started(demoEnv(envId));
  const state = (await adapter.snapshot(at(hhmm))).spokes.find((s) => s.id === id);
  if (!state) throw new Error(`no spoke ${id}`);
  return state;
};

/** The reference prototype's ageFor, minus the hold term, for parity checks. */
function referenceAge(
  cadence: number,
  lag: number,
  offset: number,
  factor: number,
  m: number,
): number {
  const c = cadence * factor;
  const cycle = cadence < 30 ? c / 2 : (((m - offset) % c) + c) % c;
  return lag * factor + cycle;
}

describe('freshness model', () => {
  it('matches the reference formula for prod', async () => {
    const cases = [
      { id: 'sales', cadence: 240, lag: 20, offset: 0 },
      { id: 'finance', cadence: 1440, lag: 60, offset: 120 },
      { id: 'customer', cadence: 2, lag: 1, offset: 0 },
      { id: 'quality', cadence: 30, lag: 5, offset: 0 },
    ];
    for (const { id, cadence, lag, offset } of cases) {
      for (const hhmm of ['00:10', '06:59', '13:37', '23:59']) {
        const [h, m] = hhmm.split(':').map(Number);
        const minute = (h ?? 0) * 60 + (m ?? 0);
        expect((await spoke('prod', id, hhmm)).ageMinutes).toBeCloseTo(
          referenceAge(cadence, lag, offset, 1, minute),
          9,
        );
      }
    }
  });

  it('shows a steady mean age for cadences under 30 minutes', async () => {
    const ages = await Promise.all(
      ['00:00', '00:01', '07:13', '18:44'].map((t) => spoke('prod', 'operations', t)),
    );
    expect(new Set(ages.map((s) => s.ageMinutes))).toEqual(new Set([2 + 2.5]));
  });

  it('drifts and snaps back for long cadences (finance refreshes at 02:00)', async () => {
    expect((await spoke('prod', 'finance', '01:59')).ageMinutes).toBeCloseTo(60 + 1439, 9);
    expect((await spoke('prod', 'finance', '02:00')).ageMinutes).toBeCloseTo(60, 9);
    const adapter = await started(demoEnv('prod'));
    const events = await collect(adapter.events(at('02:00'), at('02:01')));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'freshness.change', spokeId: 'finance', ageMinutes: 60 }),
    );
  });

  it('ages held spokes during a transfer hold, then recovers', async () => {
    const normal = await spoke('prod', 'supply', '19:29');
    const held = await spoke('prod', 'supply', '20:29');
    // Same sawtooth phase an hour apart, so the difference is the 59 minutes of hold.
    expect(held.ageMinutes - normal.ageMinutes).toBeCloseTo(59, 9);
    expect(held.pastTarget).toBe(true);
    expect((await spoke('prod', 'supply', '20:31')).pastTarget).toBe(false);
    expect((await spoke('prod', 'ingest', '20:29')).ageMinutes).toBe(
      (await spoke('prod', 'ingest', '19:29')).ageMinutes,
    );
  });

  it('marks past target only beyond the 3% band, and loosens targets for fast-aging tiers', async () => {
    const prodSales = await spoke('prod', 'sales', '03:59');
    expect(prodSales.targetMinutes).toBe(280);
    expect(prodSales.ageMinutes).toBeCloseTo(259, 9);
    expect(prodSales.pastTarget).toBe(false);
    const devSales = await spoke('dev', 'sales', '12:00');
    expect(devSales.targetMinutes).toBe(280 * 3);
  });

  it('emits freshness.change whenever past-target status flips, consistent with snapshots', async () => {
    const adapter = await started(demoEnv('prod'));
    const changes = (await collect(adapter.events(at('19:00'), at('21:00')))).filter(
      (e) => e.type === 'freshness.change' && e.spokeId === 'supply',
    );
    expect(changes.some((e) => e.type === 'freshness.change' && e.pastTarget)).toBe(true);
    for (const change of changes) {
      if (change.type !== 'freshness.change') continue;
      const state = (await adapter.snapshot(new Date(change.ts))).spokes.find(
        (s) => s.id === 'supply',
      );
      expect(state?.pastTarget).toBe(change.pastTarget);
    }
  });
});
