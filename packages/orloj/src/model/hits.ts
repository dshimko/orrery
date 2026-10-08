// SPDX-License-Identifier: Apache-2.0
import {
  SKY_INSET,
  ARC_INSET,
  TICK_INSET,
  STAR_HAND_INSET,
  SUN_INSET,
  type Geometry,
} from '../geometry.js';
import {
  HUB_RADIUS,
  LUTE_POS,
  MIRROR_POS,
  MISER_POS,
  NICHE_HIT_RADIUS,
  PLAQUE,
  PLAQUE_HIT_RADIUS,
  PROCESSION_HIT,
  PROCESSION_HIT_RADIUS,
  ROOSTER_HIT_RADIUS,
  ROOSTER_POS,
  SKELETON_POS,
} from '../constants.js';
import { formatAge, formatMinute } from './format.js';
import type { FaceHit, FaceModel, SpokeModel } from './types.js';

const MOON_ORBIT_SHARE = 0.62;
const MOON_RADIUS = 8;
const NOON_MARK_OFFSET = 6;
const HIT_R = {
  arc: 9,
  tick: 6,
  noon: 7,
  moon: 10,
  star: 8,
  sun: 12,
  day: 5,
  spokePad: 3,
} as const;
const CALENDAR_HIT_RADIUS = 40;
const CALENDAR_DAY_INSET = 6;
const ERROR_TITLE = 'No data for this environment';

/** Distance of each spoke from the hub, by id; spokes absent here use their model target. */
export type SpokeDistances = ReadonlyMap<string, number>;

function polar(g: Geometry, angle: number, radius: number): { x: number; y: number } {
  return { x: g.cx + Math.cos(angle) * radius, y: g.cy + Math.sin(angle) * radius };
}

function spokeHit(g: Geometry, s: SpokeModel, distance: number): FaceHit {
  const { x, y } = polar(g, s.angle, distance);
  const target = `${formatAge(s.targetMinutes)} target`;
  return {
    part: `spoke:${s.id}`,
    title: s.name + (s.isIngest ? ' (ingest spoke)' : ''),
    text:
      `Data age ${formatAge(s.ageMinutes)} against a ${target}` +
      `${s.pastTarget ? ', past target' : ''}. ${s.pipelines} pipelines, ${s.products} products` +
      `${s.isSecondaryMetastore ? '. Secondary metastore.' : '.'}`,
    x,
    y,
    r: s.size + HIT_R.spokePad,
  };
}

function plaqueHit(model: FaceModel): FaceHit {
  return {
    part: 'plaque',
    title: model.name,
    text: `Environment tier: ${model.tier}.`,
    x: (PLAQUE.x0 + PLAQUE.x1) / 2,
    y: (PLAQUE.y0 + PLAQUE.y1) / 2,
    r: PLAQUE_HIT_RADIUS,
  };
}

function figureHits(model: FaceModel): FaceHit[] {
  const f = model.figures;
  const incidentText =
    f.openIncidents > 0
      ? `${f.incidentTitles.length > 0 ? f.incidentTitles.join('; ') : `${f.openIncidents} open incidents`}.`
      : 'No open incidents. The bell rings when one opens.';
  return [
    {
      part: 'miser',
      title: 'Miser: spend rate',
      text: `${f.spend} compute units per hour at current activity.`,
      ...MISER_POS,
      r: NICHE_HIT_RADIUS,
    },
    {
      part: 'mirror',
      title: 'Mirror: freshness',
      text: `${f.spokesPastTarget} of ${f.spokeCount} spokes past their freshness target.`,
      ...MIRROR_POS,
      r: NICHE_HIT_RADIUS,
    },
    {
      part: 'skeleton',
      title: 'Skeleton: incidents',
      text: incidentText,
      ...SKELETON_POS,
      r: NICHE_HIT_RADIUS,
    },
    {
      part: 'lute',
      title: 'Lute: consumers',
      text: `${Math.round(f.consumerActivity * 100)}% of peak use-case activity across offices.`,
      ...LUTE_POS,
      r: NICHE_HIT_RADIUS,
    },
  ];
}

