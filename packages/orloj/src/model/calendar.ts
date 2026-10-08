// SPDX-License-Identifier: Apache-2.0
import type { Snapshot } from '@orrery/core';
import type { CalendarModel } from './types.js';

const FULL_TURN = Math.PI * 2;
const START_ANGLE = -Math.PI / 2;

/** The calendar day to highlight: the date of `at` when the month matches, else the last past day. */
function todayOf(calendar: Snapshot['calendar'], at: Date): number {
  if (at.getUTCFullYear() === calendar.year && at.getUTCMonth() + 1 === calendar.month) {
    return at.getUTCDate();
  }
  return calendar.days.reduce((last, d) => (d.isPast ? Math.max(last, d.day) : last), 0);
}

export function buildCalendar(
  snapshot: Snapshot,
  at: Date,
  nextText: string,
): CalendarModel | null {
  const { calendar } = snapshot;
  const count = calendar.days.length;
  if (count === 0) return null;
  const today = todayOf(calendar, at);
  const days = calendar.days.map((d, i) => {
    const startAngle = START_ANGLE + (i / count) * FULL_TURN;
    const endAngle = START_ANGLE + ((i + 1) / count) * FULL_TURN;
    return {
      day: d.day,
      releases: d.releases,
      promotion: d.promotion,
      monthEndClose: d.monthEndClose,
      isPast: d.isPast,
      isToday: d.day === today,
      startAngle,
      endAngle,
      midAngle: (startAngle + endAngle) / 2,
    };
  });
  const past = days.filter((d) => d.isPast);
  return {
    days,
    today,
    totalReleases: past.reduce((sum, d) => sum + d.releases, 0),
    totalPromotions: past.filter((d) => d.promotion).length,
    nextText,
  };
}
