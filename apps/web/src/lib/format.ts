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

const MS_PER_MINUTE = 60_000;

/** `HH:MM ZZZ` in the given IANA zone (default: the browser's), e.g. `06:45 EDT`. */
export function formatLocalClock(at: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ${part('timeZoneName')}`.trim();
}

/** `10:45 UTC · 06:45 EDT`; just the UTC part when the local zone is UTC. */
export function formatDualClock(at: Date, timeZone?: string): string {
  const utc = `${formatClock(at)} UTC`;
  const local = formatLocalClock(at, timeZone);
  return local === utc ? utc : `${utc} · ${local}`;
}

/** Like `formatDualClock` for an ISO timestamp; returns the input when unparsable. */
export function formatIsoDual(iso: string, timeZone?: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : formatDualClock(at, timeZone);
}

/** `12 s ago`, `3 min ago`, `2 h ago` for an elapsed time in ms. */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/** Time until `startMs`: `in 23 min`, `in 2 h 5 min`, `in <1 min`, or `now`. */
export function formatCountdown(startMs: number, nowMs: number): string {
  const remaining = startMs - nowMs;
  if (remaining <= 0) return 'now';
  const minutes = Math.floor(remaining / MS_PER_MINUTE);
  if (minutes < 1) return 'in <1 min';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} min`;
}
