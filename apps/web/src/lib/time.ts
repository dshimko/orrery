// SPDX-License-Identifier: Apache-2.0
import type { TimeState } from '@orrery/render';

export const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
/** Longest frame gap that is simulated; longer gaps (hidden tab) are clamped. */
export const MAX_FRAME_MS = 1000;

export type ClockMode = 'live' | 'replay';

export interface TimeControllerOptions {
  /** Replay start. Ignored in live mode, where time is the wall clock. */
  start: Date;
  /** Real seconds for 24 simulated hours at 1x (`visuals.time.secondsPerSimDay`). */
  secondsPerSimDay: number;
  speed?: number;
  paused?: boolean;
  /** Default 'replay'. In 'live', time is `now()` and speed and pause do not apply. */
  mode?: ClockMode;
  /** Wall clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Holds the shown time. In replay it is simulated time, advanced only by `advance`. In live
 * mode it is the wall clock. Pausing, changing speed, or seeking leaves live mode for replay at
 * the current instant; `goLive` returns.
 */
export interface TimeController {
  state(): TimeState;
  mode(): ClockMode;
  goLive(): TimeState;
  /** Advances by a real-time delta in ms when not paused. Returns the new state. */
  advance(deltaMs: number): TimeState;
  setSpeed(speed: number): void;
  setPaused(paused: boolean): void;
  /** Jumps to a minute of the current UTC day (0 to 1439). */
  seekMinute(minuteOfDay: number): TimeState;
}

export function minuteOfDay(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
}

export function createTimeController(options: TimeControllerOptions): TimeController {
  if (!(options.secondsPerSimDay > 0)) throw new Error('secondsPerSimDay must be positive');
  const simMsPerRealMs = (MINUTES_PER_DAY * MS_PER_MINUTE) / (options.secondsPerSimDay * 1000);
  const now = options.now ?? (() => Date.now());
  let mode: ClockMode = options.mode ?? 'replay';
  let atMs = mode === 'live' ? now() : options.start.getTime();
  let speed = mode === 'live' ? 1 : (options.speed ?? 1);
  let paused = mode === 'live' ? false : (options.paused ?? false);

  const state = (): TimeState => {
    if (mode === 'live') atMs = now();
    return { at: new Date(atMs), speed, paused, live: mode === 'live' };
  };
  /** Freezes the current instant and switches to replay before a replay-only change. */
  const toReplay = (): void => {
    if (mode === 'live') {
      atMs = now();
      mode = 'replay';
    }
  };

  return {
    state,
    mode: () => mode,
    goLive() {
      mode = 'live';
      speed = 1;
      paused = false;
      return state();
    },
    advance(deltaMs) {
      if (mode === 'live') return state();
      if (!paused && deltaMs > 0) atMs += Math.min(deltaMs, MAX_FRAME_MS) * simMsPerRealMs * speed;
      return state();
    },
    setSpeed(next) {
      if (!(next > 0 && Number.isFinite(next))) return;
      if (mode === 'live' && next === 1) return;
      toReplay();
      speed = next;
    },
    setPaused(next) {
      if (mode === 'live' && !next) return;
      toReplay();
      paused = next;
    },
    seekMinute(minute) {
      toReplay();
      const clamped = Math.min(MINUTES_PER_DAY - 1, Math.max(0, minute));
      const dayStart = Math.floor(atMs / (MINUTES_PER_DAY * MS_PER_MINUTE)) * MINUTES_PER_DAY;
      atMs = (dayStart + clamped) * MS_PER_MINUTE;
      return state();
    },
  };
}
