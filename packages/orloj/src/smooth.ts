// SPDX-License-Identifier: Apache-2.0
// Smoothed per-face values (stability rules 2 and 4). Every radius, size, and level moves toward
// its target with an exponential approach; past-target uses a hysteresis band. States are
// immutable: each step returns a new object.
import { approach, withHysteresis, type Visuals } from '@orrery/core';
import type { FaceModel } from './model/index.js';

/** Bell and halo move a little faster than the rest, still inside the 1.2 to 4 per second band. */
const BELL_RATE_FACTOR = 1.5;
const MAX_RATE = 4;

export interface SpokeSmooth {
  distance: number;
  isLate: boolean;
  /** Halo opacity, 0 to 1. */
  halo: number;
}

export interface FaceSmooth {
  moon: number;
  purse: number;
  bell: number;
  spokes: ReadonlyMap<string, SpokeSmooth>;
}

/** Past-target with hysteresis: flips only once the age clears the band around the target. */
export function nextLate(
  wasLate: boolean,
  flag: boolean,
  ageMinutes: number,
  targetMinutes: number,
  band: number,
): boolean {
  if (flag === wasLate) return flag;
  return withHysteresis(wasLate, ageMinutes, targetMinutes, band);
}

/** A state already at its targets, so a fresh view never animates in from nowhere. */
export function settledSmooth(model: FaceModel): FaceSmooth {
  return {
    moon: model.moon.phase,
    purse: model.figures.purseTarget,
    bell: model.figures.openIncidents > 0 ? 1 : 0,
    spokes: new Map(
      model.spokes.map((s) => [
        s.id,
        { distance: s.distance, isLate: s.pastTarget, halo: s.pastTarget ? 1 : 0 },
      ]),
    ),
  };
}

/** Advances a smoothed state by `dt` seconds toward the model's targets. */
export function stepSmooth(
  prev: FaceSmooth,
  model: FaceModel,
  dt: number,
  visuals: Visuals,
): FaceSmooth {
  const rate = visuals.stability.approachRate;
  const bellRate = Math.min(MAX_RATE, rate * BELL_RATE_FACTOR);
  const band = visuals.stability.hysteresis;
  const spokes = new Map<string, SpokeSmooth>();
  for (const s of model.spokes) {
    const before = prev.spokes.get(s.id);
    if (!before) {
      spokes.set(s.id, { distance: s.distance, isLate: s.pastTarget, halo: s.pastTarget ? 1 : 0 });
      continue;
    }
    const isLate = nextLate(before.isLate, s.pastTarget, s.ageMinutes, s.targetMinutes, band);
    spokes.set(s.id, {
      distance: approach(before.distance, s.distance, rate, dt),
      isLate,
      halo: approach(before.halo, isLate ? 1 : 0, bellRate, dt),
    });
  }
  return {
    moon: approach(prev.moon, model.moon.phase, rate, dt),
    purse: approach(prev.purse, model.figures.purseTarget, rate, dt),
    bell: approach(prev.bell, model.figures.openIncidents > 0 ? 1 : 0, bellRate, dt),
    spokes,
  };
}

/** Smoothed hub distance per spoke id, for placing hit regions where medallions are drawn. */
export function spokeDistances(state: FaceSmooth): Map<string, number> {
  return new Map([...state.spokes].map(([id, s]) => [id, s.distance]));
}
