// SPDX-License-Identifier: Apache-2.0
const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `HH:MM:SS`-free clock text in UTC, e.g. `10:40`. */
export function formatClock(at: Date): string {
  return `${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())}`;
}

/** UTC date as `YYYY-MM-DD`. */
export function formatDate(at: Date): string {
  return `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
}

/** Minutes as `45 min`, `2 h 05 min`, or `3 h`. */
export function formatAge(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return 'unknown';
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${pad2(rest)} min`;
}

/** 0..1 to `73%`, clamped. */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%';
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

const COUNT_FORMAT = new Intl.NumberFormat('en-US');
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(Number.isFinite(value) ? value : 0);
}

/** `ISO` timestamp to `HH:MM` UTC; returns the input when unparsable. */
export function formatIsoClock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : formatClock(at);
}
