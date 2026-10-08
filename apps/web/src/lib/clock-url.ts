// SPDX-License-Identifier: Apache-2.0
import type { TimeState } from '@orrery/render';
import { formatDate } from './format.js';
import type { DeepLink } from './params.js';
import { toQuery } from './params.js';
import { buildUrl, type Query, withWall } from './router.js';
import { minuteOfDay } from './time.js';

/** What the URL pins while the clock is running: the link's time or the last scrub. */
export interface PinnedClock {
  minuteOfDay: number | null;
  date: string | null;
}

/**
 * The clock part of a page URL. A paused clock always writes its exact time and date so the
 * link reproduces the frame; a running clock only writes what the user pinned.
 */
export function clockLink(
  time: TimeState,
  pinned: PinnedClock,
): Pick<DeepLink, 'minuteOfDay' | 'date' | 'speed' | 'paused'> {
  if (time.paused) {
    return {
      minuteOfDay: Math.floor(minuteOfDay(time.at)),
      date: formatDate(time.at),
      speed: time.speed,
      paused: true,
    };
  }
  return { ...pinned, speed: time.speed, paused: false };
}

/** The full page URL for a path, a clock, other deep-link fields, and wall mode. */
export function pageUrl(
  path: string,
  clock: Pick<DeepLink, 'minuteOfDay' | 'date' | 'speed' | 'paused'>,
  extra: Query,
  wall: boolean,
  rest: Partial<DeepLink> = {},
): string {
  return buildUrl(path, withWall({ ...toQuery({ ...clock, ...rest }), ...extra }, wall));
}
