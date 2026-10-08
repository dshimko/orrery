// SPDX-License-Identifier: Apache-2.0
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "HH:MM" for a minute count (wrapped into one day). */
export function formatMinute(minute: number): string {
  const m = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad2(Math.floor(m / MINUTES_PER_HOUR))}:${pad2(m % MINUTES_PER_HOUR)}`;
}

/** Fractional minute of the UTC day, including seconds. */
export function minuteOfUtcDay(at: Date): number {
  return at.getUTCHours() * MINUTES_PER_HOUR + at.getUTCMinutes() + at.getUTCSeconds() / 60;
}

/** Compact age text, e.g. "45 min", "3.1 h", "1.5 d". */
export function formatAge(minutes: number): string {
  if (minutes < MINUTES_PER_HOUR) return `${Math.round(minutes)} min`;
  if (minutes < MINUTES_PER_DAY) return `${(minutes / MINUTES_PER_HOUR).toFixed(1)} h`;
  return `${(minutes / MINUTES_PER_DAY).toFixed(1)} d`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
