// SPDX-License-Identifier: Apache-2.0
import type { CameraViewKey, PickTarget, TierFilter } from '@orrery/render';
import type { Query } from './router.js';

/**
 * Deep-link parameters of the system view:
 * `t=HH:MM` UTC time of day, `speed`, `tier`, `workload`, `focus=kind:id` (spoke, site, useCase,
 * foreign) or `focus=hub` / `focus=shipyard`, `view=<camera view key>`, `date=YYYY-MM-DD`, and
 * `paused=1`. Invalid values are ignored.
 */
export interface DeepLink {
  /** Minutes since 00:00 UTC. */
  minuteOfDay: number | null;
  speed: number | null;
  tier: TierFilter;
  workload: string;
  focus: PickTarget | null;
  /** Camera preset to start from; `focus` takes precedence when both are given. */
  view: CameraViewKey | null;
  /** UTC date to show (`date=YYYY-MM-DD`); null means today. */
  date: string | null;
  /** Start paused (`paused=1`), e.g. for reproducible screenshots. */
  paused: boolean;
  /**
   * `mode=replay` asks for replay even without other time params. Any of `t`, `date`, `speed`,
   * or `paused` also implies replay; with none of them, pages follow the wall clock (live).
   */
  replay: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Parses `YYYY-MM-DD` into a UTC midnight, or null when absent or invalid. */
export function parseDate(text: string | undefined): Date | null {
  if (text === undefined || !DATE_PATTERN.test(text)) return null;
  const at = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== text ? null : at;
}

export const DEFAULT_START_MINUTE = 10 * 60 + 40;
export const TIERS: readonly TierFilter[] = ['all', 'bronze', 'silver', 'gold', 'use'];
export const CAMERA_VIEW_KEYS: readonly CameraViewKey[] = [
  'over',
  'belt',
  'ingest',
  'earth',
  'planets',
  'stations',
  'yard',
];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WORKLOAD_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FOCUS_KINDS = ['spoke', 'site', 'useCase', 'foreign'] as const;

export function parseTimeOfDay(text: string | undefined): number | null {
  const match = text === undefined ? null : TIME_PATTERN.exec(text);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatTimeOfDay(minuteOfDay: number): string {
  const whole = Math.min(1439, Math.max(0, Math.floor(minuteOfDay)));
  const hh = String(Math.floor(whole / 60)).padStart(2, '0');
  const mm = String(whole % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function parseFocus(text: string | undefined): PickTarget | null {
  if (text === undefined) return null;
  if (text === 'hub' || text === 'shipyard') return { kind: text };
  const separator = text.indexOf(':');
  if (separator < 0) return null;
  const kind = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (!WORKLOAD_PATTERN.test(id)) return null;
  const known = FOCUS_KINDS.find((candidate) => candidate === kind);
  return known ? { kind: known, id } : null;
}

export function serializeFocus(target: PickTarget | null): string {
  if (!target) return '';
  return 'id' in target ? `${target.kind}:${target.id}` : target.kind;
}

export function parseDeepLink(query: Query): DeepLink {
  const speed = Number(query.speed);
  const tier = TIERS.find((candidate) => candidate === query.tier);
  const workload = query.workload;
  return {
    minuteOfDay: parseTimeOfDay(query.t),
    speed: query.speed !== undefined && Number.isFinite(speed) && speed > 0 ? speed : null,
    tier: tier ?? 'all',
    workload: workload !== undefined && WORKLOAD_PATTERN.test(workload) ? workload : 'all',
    focus: parseFocus(query.focus),
    view: CAMERA_VIEW_KEYS.find((candidate) => candidate === query.view) ?? null,
    date: parseDate(query.date) ? (query.date ?? null) : null,
    paused: query.paused === '1',
    replay: query.mode === 'replay',
  };
}

/** Today's UTC date at the given minute of day. */
export function startOfDayAt(now: Date, minuteOfDay: number): Date {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(day + minuteOfDay * 60_000);
}

/** The query for a deep link, omitting defaults. */
export function toQuery(link: Partial<DeepLink>): Query {
  const query: Record<string, string> = {};
  if (link.minuteOfDay != null) query.t = formatTimeOfDay(link.minuteOfDay);
  if (link.speed != null && link.speed !== 1) query.speed = String(link.speed);
  if (link.tier && link.tier !== 'all') query.tier = link.tier;
  if (link.workload && link.workload !== 'all') query.workload = link.workload;
  const focus = serializeFocus(link.focus ?? null);
  if (focus) query.focus = focus;
  if (link.view) query.view = link.view;
  if (link.date) query.date = link.date;
  if (link.paused) query.paused = '1';
  // Replay with nothing else pinned still needs a marker, or the link would open live.
  const pinsTime =
    link.minuteOfDay != null ||
    link.date ||
    link.paused ||
    (link.speed != null && link.speed !== 1);
  if (link.replay && !pinsTime) query.mode = 'replay';
  return query;
}
