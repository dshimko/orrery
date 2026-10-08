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
  CONSUMERS_POS,
  FRESHNESS_POS,
  SPEND_POS,
  NICHE_HIT_RADIUS,
  PLAQUE,
  PLAQUE_HIT_RADIUS,
  PROCESSION_HIT,
  PROCESSION_HIT_RADIUS,
  ROOSTER_HIT_RADIUS,
  ROOSTER_POS,
  INCIDENTS_POS,
} from '../constants.js';
import type { SnapshotPart } from '@orrery/core';
import { ORLOJ_STRINGS, fill, unavailableReason } from '../strings.js';
import type { OrlojPart, OrlojStrings } from '../types.js';
import { formatAge } from './format.js';
import { localizeUtcText, utcWithLocal, type LocalTimeContext } from './local-time.js';
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

/** Distance of each spoke from the hub, by id; spokes absent here use their model target. */
export type SpokeDistances = ReadonlyMap<string, number>;

function polar(g: Geometry, angle: number, radius: number): { x: number; y: number } {
  return { x: g.cx + Math.cos(angle) * radius, y: g.cy + Math.sin(angle) * radius };
}

const trimPeriod = (value: string): string => value.replace(/\.+$/, '');

/** Tooltip body: what the part is, its current value or why it has none, and the click action. */
function tip(strings: OrlojStrings, part: OrlojPart, value: string, reason?: string): string {
  const definition = strings.parts[part].definition;
  return reason === undefined
    ? fill(strings.tooltipWithValue, { definition, value: trimPeriod(value) })
    : fill(strings.tooltipWithReason, { definition, reason });
}

function reasonOf(
  model: FaceModel,
  source: SnapshotPart,
  strings: OrlojStrings,
): string | undefined {
  return unavailableReason(model.unavailable, source, strings);
}

function spokeHit(g: Geometry, s: SpokeModel, distance: number, strings: OrlojStrings): FaceHit {
  const { x, y } = polar(g, s.angle, distance);
  const h = strings.hit;
  const value = fill(h.spokeValue, {
    age: formatAge(s.ageMinutes, strings),
    target: formatAge(s.targetMinutes, strings),
    pastTarget: s.pastTarget ? h.spokePastTarget : '',
    pipelines: s.pipelines,
    products: s.products,
    secondary: s.isSecondaryMetastore ? h.spokeSecondary : '',
  });
  return {
    part: `spoke:${s.id}`,
    title: fill(h.spokeTitle, { name: s.name, suffix: s.isIngest ? h.spokeIngestSuffix : '' }),
    text: tip(strings, 'spokes', value),
    x,
    y,
    r: s.size + HIT_R.spokePad,
  };
}

function plaqueHit(model: FaceModel, strings: OrlojStrings): FaceHit {
  const { plaqueDefinition, plaqueValue } = strings.hit;
  return {
    part: 'plaque',
    title: model.name,
    text: fill(strings.tooltipWithValue, {
      definition: plaqueDefinition,
      value: fill(plaqueValue, { tier: model.tier }),
    }),
    x: (PLAQUE.x0 + PLAQUE.x1) / 2,
    y: (PLAQUE.y0 + PLAQUE.y1) / 2,
    r: PLAQUE_HIT_RADIUS,
  };
}

function incidentValue(model: FaceModel, strings: OrlojStrings): string {
  const f = model.figures;
  if (f.openIncidents <= 0) return strings.hit.incidentsNone;
  return f.incidentTitles.length > 0
    ? f.incidentTitles.join('; ')
    : fill(strings.hit.incidentsCount, { count: f.openIncidents });
}

function figureHits(model: FaceModel, strings: OrlojStrings): FaceHit[] {
  const f = model.figures;
  const h = strings.hit;
  const spendReason = reasonOf(model, 'spend', strings);
  const consumersReason = reasonOf(model, 'consumers', strings);
  return [
    {
      part: 'spend',
      title: h.spendTitle,
      text: tip(strings, 'spend', fill(h.spendValue, { spend: f.spend }), spendReason),
      ...SPEND_POS,
      r: NICHE_HIT_RADIUS,
    },
    {
      part: 'freshness',
      title: h.freshnessTitle,
      text: tip(
        strings,
        'freshness',
        fill(h.freshnessValue, { late: f.spokesPastTarget, total: f.spokeCount }),
      ),
      ...FRESHNESS_POS,
      r: NICHE_HIT_RADIUS,
    },
    {
      part: 'incidents',
      title: h.incidentsTitle,
      text: tip(strings, 'incidents', incidentValue(model, strings)),
      ...INCIDENTS_POS,
      r: NICHE_HIT_RADIUS,
    },
    {
      part: 'consumers',
      title: h.consumersTitle,
      text: tip(
        strings,
        'consumers',
        fill(h.consumersValue, { percent: Math.round(f.consumerActivity * 100) }),
        consumersReason,
      ),
      ...CONSUMERS_POS,
      r: NICHE_HIT_RADIUS,
    },
  ];
}

function calendarHits(model: FaceModel, g: Geometry, strings: OrlojStrings): FaceHit[] {
  const cal = model.calendar;
  if (!cal) return [];
  const h = strings.hit;
  const reason = reasonOf(model, 'calendar', strings);
  const summary: FaceHit = {
    part: 'calendar',
    title: h.calendarTitle,
    text: tip(
      strings,
      'calendar',
      fill(h.calendarValue, { releases: cal.totalReleases, promotions: cal.totalPromotions }),
      reason,
    ),
    x: g.calCx,
    y: g.calCy,
    r: CALENDAR_HIT_RADIUS,
  };
  if (reason !== undefined) return [summary];
  const dayHits = cal.days.map((d) => ({
    part: `calendar-day:${d.day}`,
    title: fill(h.dayTitle, { day: d.day, today: d.isToday ? h.dayToday : '' }),
    text: `${d.isPast ? fill(h.dayPast, { releases: d.releases }) : h.dayPlanned}${d.promotion ? h.dayPromotion : ''}${d.monthEndClose ? h.dayMonthEnd : '.'}`,
    x: g.calCx + Math.cos(d.midAngle) * (g.calRadius - CALENDAR_DAY_INSET),
    y: g.calCy + Math.sin(d.midAngle) * (g.calRadius - CALENDAR_DAY_INSET),
    r: HIT_R.day,
  }));
  return [...dayHits, summary];
}