function calendarHits(model: FaceModel, g: Geometry): FaceHit[] {
  const cal = model.calendar;
  if (!cal) return [];
  const dayHits = cal.days.map((d) => ({
    part: `calendar-day:${d.day}`,
    title: `Day ${d.day}${d.isToday ? ' (today)' : ''}`,
    text: `${d.isPast ? `${d.releases} releases` : 'Planned'}${d.promotion ? ', promotion' : ''}${d.monthEndClose ? '. Month-end close.' : '.'}`,
    x: g.calCx + Math.cos(d.midAngle) * (g.calRadius - CALENDAR_DAY_INSET),
    y: g.calCy + Math.sin(d.midAngle) * (g.calRadius - CALENDAR_DAY_INSET),
    r: HIT_R.day,
  }));
  const summary: FaceHit = {
    part: 'calendar',
    title: 'Release calendar',
    text: `${cal.totalReleases} releases and ${cal.totalPromotions} promotions so far this month.`,
    x: g.calCx,
    y: g.calCy,
    r: CALENDAR_HIT_RADIUS,
  };
  return [...dayHits, summary];
}

function dialHits(model: FaceModel, g: Geometry, distances: SpokeDistances): FaceHit[] {
  const R = g.radius;
  const skyR = R - SKY_INSET;
  const hits: FaceHit[] = [];
  for (const a of model.arcs) {
    hits.push({
      part: `arc:${a.id}`,
      title: a.title,
      text: a.text,
      ...polar(g, a.midAngle, R - ARC_INSET),
      r: HIT_R.arc,
    });
  }
  for (const t of model.ticks) {
    hits.push({
      part: `tick:${t.id}`,
      title: t.title,
      text: t.text,
      ...polar(g, t.angle, R - TICK_INSET),
      r: HIT_R.tick,
    });
  }
  for (const n of model.noonSuns) {
    hits.push({
      part: `noon:${n.key}`,
      title: `${n.name} local noon`,
      text: n.text,
      ...polar(g, n.angle, skyR + NOON_MARK_OFFSET),
      r: HIT_R.noon,
    });
  }
  hits.push({
    part: 'hub',
    title: model.hubName,
    text: `Hub of the ${model.name.toLowerCase()} system with ${model.products} data products.`,
    x: g.cx,
    y: g.cy,
    r: HUB_RADIUS,
  });
  for (const s of model.spokes) hits.push(spokeHit(g, s, distances.get(s.id) ?? s.distance));
  hits.push({
    part: 'moon',
    title: 'Moon: ingest backlog',
    text: `${Math.round(model.moon.phase * 100)}% of the bronze yard in use.`,
    ...polar(g, model.moon.angle, skyR * MOON_ORBIT_SHARE),
    r: MOON_RADIUS + 2,
  });
  if (model.star) {
    hits.push({
      part: 'star-hand',
      title: 'Next scheduled',
      text: `${model.star.label}.`,
      ...polar(g, model.star.angle, R - STAR_HAND_INSET),
      r: HIT_R.star,
    });
  }
  hits.push({
    part: 'sun-hand',
    title: 'Sun hand: current UTC time',
    text: `${formatMinute(model.minuteOfDay)} UTC. Midnight at the bottom, noon at the top.`,
    ...polar(g, model.sunAngle, R - SUN_INSET),
    r: HIT_R.sun,
  });
  return hits;
}

/**
 * Hit regions in face units, in registration order (later entries sit on top). Spoke positions
 * follow the smoothed `distances` so tooltips track the medallions the viewer sees.
 */
export function faceHits(model: FaceModel, g: Geometry, distances: SpokeDistances): FaceHit[] {
  const procession: FaceHit = {
    part: 'procession',
    title: 'Hourly procession',
    text: model.procession.text,
    ...PROCESSION_HIT,
    r: PROCESSION_HIT_RADIUS,
  };
  const rooster: FaceHit = {
    part: 'rooster',
    title: 'Rooster',
    text: model.rooster.isCrowing
      ? 'Crowing: yesterday passed without a red incident.'
      : 'Crows just after midnight when the day passed without a red incident.',
    ...ROOSTER_POS,
    r: ROOSTER_HIT_RADIUS,
  };
  if (model.errorMessage !== null) {
    const error: FaceHit = {
      part: 'error',
      title: ERROR_TITLE,
      text: model.errorMessage,
      x: g.cx,
      y: g.cy,
      r: g.radius,
    };
    return [plaqueHit(model), error];
  }
  return [
    procession,
    rooster,
    plaqueHit(model),
    ...dialHits(model, g, distances),
    ...figureHits(model),
    ...calendarHits(model, g),
  ];
}
