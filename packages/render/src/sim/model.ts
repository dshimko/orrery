// SPDX-License-Identifier: Apache-2.0
// The scene model: every position, radius, and level the renderer draws, as plain data.
// It is mutated in place once per frame for performance (the one deliberate exception to the
// immutability rule); everything else in Orrery treats data as immutable.
import {
  lcg,
  orbitRadius,
  planetSize,
  type Snapshot,
  type Spoke,
  type Topology,
  type UseCase,
  type Visuals,
} from '@orrery/core';
import { TAU, rad, type Vec3 } from './math.js';
import type { Filters, Zone } from '../types.js';

export const YARD_POSITION: Readonly<Vec3> = Object.freeze({ x: -26, y: 4, z: 17 });
const SPOKE_START_ANGLE = 0.3;
const SPOKE_ANGLE_STEP = 1.3;
const GROUP_START_DEG = 150;
const GROUP_STEP_DEG = 17;
const SITE_STEP_DEG = 4;
const COMET_PHASE_STEP = 2.6;
const COMET_PHASE_START = 0.7;

export interface SpokeBody {
  id: string;
  spoke: Spoke;
  isIngest: boolean;
  zone: Zone;
  /** Integrated orbital angle (stability rule 1). */
  angle: number;
  phase: number;
  orbit: number;
  radius: number;
  activity: number;
  glow: number;
  age: number;
  target: number;
  pastTarget: boolean;
  pos: Vec3;
}

export interface SiteBody {
  id: string;
  name: string;
  groupId: string;
  activity: number;
  /** Crate pile height, 0 to 1. */
  pile: number;
  pos: Vec3;
}

export interface GroupBody {
  id: string;
  name: string;
  pos: Vec3;
  sites: SiteBody[];
}

export interface StationBody {
  id: string;
  useCase: UseCase;
  phase: number;
  /** Fixed beside the shipyard when the use case sits at the shipyard's site. */
  fixed: Vec3 | null;
  activity: number;
  status: 'ok' | 'warning' | 'incident';
  note: string;
  flash: number;
  pos: Vec3;
}

export interface CometBody {
  id: string;
  name: string;
  phase: number;
  pos: Vec3;
}

export interface RingSatellite {
  spokeId: string;
  angle: number;
  /** 0 just published (pops in) to 1 settled. */
  pop: number;
}

export interface SceneModel {
  topology: Topology;
  visuals: Visuals;
  seed: number;
  spokes: SpokeBody[];
  spokeById: Map<string, SpokeBody>;
  ingest: SpokeBody | null;
  groups: GroupBody[];
  siteById: Map<string, SiteBody>;
  stations: StationBody[];
  stationById: Map<string, StationBody>;
  comets: CometBody[];
  cometById: Map<string, CometBody>;
  ringSatellites: RingSatellite[];
  yard: Vec3;
  /** Ingest yard fill (bronze debris height), 0 to 1.4. */
  yardPile: number;
  /** Decorative animation clock: advances only while playing (rule 8). */
  animTime: number;
  /** Simulated hours since the epoch, from the time source. */
  simHours: number;
  snapshot: Snapshot;
  filters: Filters;
  /** Zones kept bright by alert focus; null shows everything. */
  focusZones: Set<Zone> | null;
  /** Seconds accumulated per alert id toward its next pulse ring. */
  alertPulse: Map<string, number>;
}

export const DEFAULT_FILTERS: Filters = {
  tier: 'all',
  workload: 'all',
  focusAlerts: true,
  pinnedZone: null,
};

function metricMax(spokes: readonly Spoke[], visuals: Visuals): number {
  const key = visuals.sizeBy;
  if (key === 'complexity') return 5;
  return Math.max(0, ...spokes.map((s) => s.metrics[key]));
}

export function targetSize(model: Pick<SceneModel, 'topology' | 'visuals'>, spoke: Spoke): number {
  const max = metricMax(model.topology.spokes, model.visuals);
  return planetSize(spoke.metrics[model.visuals.sizeBy], max, model.visuals.planetSize);
}

