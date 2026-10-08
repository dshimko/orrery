// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from 'react';
import type { Api } from '../lib/api.js';
import { currentClock, linkStart } from '../lib/shared-clock.js';
import {
  currentStop,
  needsAttention,
  sameStop,
  startWall,
  syncWall,
  tickWall,
  type WallState,
  type WallStop,
  wallInput,
} from '../lib/wall.js';

const WALL_TICK_MS = 1000;
/** How often the wall display re-checks which environments have an open warning or incident. */
export const WALL_ATTENTION_POLL_MS = 15_000;

export interface WallCycleOptions {
  stops: readonly WallStop[];
  /** The stop on screen now, or null when the page is not part of the cycle. */
  shown: WallStop | null;
  hasAttention: (envId: string) => boolean;
  onGo: (stop: WallStop) => void;
  onExit: () => void;
}

/** Runs the wall display cycle: a 1 s tick over the pure scheduler plus input listeners. */
export function useWallCycle(options: WallCycleOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef<WallState | null>(null);
  const shownKey = options.shown ? (options.shown.kind === 'home' ? '/' : options.shown.id) : '';

  // Follow the user when they navigate away from the cycle's current stop.
  useEffect(() => {
    const { stops, shown } = latest.current;
    const now = Date.now();
    if (state.current) {
      state.current = syncWall(state.current, stops, shown, now);
      return;
    }
    const index = shown ? stops.findIndex((stop) => sameStop(stop, shown)) : -1;
    state.current = startWall(now, Math.max(0, index));
  }, [shownKey, options.stops.length]);

  useEffect(() => {
    const interval = setInterval(() => {
      const current = state.current;
      if (!current) return;
      const { stops, hasAttention, onGo } = latest.current;
      const next = tickWall(current, Date.now(), stops, hasAttention);
      state.current = next;
      if (next.index !== current.index) {
        const stop = currentStop(next, stops);
        if (stop) onGo(stop);
      }
    }, WALL_TICK_MS);

    const onInput = (event: Event): void => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') {
        latest.current.onExit();
        return;
      }
      if (state.current) state.current = wallInput(state.current, Date.now());
    };
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, onInput, { passive: true });
    return () => {
      clearInterval(interval);
      for (const name of events) window.removeEventListener(name, onInput);
    };
  }, []);
}

/**
 * Which environments currently have an open warning or incident, polled at a low rate from the
 * shared clock's time. The wall display uses it to hold on an environment that needs attention.
 */
export function useWallAttention(api: Api, envIds: readonly string[]): (envId: string) => boolean {
  const attention = useRef<ReadonlySet<string>>(new Set());
  const key = envIds.join(',');

  useEffect(() => {
    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      const at =
        currentClock()?.state().at ??
        linkStart({ minuteOfDay: null, date: null, speed: null, paused: false, replay: false });
      const results = await Promise.allSettled(
        envIds.map((id) => api.snapshot(id, at, controller.signal)),
      );
      if (controller.signal.aborted) return;
      const flagged = new Set<string>();
      results.forEach((result, index) => {
        const id = envIds[index];
        if (
          id !== undefined &&
          result.status === 'fulfilled' &&
          needsAttention(result.value.alerts)
        ) {
          flagged.add(id);
        }
      });
      attention.current = flagged;
    };
    void poll();
    const interval = setInterval(() => void poll(), WALL_ATTENTION_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
    // `envIds` is identified by `key`.
  }, [api, key]);

  return (envId) => attention.current.has(envId);
}
