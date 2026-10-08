// SPDX-License-Identifier: Apache-2.0
import type { Visuals } from '@orrery/core';
import { hourAngle } from '../geometry.js';
import { ORLOJ_STRINGS } from '../strings.js';
import type { OrlojFace, OrlojStrings, OrlojTime } from '../types.js';
import { buildCalendar } from './calendar.js';
import { buildFigures } from './figures.js';
import { minuteOfUtcDay } from './format.js';
import { buildProcession } from './procession.js';
import { buildArcs, buildTicks, nextStar, windowSpans } from './schedule.js';
import { buildNoonSuns, buildSpokes, zodiacRotation } from './spokes.js';
import type { FaceModel } from './types.js';

export type * from './types.js';
export { faceHits, type SpokeDistances } from './hits.js';
export {
  annotationAnchors,
  firstLoadedIndex,
  labelSide,
  MARKER_RADIUS,
  type AnnotationAnchor,
  type LabelSide,
} from './annotation.js';
export { type LocalTimeContext } from './local-time.js';

const MOON_PHASE_OFFSET = Math.PI * 0.62;
const MINUTES_PER_HOUR = 60;
/** The rooster crows during the first 20 simulated minutes after midnight. */
const ROOSTER_MINUTES = 20;

/** Largest pipeline count across every spoke of every face (sizes medallions consistently). */
export function maxPipelinesAcross(faces: readonly OrlojFace[]): number {
  let max = 1;
  for (const face of faces) {
    for (const spoke of face.topology?.spokes ?? []) max = Math.max(max, spoke.metrics.pipelines);
  }
  return max;
}

function errorMessageOf(face: OrlojFace, strings: OrlojStrings): string | null {
  if (face.error !== undefined && face.error !== '') return face.error;
  if (face.snapshot === null || face.topology === null) return strings.model.noData;
  return null;
}

const EMPTY_FIGURES = {
  spend: 0,
  purseTarget: 0.25,
  spokesPastTarget: 0,
  spokeCount: 0,
  openIncidents: 0,
  incidentLevel: 'none',
  incidentColor: '',
  incidentTitles: [],
  consumerActivity: 0,
} as const;

/**
 * Pure model of one face at one moment. Deterministic: the same face, time, and visuals always
 * produce a deeply equal result, so paused frames are identical (stability rule 8).
 */
export function createFaceModel(
  face: OrlojFace,
  time: OrlojTime,
  visuals: Visuals,
  maxPipelines: number,
  strings: OrlojStrings = ORLOJ_STRINGS,
): FaceModel {
  const minute = minuteOfUtcDay(time.at);
  const sunAngle = hourAngle(minute / MINUTES_PER_HOUR);
  const base = {
    envId: face.env.id,
    name: face.env.name,
    tier: face.env.tier,
    tierColor: face.tierColor,
    minuteOfDay: minute,
    sunAngle,
  };
  const { snapshot, topology } = face;
  const errorMessage = errorMessageOf(face, strings);
  if (errorMessage !== null || snapshot === null || topology === null) {
    return {
      ...base,
      errorMessage: errorMessage ?? strings.model.noData,
      hubName: strings.model.defaultHubName,
      products: 0,
      arcs: [],
      ticks: [],
      noonSuns: [],
      spokes: [],
      moon: { phase: 0, angle: sunAngle + MOON_PHASE_OFFSET },
      star: null,
      figures: { ...EMPTY_FIGURES, incidentTitles: [] },
      procession: { figures: [], progress: null, hasRelease: false, text: '' },
      rooster: { isCrowing: false },
      calendar: null,
      unavailable: {},
    };
  }

  const spans = windowSpans(snapshot.schedule);
  const star = nextStar(spans, minute, strings);
  const rotation = zodiacRotation(time.at, visuals.orloj.zodiacTurnsPerDay);
  return {
    ...base,
    errorMessage: null,
    hubName: topology.hub.name,
    products: snapshot.counts.products,
    arcs: buildArcs(spans, snapshot, minute, visuals.colors, strings),
    ticks: buildTicks(spans, strings),
    noonSuns: buildNoonSuns(topology, minute, strings),
    spokes: buildSpokes(topology, snapshot, rotation, maxPipelines, visuals),
    moon: { phase: snapshot.backlog, angle: sunAngle + MOON_PHASE_OFFSET },
    star,
    figures: buildFigures(snapshot, topology.spokes.length, visuals.colors),
    procession: buildProcession(snapshot, spans, face.seed, time.at, minute, visuals, strings),
    rooster: { isCrowing: snapshot.previousDayClean && minute < ROOSTER_MINUTES },
    calendar: buildCalendar(snapshot, time.at, star ? star.label : strings.model.nothingScheduled),
    unavailable: { ...snapshot.unavailable },
  };
}
