// SPDX-License-Identifier: Apache-2.0
import type { Visuals } from '@orrery/core';

/** Fixed offsets, in face units, measured inward from the dial radius. */
export const ARC_INSET = 30;
export const TICK_INSET = 38;
export const SKY_INSET = 46;
export const STAR_HAND_INSET = 26;
export const SUN_INSET = 34;
export const HAND_TIP_INSET = 24;
export const NUMERAL_INSET = 11;

/** Dial and calendar geometry derived from `visuals.orloj`, all in face units. */
export interface Geometry {
  faceW: number;
  faceH: number;
  cx: number;
  cy: number;
  /** Dial radius inside the gold rim. */
  radius: number;
  rimWidth: number;
  hourRingWidth: number;
  /** Radius of the sky disk. */
  skyRadius: number;
  calCx: number;
  calCy: number;
  calRadius: number;
}

export function geometryFor(visuals: Visuals): Geometry {
  const { faceSize, dial, calendar } = visuals.orloj;
  return {
    faceW: faceSize[0],
    faceH: faceSize[1],
    cx: dial.center[0],
    cy: dial.center[1],
    radius: dial.radius,
    rimWidth: dial.rimWidth,
    hourRingWidth: dial.hourRingWidth,
    skyRadius: dial.radius - SKY_INSET,
    calCx: calendar.center[0],
    calCy: calendar.center[1],
    calRadius: calendar.radius,
  };
}

const HOURS_PER_DAY = 24;

/** Canvas angle of a UTC hour: midnight points down, noon points up. */
export function hourAngle(hours: number): number {
  return Math.PI / 2 + (hours / HOURS_PER_DAY) * Math.PI * 2;
}