function dialHits(
  model: FaceModel,
  g: Geometry,
  distances: SpokeDistances,
  local: LocalTimeContext | undefined,
  strings: OrlojStrings,
): FaceHit[] {
  const R = g.radius;
  const skyR = R - SKY_INSET;
  const h = strings.hit;
  const scheduleReason = reasonOf(model, 'schedule', strings);
  const hits: FaceHit[] = [];
  for (const a of model.arcs) {
    const value = `${a.text} ${utcWithLocal(a.startMinute, a.endMinute, local, strings.model.utc)}`;
    hits.push({
      part: `arc:${a.id}`,
      title: a.title,
      text: tip(strings, 'arcs', value, scheduleReason),
      ...polar(g, a.midAngle, R - ARC_INSET),
      r: HIT_R.arc,
    });
  }
  for (const t of model.ticks) {
    hits.push({
      part: `tick:${t.id}`,
      title: t.title,
      text: localizeUtcText(t.text, t.minute, local, strings.model.utc),
      ...polar(g, t.angle, R - TICK_INSET),
      r: HIT_R.tick,
    });
  }
  for (const n of model.noonSuns) {
    hits.push({
      part: `noon:${n.key}`,
      title: fill(h.noonTitle, { name: n.name }),
      text: tip(strings, 'noon-suns', fill(h.noonValue, { text: n.text })),
      ...polar(g, n.angle, skyR + NOON_MARK_OFFSET),
      r: HIT_R.noon,
    });
  }
  hits.push({
    part: 'hub',
    title: fill(h.hubTitle, { name: model.hubName }),
    text: fill(h.hubText, { env: model.name.toLowerCase(), products: model.products }),
    x: g.cx,
    y: g.cy,
    r: HUB_RADIUS,
  });
  for (const s of model.spokes) {
    hits.push(spokeHit(g, s, distances.get(s.id) ?? s.distance, strings));
  }
  hits.push({
    part: 'moon',
    title: h.moonTitle,
    text: tip(
      strings,
      'moon',
      fill(h.moonValue, { percent: Math.round(model.moon.phase * 100) }),
      reasonOf(model, 'backlog', strings),
    ),
    ...polar(g, model.moon.angle, skyR * MOON_ORBIT_SHARE),
    r: MOON_RADIUS + 2,
  });
  if (model.star) {
    const label = localizeUtcText(model.star.label, model.star.minute, local, strings.model.utc);
    hits.push({
      part: 'star-hand',
      title: h.starHandTitle,
      text: tip(strings, 'star-hand', fill(h.starHandValue, { label }), scheduleReason),
      ...polar(g, model.star.angle, R - STAR_HAND_INSET),
      r: HIT_R.star,
    });
  }
  hits.push({
    part: 'sun-hand',
    title: h.sunHandTitle,
    text: tip(
      strings,
      'sun-hand',
      fill(h.sunHandValue, {
        time: utcWithLocal(model.minuteOfDay, undefined, local, strings.model.utc),
      }),
    ),
    ...polar(g, model.sunAngle, R - SUN_INSET),
    r: HIT_R.sun,
  });
  return hits;
}

function processionHit(model: FaceModel, strings: OrlojStrings): FaceHit {
  const reason = reasonOf(model, 'schedule', strings);
  const value =
    reason === undefined
      ? model.procession.text
      : `${model.procession.text} ${fill(strings.hit.processionRelease, { reason })}`;
  return {
    part: 'procession',
    title: strings.hit.processionTitle,
    text: tip(strings, 'procession', value),
    ...PROCESSION_HIT,
    r: PROCESSION_HIT_RADIUS,
  };
}

function roosterHit(model: FaceModel, strings: OrlojStrings): FaceHit {
  const h = strings.hit;
  return {
    part: 'rooster',
    title: h.roosterTitle,
    text: tip(strings, 'rooster', model.rooster.isCrowing ? h.roosterCrowing : h.roosterQuiet),
    ...ROOSTER_POS,
    r: ROOSTER_HIT_RADIUS,
  };
}

/**
 * Hit regions in face units, in registration order (later entries sit on top). Spoke positions
 * follow the smoothed `distances` so tooltips track the medallions the viewer sees. With a
 * `local` context, clock times in tooltip text gain the viewer's local time. Each region's text
 * is its definition, its current value (or why it has none), and the click action.
 */
export function faceHits(
  model: FaceModel,
  g: Geometry,
  distances: SpokeDistances,
  local?: LocalTimeContext,
  strings: OrlojStrings = ORLOJ_STRINGS,
): FaceHit[] {
  if (model.errorMessage !== null) {
    const error: FaceHit = {
      part: 'error',
      title: strings.hit.errorTitle,
      text: model.errorMessage,
      x: g.cx,
      y: g.cy,
      r: g.radius,
    };
    return [plaqueHit(model, strings), error];
  }
  return [
    processionHit(model, strings),
    roosterHit(model, strings),
    plaqueHit(model, strings),
    ...dialHits(model, g, distances, local, strings),
    ...figureHits(model, strings),
    ...calendarHits(model, g, strings),
  ];
}
