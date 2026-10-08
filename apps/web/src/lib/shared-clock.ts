// SPDX-License-Identifier: Apache-2.0
import type { DeepLink } from './params.js';
import { DEFAULT_START_MINUTE, parseDate, startOfDayAt } from './params.js';
import { createTimeController, type TimeController } from './time.js';

/** The clock parameters of a deep link. */
export type ClockLink = Pick<DeepLink, 'minuteOfDay' | 'date' | 'speed' | 'paused' | 'replay'>;

export interface ClockSettings {
  secondsPerSimDay: number;
  speeds: readonly number[];
  /** Start paused, e.g. for users who prefer reduced motion. */
  startPaused: boolean;
}

let shared: TimeController | null = null;

/** True when the link pins the clock (replay), which makes a page start a fresh one. */
export function hasExplicitClock(link: ClockLink): boolean {
  return (
    link.minuteOfDay !== null ||
    link.date !== null ||
    link.speed !== null ||
    link.paused ||
    link.replay
  );
}

/**
 * The replay start a link asks for: its date (or today) at its time. A date without a time
 * starts at the default minute; `mode=replay` alone starts at the current instant.
 */
export function linkStart(link: ClockLink, now: Date = new Date()): Date {
  if (link.minuteOfDay === null && link.date === null) return now;
  const day = (link.date !== null ? parseDate(link.date) : null) ?? now;
  return startOfDayAt(day, link.minuteOfDay ?? DEFAULT_START_MINUTE);
}

/**
 * Where a page starts: the shared clock's current time when the link does not pin one, so
 * home, system view, and compare keep one simulated time while the user moves between them.
 */
export function sharedClockStart(link: ClockLink, now: Date = new Date()): Date {
  if (shared && !hasExplicitClock(link)) return shared.state().at;
  return linkStart(link, now);
}

/**
 * The clock for a page: the shared one when the link does not pin it, otherwise a new one.
 * Pure with respect to the store; call `publishClock` from an effect to make it shared.
 */
export function acquireClock(
  link: ClockLink,
  settings: ClockSettings,
  now: Date = new Date(),
): TimeController {
  if (shared && !hasExplicitClock(link)) return shared;
  const replay = hasExplicitClock(link) || settings.startPaused;
  return createTimeController({
    start: linkStart(link, now),
    secondsPerSimDay: settings.secondsPerSimDay,
    speed: link.speed !== null && settings.speeds.includes(link.speed) ? link.speed : 1,
    paused: link.paused || settings.startPaused,
    mode: replay ? 'replay' : 'live',
  });
}

export function publishClock(controller: TimeController): void {
  shared = controller;
}

/** The clock pages currently share, or null before any page has published one. */
export function currentClock(): TimeController | null {
  return shared;
}

/** For tests. */
export function resetSharedClock(): void {
  shared = null;
}
