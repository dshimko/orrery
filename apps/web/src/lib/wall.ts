// SPDX-License-Identifier: Apache-2.0
import type { Alert } from '@orrery/core';
import { buildUrl, envPath, type Query, withWall } from './router.js';

/** Seconds spent on each stop of the wall display cycle. */
export const WALL_DWELL_SECONDS = 20;
/** An environment with an open warning or incident is shown for at most this many dwells. */
export const WALL_MAX_HOLD_STOPS = 3;
/** Any key or pointer input pauses the cycle for this long. */
export const WALL_INPUT_PAUSE_SECONDS = 60;

export type WallStop = { kind: 'home' } | { kind: 'env'; id: string };

/** The cycle: home, then each environment in promotion order, then home again. */
export function wallStops(envIds: readonly string[]): WallStop[] {
  return [{ kind: 'home' }, ...envIds.map((id): WallStop => ({ kind: 'env', id }))];
}

export function sameStop(a: WallStop, b: WallStop): boolean {
  return a.kind === 'home' ? b.kind === 'home' : b.kind === 'env' && a.id === b.id;
}

/** The URL of a stop with `wall=1` kept so the cycle continues. */
export function wallUrl(stop: WallStop, query: Query = {}): string {
  const path = stop.kind === 'home' ? '/' : envPath(stop.id);
  return buildUrl(path, withWall(query, true));
}

/** True when an alert list holds a warning or an incident (info does not hold the cycle). */
export function needsAttention(alerts: readonly Alert[]): boolean {
  return alerts.some((alert) => alert.severity !== 'info');
}

export interface WallState {
  index: number;
  /** When the current dwell began. */
  dwellStartMs: number;
  /** Dwells spent on the current stop, 1 for the first. */
  dwells: number;
  /** 0 when running; otherwise the time the input pause ends. */
  pausedUntilMs: number;
}

export function startWall(nowMs: number, index = 0): WallState {
  return { index, dwellStartMs: nowMs, dwells: 1, pausedUntilMs: 0 };
}

/** User input pauses the cycle; the pause restarts on each input. */
export function wallInput(state: WallState, nowMs: number): WallState {
  return { ...state, pausedUntilMs: nowMs + WALL_INPUT_PAUSE_SECONDS * 1000 };
}

export function isWallPaused(state: WallState, nowMs: number): boolean {
  return state.pausedUntilMs > nowMs;
}

export function currentStop(state: WallState, stops: readonly WallStop[]): WallStop | null {
  if (stops.length === 0) return null;
  return stops[state.index % stops.length] ?? null;
}

/** Moves to the stop the user navigated to, restarting the dwell. A no-op when it matches. */
export function syncWall(
  state: WallState,
  stops: readonly WallStop[],
  shown: WallStop | null,
  nowMs: number,
): WallState {
  if (!shown) return state;
  const index = stops.findIndex((stop) => sameStop(stop, shown));
  if (index < 0 || index === state.index % Math.max(1, stops.length)) return state;
  return { ...startWall(nowMs, index), pausedUntilMs: state.pausedUntilMs };
}

/**
 * Advances the cycle. After a dwell it moves to the next stop, unless the stop is an
 * environment with an open warning or incident and fewer than WALL_MAX_HOLD_STOPS dwells have
 * been spent there; then it stays for another dwell. Pure: the caller supplies the time.
 */
export function tickWall(
  state: WallState,
  nowMs: number,
  stops: readonly WallStop[],
  hasAttention: (envId: string) => boolean,
): WallState {
  if (stops.length === 0) return state;
  if (state.pausedUntilMs > 0) {
    if (nowMs < state.pausedUntilMs) return state;
    return { ...state, pausedUntilMs: 0, dwellStartMs: nowMs };
  }
  if (nowMs - state.dwellStartMs < WALL_DWELL_SECONDS * 1000) return state;
  const stop = currentStop(state, stops);
  const isHeld =
    stop?.kind === 'env' && state.dwells < WALL_MAX_HOLD_STOPS && hasAttention(stop.id);
  if (isHeld) return { ...state, dwells: state.dwells + 1, dwellStartMs: nowMs };
  return startWall(nowMs, (state.index + 1) % stops.length);
}
