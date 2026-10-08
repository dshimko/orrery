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

const INGEST_COLOR = '#9FC4FF';
const DOMAIN_COLORS = ['#5FA8D3', '#7BC8A4', '#B79CED', '#F28FAD', '#E9966B', '#A3B1C6'] as const;

/** A stable color per spoke: one for ingest, then the domain palette in topology order. */
export function spokeColors(topology: Topology): Map<string, string> {
  let domainIndex = 0;
  return new Map(
    topology.spokes.map((spoke) => {
      if (spoke.role === 'ingest') return [spoke.id, INGEST_COLOR] as const;
      const color = DOMAIN_COLORS[domainIndex % DOMAIN_COLORS.length] ?? INGEST_COLOR;
      domainIndex += 1;
      return [spoke.id, color] as const;
    }),
  );
}

/** The domain spoke with the most pipelines gets the optional ring. */
export function ringedSpokeId(topology: Topology): string | null {
  const domains = topology.spokes.filter((s) => s.role === 'domain');
  const top = domains.reduce<(typeof domains)[number] | null>(
    (best, s) => (best === null || s.metrics.pipelines > best.metrics.pipelines ? s : best),
    null,
  );
  return top?.id ?? null;
}
