// SPDX-License-Identifier: Apache-2.0
import { Visuals } from '@orrery/core';
import { MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DIM_OPACITY,
  FadeRegistry,
  fadeTarget,
  visibleSlots,
  type Slot,
} from '../src/scene/fade.js';
import type { Zone } from '../src/types.js';

const { workloads } = Visuals.parse({});
const zones = (...z: Zone[]): ReadonlySet<Zone> => new Set(z);

describe('fadeTarget', () => {
  it('stays bright with no focus and the all-tier filter', () => {
    expect(fadeTarget('gold', 'planets', 'all', null)).toBe(1);
  });

  it('dims zones outside the focus set', () => {
    expect(fadeTarget('gold', 'planets', 'all', zones('belt'))).toBe(DIM_OPACITY);
    expect(fadeTarget('gold', 'belt', 'all', zones('belt'))).toBe(1);
  });

  it('dims other tiers but never tier none', () => {
    expect(fadeTarget('bronze', 'belt', 'gold', null)).toBe(DIM_OPACITY);
    expect(fadeTarget('gold', 'earth', 'gold', null)).toBe(1);
    expect(fadeTarget('none', 'earth', 'bronze', null)).toBe(1);
  });
});

describe('visibleSlots', () => {
  const slotsFor = (id: string): Slot[] => [...visibleSlots(id, workloads)].sort();

  it('shows every slot for all', () => {
    expect(visibleSlots('all', workloads).size).toBe(13);
  });

  it.each([
    ['streaming', ['laser']],
    ['batch', ['pod']],
    ['transfer', ['copy', 'shuttle', 'tether']],
    ['transform', ['crate', 'gold']],
    ['ml', ['aurora', 'orb']],
    ['serving', ['serve']],
    ['build', ['drone']],
    ['federated', ['beam', 'query']],
  ])('maps %s to its vehicles', (id, expected) => {
    expect(slotsFor(id)).toEqual(expected);
  });

  it('shows nothing for an unknown workload id', () => {
    expect(slotsFor('nope')).toEqual([]);
  });
});

describe('FadeRegistry', () => {
  it('approaches the dim target and recovers without overshooting', () => {
    const registry = new FadeRegistry();
    const material = new MeshBasicMaterial({ transparent: true, opacity: 0.5 });
    const item = registry.add([material], 'gold', 'planets');
    for (let i = 0; i < 120; i += 1) registry.update('all', zones('belt'), 1 / 60);
    expect(item.k).toBeLessThan(0.5);
    expect(item.k).toBeGreaterThanOrEqual(DIM_OPACITY);
    expect(material.opacity).toBeCloseTo(0.5 * item.k, 6);
    for (let i = 0; i < 600; i += 1) registry.update('all', null, 1 / 60);
    expect(item.k).toBe(1);
    expect(material.opacity).toBeCloseTo(0.5, 6);
  });

  it('does not move when dt is zero (paused)', () => {
    const registry = new FadeRegistry();
    const item = registry.add([], 'gold', 'planets');
    registry.update('bronze', null, 0);
    expect(item.k).toBe(1);
  });
});
