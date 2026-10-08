// SPDX-License-Identifier: Apache-2.0
// Browser-local renderings of UTC clock times for tooltips. The dial itself stays UTC.
import { ORLOJ_STRINGS } from '../strings.js';
import { MS_PER_DAY, MS_PER_MINUTE, formatMinute } from './format.js';

/** Where local times are computed: the anchor instant (for DST) and an IANA zone. */
export interface LocalTimeContext {
  at: Date;
  timeZone: string;
}

interface LocalClock {
  time: string;
  zone: string;
}

function localClock(minute: number, context: LocalTimeContext): LocalClock | null {
  const dayStart = Math.floor(context.at.getTime() / MS_PER_DAY) * MS_PER_DAY;
  const instant = new Date(dayStart + Math.round(minute) * MS_PER_MINUTE);
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: context.timeZone,
      timeZoneName: 'short',
    }).formatToParts(instant);
    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return { time: `${part('hour')}:${part('minute')}`, zone: part('timeZoneName') };
  } catch {
    // An unknown zone name must not break tooltips; they fall back to UTC only.
    return null;
  }
}

/** "06:30 EDT" or "06:30-08:30 EDT"; empty when local equals UTC or the zone is unusable. */
function localRange(start: number, end: number | undefined, context: LocalTimeContext): string {
  const from = localClock(start, context);
  const to = end === undefined ? from : localClock(end, context);
  if (!from || !to) return '';
  const isSameAsUtc = from.time === formatMinute(start) && to.time === formatMinute(end ?? start);
  if (isSameAsUtc) return '';
  if (end === undefined) return `${from.time} ${from.zone}`;
  return from.zone === to.zone
    ? `${from.time}–${to.time} ${to.zone}`
    : `${from.time} ${from.zone}–${to.time} ${to.zone}`;
}

/**
 * "10:30 UTC (06:30 EDT)" for one time, or "10:30–12:30 UTC (06:30–08:30 EDT)" for a range.
 * Without a context, or when the local zone shows the same clock as UTC, it is UTC only.
 */
export function utcWithLocal(
  start: number,
  end: number | undefined,
  context: LocalTimeContext | undefined,
  utcWord: string = ORLOJ_STRINGS.model.utc,
): string {
  const utc =
    end === undefined
      ? `${formatMinute(start)} ${utcWord}`
      : `${formatMinute(start)}–${formatMinute(end)} ${utcWord}`;
  const local = context ? localRange(start, end, context) : '';
  return local === '' ? utc : `${utc} (${local})`;
}

/** Replaces the first "HH:MM UTC" token for `minute` in model text with its local-aware form. */
export function localizeUtcText(
  text: string,
  minute: number,
  context: LocalTimeContext | undefined,
  utcWord: string = ORLOJ_STRINGS.model.utc,
): string {
  if (!context) return text;
  return text.replace(
    `${formatMinute(minute)} ${utcWord}`,
    utcWithLocal(minute, undefined, context, utcWord),
  );
}
