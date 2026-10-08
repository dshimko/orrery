// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { acquireClock, type ClockLink, publishClock } from '../lib/shared-clock.js';
import type { TimeController } from '../lib/time.js';

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The time controller every page shares; see `lib/shared-clock.ts`. */
export function useSharedClock(
  link: ClockLink,
  time: { secondsPerSimDay: number; speeds: readonly number[] },
): TimeController {
  const [controller] = useState(() =>
    acquireClock(link, { ...time, startPaused: prefersReducedMotion() }),
  );
  useEffect(() => {
    publishClock(controller);
  }, [controller]);
  return controller;
}
