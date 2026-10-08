// SPDX-License-Identifier: Apache-2.0
import {
  orbitRadius,
  orlojSpokeDistance,
  orlojSpokeSize,
  type Snapshot,
  type Topology,
  type Visuals,
} from '@orrery/core';
import { hourAngle } from '../geometry.js';
import { MS_PER_DAY, formatMinute } from './format.js';
import type { NoonSunModel, SpokeModel } from './types.js';

const FULL_TURN = Math.PI * 2;
const HOURS_PER_DAY = 24;
const NOON_HOUR = 12;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const SPOKE_CODE_LENGTH = 2;

/** Short medallion codes from the reference; other spokes use the first two letters of the name. */
const SPOKE_CODES: Readonly<Record<string, string>> = {
  ingest: 'In',
  supply: 'Su',
  operations: 'Op',
  quality: 'Qu',
  customer: 'Cu',
  sales: 'Sa',
  finance: 'Fi',
};

const INGEST_COLOR = '#9FC4FF';
const DOMAIN_COLORS = ['#5FA8D3', '#7BC8A4', '#B79CED', '#F28FAD', '#E9966B', '#A3B1C6'] as const;
const SOURCE_NOON_COLOR = '#E3A06B';
const STUDIO_NOON_COLOR = '#B7ADFF';
const OFFICE_NOON_COLOR = '#9FC4FF';

/** Stable spoke colors: one for ingest, then the domain palette in topology order. */
function spokeColor(role: string, domainIndex: number): string {
  if (role === 'ingest') return INGEST_COLOR;
  return DOMAIN_COLORS[domainIndex % DOMAIN_COLORS.length] ?? INGEST_COLOR;
}

/** Zodiac rotation in radians: `turnsPerDay` full turns per simulated UTC day. */
export function zodiacRotation(at: Date, turnsPerDay: number): number {
  const turns = (at.getTime() / MS_PER_DAY) * turnsPerDay;
  return (turns % 1) * FULL_TURN;
}

export function spokeCode(id: string, name: string): string {
  return SPOKE_CODES[id] ?? name.slice(0, SPOKE_CODE_LENGTH);
}

/** One placement per topology spoke that has snapshot state. */
export function buildSpokes(
  topology: Topology,
  snapshot: Snapshot,
  rotation: number,
  maxPipelines: number,
  visuals: Visuals,
): SpokeModel[] {
  const states = new Map(snapshot.spokes.map((s) => [s.id, s]));
  const count = topology.spokes.length;
  let domainIndex = 0;
  const spokes: SpokeModel[] = [];
  topology.spokes.forEach((spoke, slot) => {
    const color = spokeColor(spoke.role, domainIndex);
    if (spoke.role !== 'ingest') domainIndex += 1;
    const state = states.get(spoke.id);
    if (!state) return;
    const fo = visuals.freshnessOrbit;
    const orbit = orbitRadius(state.ageMinutes, fo);
    spokes.push({
      id: spoke.id,
      name: spoke.name,
      code: spokeCode(spoke.id, spoke.name),
      angle: rotation + (slot * FULL_TURN) / count,
      distance: orlojSpokeDistance(orbit, visuals.orloj.spokeDistance, fo.min),
      size: orlojSpokeSize(spoke.metrics.pipelines, maxPipelines, visuals.orloj.spokeSize),
      color,
      ageMinutes: state.ageMinutes,
      targetMinutes: state.targetMinutes,
      pastTarget: state.pastTarget,
      isIngest: spoke.role === 'ingest',
      isSecondaryMetastore: spoke.metastore !== topology.hub.metastore,
      pipelines: spoke.metrics.pipelines,
      products: spoke.metrics.products,
    });
  });
  return spokes;
}

function noonHour(utcOffset: number): number {
  return (((NOON_HOUR - utcOffset) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

function localTime(utcOffset: number, minuteOfDay: number): string {
  return formatMinute(minuteOfDay + utcOffset * MINUTES_PER_HOUR + MINUTES_PER_DAY);
}

function noonSun(
  key: string,
  code: string,
  name: string,
  kind: NoonSunModel['kind'],
  color: string,
  utcOffset: number,
  minuteOfDay: number,
): NoonSunModel {
  const hour = noonHour(utcOffset);
  return {
    key,
    code,
    name,
    kind,
    color,
    angle: hourAngle(hour),
    text: `${formatMinute(hour * MINUTES_PER_HOUR)} UTC. Local time now ${localTime(utcOffset, minuteOfDay)}.`,
  };
}

/** Local noon for each source region and each distinct office. */
export function buildNoonSuns(topology: Topology, minuteOfDay: number): NoonSunModel[] {
  const suns = topology.sourceGroups.map((g) =>
    noonSun(
      `source:${g.id}`,
      g.name.slice(-1),
      g.name,
      'source',
      SOURCE_NOON_COLOR,
      g.utcOffset,
      minuteOfDay,
    ),
  );
  const seen = new Set<string>();
  for (const u of topology.useCases) {
    if (u.site === undefined || u.utcOffset === undefined || seen.has(u.site)) continue;
    seen.add(u.site);
    const isStudio = u.site === topology.shipyard?.name;
    suns.push(
      isStudio
        ? noonSun(
            `office:${u.site}`,
            'ES',
            u.site,
            'studio',
            STUDIO_NOON_COLOR,
            u.utcOffset,
            minuteOfDay,
          )
        : noonSun(
            `office:${u.site}`,
            `O${u.site.slice(-1)}`,
            u.site,
            'office',
            OFFICE_NOON_COLOR,
            u.utcOffset,
            minuteOfDay,
          ),
    );
  }
  return suns;
}
