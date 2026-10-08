// SPDX-License-Identifier: Apache-2.0
import type { Alert, Snapshot, Topology } from '@orrery/core';
import type { OrlojFace } from '@orrery/orloj';
import { compareAlerts, firstFocusTarget } from './alerts.js';
import { ApiError, type EnvironmentSummary } from './api.js';
import { formatDate, formatIsoClock } from './format.js';
import { buildUrl, envPath } from './router.js';
import { seedFor } from './seed.js';
import { serializeFocus } from './params.js';

export const FALLBACK_TIER_COLOR = '#6EA8FF';

export type EnvInfo = EnvironmentSummary;

/** What the home page knows about one environment: data, or the reason there is none. */
export interface EnvFeedState {
  topology: Topology | null;
  snapshot: Snapshot | null;
  /** A friendly message when the environment is failing; null when it is healthy. */
  error: string | null;
}

export const EMPTY_FEED: EnvFeedState = { topology: null, snapshot: null, error: null };

/** `promotion.order` from the public config, or null when it is absent or malformed. */
export function promotionOrderOf(promotion: unknown): string[] | null {
  if (typeof promotion !== 'object' || promotion === null) return null;
  const order = (promotion as { order?: unknown }).order;
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) return null;
  return order as string[];
}

/** Environments in promotion order; ones the promotion list omits follow in config order. */
export function orderEnvironments<T extends { id: string }>(
  environments: readonly T[],
  promotionOrder: readonly string[] | null,
): T[] {
  if (!promotionOrder) return [...environments];
  const ranked: T[] = [];
  for (const id of promotionOrder) {
    const match = environments.find((env) => env.id === id);
    if (match && !ranked.includes(match)) ranked.push(match);
  }
  return [...ranked, ...environments.filter((env) => !ranked.includes(env))];
}

/** A short, friendly reason an environment failed to load. */
export function friendlyEnvError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503 || error.code === 'adapter_unavailable') {
      return 'This environment is unavailable right now.';
    }
    if (error.code === 'network_error') return 'Could not reach the server.';
    return error.message;
  }
  return 'This environment could not be loaded.';
}

/** The message for a health status of `error` in `/api/environments`, otherwise null. */
export function healthError(health: unknown): string | null {
  if (typeof health !== 'object' || health === null) return null;
  const { status, message } = health as { status?: unknown; message?: unknown };
  if (status !== 'error') return null;
  return typeof message === 'string' && message !== ''
    ? message
    : 'The data source reports an error.';
}

/** Treats an environment the health check calls failing as failing until it has data. */
export function withHealth(
  feed: EnvFeedState | undefined,
  healthMessage: string | undefined,
): EnvFeedState {
  const base = feed ?? EMPTY_FEED;
  if (base.error !== null || base.snapshot !== null || healthMessage === undefined) return base;
  return { ...base, error: healthMessage };
}

export interface NextEvent {
  title: string;
  /** ISO start time. */
  at: string;
}

/** The earliest planned window that starts after `now`, or null when none is left today. */
export function nextEvent(snapshot: Snapshot, now: Date): NextEvent | null {
  const nowMs = now.getTime();
  let best: { title: string; startMs: number; id: string; at: string } | null = null;
  for (const window of snapshot.schedule) {
    const startMs = Date.parse(window.start);
    if (Number.isNaN(startMs) || startMs <= nowMs) continue;
    const isEarlier =
      !best || startMs < best.startMs || (startMs === best.startMs && window.id < best.id);
    if (isEarlier) best = { title: window.title, startMs, id: window.id, at: window.start };
  }
  return best ? { title: best.title, at: best.at } : null;
}

export interface GlanceRow {
  env: EnvInfo;
  /** True until the environment has either data or an error. */
  isLoading: boolean;
  error: string | null;
  openIncidents: number | null;
  spokesPastTarget: number | null;
  spokeCount: number | null;
  /** 0 to 1. */
  backlog: number | null;
  next: NextEvent | null;
}

/** One row of the environments-at-a-glance table; a failing environment keeps only its error. */
export function buildGlanceRow(env: EnvInfo, feed: EnvFeedState, now: Date): GlanceRow {
  const { snapshot, error } = feed;
  if (error !== null || !snapshot) {
    return {
      env,
      isLoading: error === null,
      error,
      openIncidents: null,
      spokesPastTarget: null,
      spokeCount: null,
      backlog: null,
      next: null,
    };
  }
  return {
    env,
    isLoading: false,
    error: null,
    openIncidents: snapshot.counts.openIncidents,
    spokesPastTarget: snapshot.counts.spokesPastTarget,
    spokeCount: snapshot.spokes.length,
    backlog: snapshot.backlog,
    next: nextEvent(snapshot, now),
  };
}

export interface HomeAlert {
  /** Unique across environments. */
  key: string;
  env: EnvInfo;
  alert: Alert;
  /** In-app link to the system view at the alert's moment, focused on its first target. */
  href: string;
}

/** `/env/:id?focus=<first target>&t=<HH:MM>`, plus `date` when the alert is from another day. */
export function alertHref(envId: string, alert: Alert, snapshotAt: Date): string {
  const opened = new Date(alert.openedAt);
  const query: Record<string, string> = {};
  const focus = serializeFocus(firstFocusTarget(alert));
  if (focus) query.focus = focus;
  if (!Number.isNaN(opened.getTime())) {
    query.t = formatIsoClock(alert.openedAt);
    if (formatDate(opened) !== formatDate(snapshotAt)) query.date = formatDate(opened);
  }
  return buildUrl(envPath(envId), query);
}

/** Open alerts of every environment, most severe first, then newest, then promotion order. */
export function aggregateAlerts(
  environments: readonly EnvInfo[],
  feeds: Readonly<Record<string, EnvFeedState | undefined>>,
): HomeAlert[] {
  const items: { item: HomeAlert; rank: number }[] = [];
  environments.forEach((env, rank) => {
    const snapshot = feeds[env.id]?.snapshot;
    if (!snapshot) return;
    const at = new Date(snapshot.at);
    for (const alert of snapshot.alerts) {
      items.push({
        item: { key: `${env.id}:${alert.id}`, env, alert, href: alertHref(env.id, alert, at) },
        rank,
      });
    }
  });
  items.sort((a, b) => compareAlerts(a.item.alert, b.item.alert) || a.rank - b.rank);
  return items.map((entry) => entry.item);
}

/** Open alerts of one environment, sorted like the home list. */
export function alertsFor(alerts: readonly HomeAlert[], envId: string): HomeAlert[] {
  return alerts.filter((item) => item.env.id === envId);
}

/** The face for one environment; a failing environment gets an error face. */
export function buildFace(
  env: EnvInfo,
  feed: EnvFeedState,
  tierColors: Readonly<Record<string, string>>,
): OrlojFace {
  return {
    env: { id: env.id, name: env.name, tier: env.tier },
    tierColor: tierColors[env.tier] ?? FALLBACK_TIER_COLOR,
    seed: seedFor(env.id),
    topology: feed.topology,
    snapshot: feed.snapshot,
    ...(feed.error !== null ? { error: feed.error } : {}),
  };
}

/** True once every environment has either data or an error, i.e. the first load is over. */
export function isFirstLoadDone(
  environments: readonly EnvInfo[],
  feeds: Readonly<Record<string, EnvFeedState | undefined>>,
): boolean {
  return environments.every((env) => {
    const feed = feeds[env.id];
    return feed !== undefined && (feed.snapshot !== null || feed.error !== null);
  });
}
