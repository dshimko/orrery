// SPDX-License-Identifier: Apache-2.0
// Dimming (reference `fadables`): each material carries a tier and a zone, and its opacity
// approaches base x (0.14 when outside the focus zones or the tier filter, else 1).
import { approach, type Workload } from '@orrery/core';
import type { Material } from 'three';
import type { TierFilter, Zone } from '../types.js';

export type FadeTier = 'bronze' | 'silver' | 'gold' | 'use' | 'none';

export const DIM_OPACITY = 0.14;
export const FADE_RATE = 6;
const SNAP = 0.001;

export function zoneVisible(focus: ReadonlySet<Zone> | null, zone: Zone): boolean {
  return focus === null || focus.has(zone);
}

export function tierVisible(filter: TierFilter, tier: FadeTier): boolean {
  return tier === 'none' || filter === 'all' || filter === tier;
}

/** The opacity multiplier a material of this tier and zone is heading toward. */
export function fadeTarget(
  tier: FadeTier,
  zone: Zone,
  tierFilter: TierFilter,
  focus: ReadonlySet<Zone> | null,
): number {
  return zoneVisible(focus, zone) && tierVisible(tierFilter, tier) ? 1 : DIM_OPACITY;
}

/** Vehicle and decoration groups the workload filter can hide. */
export type Slot =
  | 'laser'
  | 'pod'
  | 'copy'
  | 'shuttle'
  | 'tether'
  | 'crate'
  | 'gold'
  | 'orb'
  | 'aurora'
  | 'serve'
  | 'drone'
  | 'query'
  | 'beam';

type SlotOwner = Workload['vehicle'] | 'federated';

const SLOT_OWNER: Readonly<Record<Slot, SlotOwner>> = {
  laser: 'laser-pulse',
  pod: 'cargo-pod',
  copy: 'shuttle',
  shuttle: 'shuttle',
  tether: 'shuttle',
  crate: 'gantry-crate',
  gold: 'gantry-crate',
  orb: 'aurora-orb',
  aurora: 'aurora-orb',
  serve: 'gold-pulse',
  drone: 'drone',
  query: 'federated',
  beam: 'federated',
};

const ALL_SLOTS = Object.keys(SLOT_OWNER) as Slot[];

/**
 * Slots shown for a workload filter: every slot for 'all'; the comet queries and beams for
 * 'federated'; otherwise the slots owned by the chosen workload's vehicle. Unknown ids show none.
 */
export function visibleSlots(workload: string, workloads: readonly Workload[]): ReadonlySet<Slot> {
  if (workload === 'all') return new Set(ALL_SLOTS);
  const owner: SlotOwner | undefined =
    workload === 'federated' ? 'federated' : workloads.find((w) => w.id === workload)?.vehicle;
  return new Set(ALL_SLOTS.filter((slot) => owner !== undefined && SLOT_OWNER[slot] === owner));
}

export interface Fadable {
  readonly mats: readonly Material[];
  readonly base: readonly number[];
  readonly tier: FadeTier;
  readonly zone: Zone;
  /** Current multiplier, 0.14 to 1. */
  k: number;
}

export class FadeRegistry {
  private readonly items: Fadable[] = [];

  /** Registers materials at their current opacity; an empty list is fine for dynamic lines. */
  add(mats: readonly Material[], tier: FadeTier, zone: Zone): Fadable {
    const item: Fadable = { mats, base: mats.map((m) => m.opacity), tier, zone, k: 1 };
    this.items.push(item);
    return item;
  }

  update(tierFilter: TierFilter, focus: ReadonlySet<Zone> | null, dt: number): void {
    for (const item of this.items) {
      const target = fadeTarget(item.tier, item.zone, tierFilter, focus);
      const next = approach(item.k, target, FADE_RATE, dt);
      const k = Math.abs(next - target) < SNAP ? target : next;
      if (k === item.k) continue;
      item.k = k;
      item.mats.forEach((m, i) => {
        m.opacity = (item.base[i] ?? 1) * k;
      });
    }
  }
}
