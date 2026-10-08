// SPDX-License-Identifier: Apache-2.0
import type { TimeState } from '@orrery/render';

export const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
/** Longest frame gap that is simulated; longer gaps (hidden tab) are clamped. */
export const MAX_FRAME_MS = 1000;

export interface TimeControllerOptions {
  start: Date;
  /** Real seconds for 24 simulated hours at 1x (`visuals.time.secondsPerSimDay`). */
  secondsPerSimDay: number;
  speed?: number;
  paused?: boolean;
}

/** Holds simulated time. Pure: advanced only by `advance`, never reads a clock. */
export interface TimeController {
  state(): TimeState;
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
  let atMs = options.start.getTime();
  let speed = options.speed ?? 1;
  let paused = options.paused ?? false;

  const state = (): TimeState => ({ at: new Date(atMs), speed, paused });

  return {
    state,
    advance(deltaMs) {
      if (!paused && deltaMs > 0) atMs += Math.min(deltaMs, MAX_FRAME_MS) * simMsPerRealMs * speed;
      return state();
    },
    setSpeed(next) {
      if (next > 0 && Number.isFinite(next)) speed = next;
    },
    setPaused(next) {
      paused = next;
    },
    seekMinute(minute) {
      const clamped = Math.min(MINUTES_PER_DAY - 1, Math.max(0, minute));
      const dayStart = Math.floor(atMs / (MINUTES_PER_DAY * MS_PER_MINUTE)) * MINUTES_PER_DAY;
      atMs = (dayStart + clamped) * MS_PER_MINUTE;
      return state();
    },
  };
}