function buildSpokes(topology: Topology, visuals: Visuals, snapshot: Snapshot): SpokeBody[] {
  const states = new Map(snapshot.spokes.map((s) => [s.id, s]));
  return topology.spokes.map((spoke, i) => {
    const state = states.get(spoke.id);
    const isIngest = spoke.role === 'ingest';
    const angle = SPOKE_START_ANGLE + i * SPOKE_ANGLE_STEP;
    const age = state?.ageMinutes ?? spoke.freshness.cadenceMinutes;
    const orbit = orbitRadius(age, visuals.freshnessOrbit);
    return {
      id: spoke.id,
      spoke,
      isIngest,
      zone: isIngest ? 'ingest' : 'planets',
      angle,
      phase: angle,
      orbit,
      radius: targetSize({ topology, visuals }, spoke),
      activity: state?.activity ?? 0,
      glow: 0,
      age,
      target: state?.targetMinutes ?? spoke.freshness.targetMinutes,
      pastTarget: state?.pastTarget ?? false,
      pos: { x: orbit * Math.cos(angle), y: 0, z: orbit * Math.sin(angle) },
    };
  });
}

function buildGroups(topology: Topology, visuals: Visuals): GroupBody[] {
  const belt = visuals.world.beltRadius;
  return topology.sourceGroups.map((group, gi) => {
    const deg = GROUP_START_DEG + gi * GROUP_STEP_DEG;
    const count = group.sites.length;
    const sites = group.sites.map((site, i) => {
      const a = rad(deg + (i - (count - 1) / 2) * SITE_STEP_DEG);
      const r = belt + (i % 2 ? 4 : -3);
      return {
        id: site.id,
        name: site.name,
        groupId: group.id,
        activity: 0,
        pile: 0,
        pos: { x: r * Math.cos(a), y: i % 2 ? 2 : -1.5, z: r * Math.sin(a) },
      };
    });
    const groupR = belt + 14;
    return {
      id: group.id,
      name: group.name,
      pos: { x: groupR * Math.cos(rad(deg)), y: 0, z: groupR * Math.sin(rad(deg)) },
      sites,
    };
  });
}

function buildStations(topology: Topology): StationBody[] {
  const shipyardSite = topology.shipyard?.name;
  return topology.useCases.map((useCase, i) => ({
    id: useCase.id,
    useCase,
    phase: i,
    fixed:
      shipyardSite !== undefined && useCase.site === shipyardSite
        ? { x: YARD_POSITION.x + 5, y: YARD_POSITION.y, z: YARD_POSITION.z }
        : null,
    activity: 0,
    status: 'ok',
    note: '',
    flash: 0,
    pos: { x: 0, y: 0, z: 0 },
  }));
}

/** One satellite per domain product, shuffled with the environment seed as in the reference. */
function buildRing(topology: Topology, seed: number): RingSatellite[] {
  const points = topology.spokes
    .filter((s) => s.role === 'domain')
    .flatMap((s) =>
      Array.from({ length: s.metrics.products }, () => ({ spokeId: s.id, angle: 0, pop: 1 })),
    );
  const next = lcg(seed + 7);
  const shuffled = [...points].sort(() => next() - 0.5);
  return shuffled.map((p, i) => ({ ...p, angle: (i / Math.max(1, shuffled.length)) * TAU }));
}

export function createModel(
  topology: Topology,
  visuals: Visuals,
  seed: number,
  snapshot: Snapshot,
): SceneModel {
  const spokes = buildSpokes(topology, visuals, snapshot);
  const groups = buildGroups(topology, visuals);
  const stations = buildStations(topology);
  const comets = topology.foreignCatalogs.map((f, i) => ({
    id: f.id,
    name: f.name,
    phase: i * COMET_PHASE_STEP + COMET_PHASE_START,
    pos: { x: 0, y: 0, z: 0 },
  }));
  return {
    topology,
    visuals,
    seed,
    spokes,
    spokeById: new Map(spokes.map((s) => [s.id, s])),
    ingest: spokes.find((s) => s.isIngest) ?? null,
    groups,
    siteById: new Map(groups.flatMap((g) => g.sites.map((s) => [s.id, s] as const))),
    stations,
    stationById: new Map(stations.map((s) => [s.id, s])),
    comets,
    cometById: new Map(comets.map((c) => [c.id, c])),
    ringSatellites: buildRing(topology, seed),
    yard: { ...YARD_POSITION },
    yardPile: 0.5,
    animTime: 0,
    simHours: Date.parse(snapshot.at) / 3_600_000,
    snapshot,
    filters: { ...DEFAULT_FILTERS },
    focusZones: null,
    alertPulse: new Map(),
  };
}
