// SPDX-License-Identifier: Apache-2.0
import type { FaceHit } from './model/index.js';
import type { OrlojHit } from './types.js';

/** Hit circles never shrink below this on screen, so small parts stay hoverable. */
export const MIN_HIT_RADIUS_PX = 10;

/** Converts face-unit hits to canvas CSS pixels for the face at (originX, originY). */
export function toPixelHits(
  envId: string,
  hits: readonly FaceHit[],
  originX: number,
  originY: number,
  scale: number,
): OrlojHit[] {
  return hits.map((h) => ({
    envId,
    part: h.part,
    title: h.title,
    text: h.text,
    x: originX + h.x * scale,
    y: originY + h.y * scale,
    r: Math.max(MIN_HIT_RADIUS_PX, h.r * scale),
  }));
}

/**
 * The hit under a point: the circle test, then the nearest center wins; ties go to the region
 * registered later (drawn on top).
 */
export function findHit(hits: readonly OrlojHit[], x: number, y: number): OrlojHit | null {
  let best: OrlojHit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const h of hits) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d <= h.r && d <= bestDistance) {
      best = h;
      bestDistance = d;
    }
  }
  return best;
}
