// SPDX-License-Identifier: Apache-2.0
import type { TimeState } from '@orrery/render';
import { useEffect, useState } from 'react';
import type { TimeController } from '../lib/time.js';

/** Real-time interval for DOM clock updates: 4 Hz (spec: DOM text updates at most 4x/s). */
export const CLOCK_DOM_INTERVAL_MS = 250;

/**
 * Advances the controller each animation frame and returns its state at 4 Hz.
 * `refresh` forces an immediate state read after a user action.
 */
export function useSimClock(controller: TimeController): { time: TimeState; refresh: () => void } {
  const [time, setTime] = useState<TimeState>(() => controller.state());

  useEffect(() => {
    let frame = 0;
    let last: number | null = null;
    const loop = (now: number): void => {
      if (last !== null) controller.advance(now - last);
      last = now;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const interval = setInterval(() => {
      setTime(controller.state());
    }, CLOCK_DOM_INTERVAL_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
    };
  }, [controller]);

  return { time, refresh: () => setTime(controller.state()) };
}
