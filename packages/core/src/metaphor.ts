// SPDX-License-Identifier: Apache-2.0
import type { Visuals } from './config/visuals.js';
import type { Severity } from './model/snapshot.js';

/** Stable key for each platform-concept to scene-element mapping. */
export type MetaphorKey =
  | 'hub'
  | 'spoke'
  | 'ingest'
  | 'freshness'
  | 'sources'
  | 'medallion'
  | 'stations'
  | 'shipyard'
  | 'sharing'
  | 'federation'
  | 'alerts';

/** One row of the concept-to-scene mapping table. */
export interface MetaphorEntry {
  readonly concept: string;
  readonly element: string;
  readonly encoding: string;
  readonly key: MetaphorKey;
}

/** The platform concept to scene element mapping, as data. */
export const METAPHOR: readonly MetaphorEntry[] = [
  {
    key: 'hub',
    concept: 'Hub (core platform where most data products live)',
    element: 'Central planet',
    encoding:
      'Ring of satellites, one per data product; satellites pop in when a product publishes',
  },
  {
    key: 'spoke',
    concept: 'Spoke (domain or functional data platform)',
    element: 'Planet in orbit',
    encoding: 'Size by a selectable metric: pipelines, products, complexity, or volume',
  },
  {
    key: 'ingest',
    concept: 'Ingest spoke (a spoke that receives source data)',
    element: 'Planet with a bronze debris ring and a gantry ring',
    encoding: 'Debris height shows backlog; gantry flashes on quality pass or reject',
  },
  {
    key: 'freshness',
    concept: 'Freshness',
    element: 'Orbit radius',
    encoding:
      'Log scale of current data age; planets drift outward as data ages and swing in on refresh; ring turns amber past target',
  },
  {
    key: 'sources',
    concept: 'Sources',
    element: 'Mining asteroids in an outer belt, grouped by configurable region',
    encoding: 'Beacon brightness follows local shift or activity',
  },
  {
    key: 'medallion',
    concept: 'Medallion tiers',
    element:
      'Material and color: bronze cargo, silver crates and shuttles, gold capsules and satellites',
    encoding: 'Tier filter dims everything outside the chosen tier',
  },
  {
    key: 'stations',
    concept: 'Use cases and consumers',
    element: 'Stations in low orbit around the hub',
    encoding: 'Size and status color follow activity and alerts',
  },
  {
    key: 'shipyard',
    concept: 'Engineering and release',
    element: 'Shipyard',
    encoding: 'Release drones fly to spokes on deploy',
  },
  {
    key: 'sharing',
    concept: 'Cross-metastore sharing',
    element: 'Teal tethers between hub and spokes in another metastore',
    encoding: 'Tether thickness follows read volume',
  },
  {
    key: 'federation',
    concept: 'Query federation (foreign catalogs)',
    element: 'Comets outside the belt with dotted query beams',
    encoding: 'Beams pulse when queried; nothing is copied',
  },
  {
    key: 'alerts',
    concept: 'Alerts',
    element: 'Light pillars, expanding rings, floating flags',
    encoding: 'Red for incident, amber for warning, blue for info',
  },
];

/** Maps each alert severity to its key in `Visuals['colors']`. */
export const SEVERITY_COLOR_KEY: Record<Severity, 'incident' | 'warning' | 'info'> = {
  incident: 'incident',
  warning: 'warning',
  info: 'info',
};

const MIN_AGE_MINUTES = 1;
const RADIANS_PER_TURN = 2 * Math.PI;
const KEPLER_EXPONENT = 1.5;
const MINUTES_PER_DAY = 1440;
const FALLBACK_SPOKE_COLOR = '#9FC4FF';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Ratio of metric to maxMetric clamped to [0, 1]; 0 when either is non-positive or non-finite. */
function sizeRatio(metric: number, maxMetric: number): number {
  if (!Number.isFinite(metric) || !Number.isFinite(maxMetric)) return 0;
  if (maxMetric <= 0 || metric <= 0) return 0;
  return clamp(metric / maxMetric, 0, 1);
}

/** Orbit radius from data age in minutes (log scale, clamped). */
export function orbitRadius(ageMinutes: number, cfg: Visuals['freshnessOrbit']): number {
  const age = Number.isFinite(ageMinutes) && ageMinutes >= 0 ? ageMinutes : MIN_AGE_MINUTES;
  const raw = cfg.base + cfg.scale * Math.log10(Math.max(MIN_AGE_MINUTES, age));
  return clamp(raw, cfg.min, cfg.max);
}

/** Planet size from a metric relative to the largest metric across spokes. */
export function planetSize(metric: number, maxMetric: number, cfg: Visuals['planetSize']): number {
  return cfg.base + cfg.scale * Math.sqrt(sizeRatio(metric, maxMetric));
}

/** Angular speed in radians per simulated hour at the given orbit radius. */
export function orbitSpeed(radius: number, cfg: Visuals['orbitSpeed']): number {
  const period = cfg.periodHours * Math.pow(radius / cfg.referenceRadius, KEPLER_EXPONENT);
  return RADIANS_PER_TURN / period;
}

/** Distance from the Orloj hub for a spoke at the given scene orbit radius. */
export function orlojSpokeDistance(
  orbit: number,
  cfg: Visuals['orloj']['spokeDistance'],
  orbitMin: number,
): number {
  return cfg.base + ((orbit - orbitMin) / cfg.orbitRange) * cfg.span;
}

/** Orloj spoke medallion size from its pipeline count relative to the maximum. */
export function orlojSpokeSize(
  pipelines: number,
  maxPipelines: number,
  cfg: Visuals['orloj']['spokeSize'],
): number {
  return cfg.base + cfg.scale * Math.sqrt(sizeRatio(pipelines, maxPipelines));
}

/**
 * A spoke's color: an explicit `spokeColors` entry wins; otherwise ingest takes `palette[0]` and
 * domain spokes cycle through the rest by `domainIndex` (their order among non-ingest spokes).
 */
export function spokeColor(
  spokeId: string,
  domainIndex: number,
  role: string,
  visuals: Pick<Visuals, 'palette' | 'spokeColors'>,
): string {
  const explicit = visuals.spokeColors[spokeId];
  if (explicit !== undefined) return explicit;
  const { palette } = visuals;
  const first = palette[0] ?? FALLBACK_SPOKE_COLOR;
  if (role === 'ingest' || palette.length < 2) return first;
  return palette[1 + (domainIndex % (palette.length - 1))] ?? first;
}

/** Colors for every spoke in topology order, keyed by spoke id. */
export function spokeColorMap(
  spokes: readonly { id: string; role: string }[],
  visuals: Pick<Visuals, 'palette' | 'spokeColors'>,
): Map<string, string> {
  let domainIndex = 0;
  return new Map(
    spokes.map((spoke) => {
      const color = spokeColor(spoke.id, domainIndex, spoke.role, visuals);
      if (spoke.role !== 'ingest') domainIndex += 1;
      return [spoke.id, color] as const;
    }),
  );
}

/** Simulated minutes that elapse per real second at the given speed multiplier. */
export function simMinutesPerSecond(cfg: Visuals['time'], speed = 1): number {
  return (MINUTES_PER_DAY / cfg.secondsPerSimDay) * speed;
}

/** Stability rule 3: fast-cadence tables show mean age instead of max age. */
export function usesMeanAge(cadenceMinutes: number, cfg: Visuals['stability']): boolean {
  return cadenceMinutes < cfg.meanAgeCadenceMinutes;
}
