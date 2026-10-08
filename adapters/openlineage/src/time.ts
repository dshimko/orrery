// SPDX-License-Identifier: Apache-2.0
// Time constants and window helpers.

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** A half-open window `[since, until)`. */
export interface TimeWindow {
  since: Date;
  until: Date;
}

export function utcDayStart(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}
