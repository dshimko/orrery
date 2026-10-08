// SPDX-License-Identifier: Apache-2.0
// Time constants and window helpers shared by polling, discovery, and conversion.

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export interface TimeWindow {
  since: Date;
  until: Date;
}

/** Rounds `ms` down to a multiple of `intervalMs`, so repeated polls share cache entries. */
export function floorTo(ms: number, intervalMs: number): number {
  return Math.floor(ms / intervalMs) * intervalMs;
}

/** Rounds `ms` up to a multiple of `intervalMs`. */
export function ceilTo(ms: number, intervalMs: number): number {
  return Math.ceil(ms / intervalMs) * intervalMs;
}

/** Widens a window outward to multiples of `intervalMs` (floor `since`, ceil `until`). */
export function snapOutward(window: TimeWindow, intervalMs: number): TimeWindow {
  return {
    since: new Date(floorTo(window.since.getTime(), intervalMs)),
    until: new Date(ceilTo(window.until.getTime(), intervalMs)),
  };
}

/** A window of `lookbackMs` ending at `atMs`, both edges snapped down to `intervalMs`. */
export function windowEndingAt(atMs: number, lookbackMs: number, intervalMs: number): TimeWindow {
  const until = floorTo(atMs, intervalMs);
  return { since: new Date(until - lookbackMs), until: new Date(until) };
}

/** Start of the UTC day containing `ms`. */
export function utcDayStart(ms: number): number {
  return floorTo(ms, MS_PER_DAY);
}

/**
 * Parses a Statement API timestamp. Values without a zone are UTC (system tables are UTC).
 * Returns undefined for null or unparsable input.
 */
export function parseTimestamp(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const ms = Date.parse(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? undefined : ms;
}
