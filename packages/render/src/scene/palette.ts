// SPDX-License-Identifier: Apache-2.0
// Reference-only colors: values the prototype hard-codes that are not part of `Visuals`.
import type { Topology } from '@orrery/core';

export const COLOR_OK = '#5BD6A0';
export const COLOR_GATE = '#7BD88F';
export const COLOR_YARD = '#2E2458';
export const COLOR_NIGHT = '#03060D';
export const COLOR_STAR = '#BFD0F0';
export const COLOR_SUN = '#FFD98A';
export const COLOR_SUN_GLOW = '#FFB54A';
export const COLOR_BELT = '#6E7A90';

/** The domain spoke with the most pipelines gets the optional ring. */
export function ringedSpokeId(topology: Topology): string | null {
  const domains = topology.spokes.filter((s) => s.role === 'domain');
  const top = domains.reduce<(typeof domains)[number] | null>(
    (best, s) => (best === null || s.metrics.pipelines > best.metrics.pipelines ? s : best),
    null,
  );
  return top?.id ?? null;
}
