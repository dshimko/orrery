// SPDX-License-Identifier: Apache-2.0
import type { Alert, ScheduledWindow, Snapshot, Visuals } from '@orrery/core';
import { hourAngle } from '../geometry.js';
import { formatMinute, MS_PER_MINUTE } from './format.js';
import { fill } from '../strings.js';
import type { OrlojStrings } from '../types.js';
import type { ArcModel, StarModel, TickModel } from './types.js';

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

/** A schedule window reduced to minutes of the UTC day. */
export interface WindowSpan {
  window: ScheduledWindow;
  startMinute: number;
  durationMinutes: number;
}

/** Parses each window to minutes of its own UTC day; drops windows with invalid timestamps. */
export function windowSpans(schedule: readonly ScheduledWindow[]): WindowSpan[] {
  const spans: WindowSpan[] = [];
  for (const window of schedule) {
    const start = new Date(window.start);
    const end = new Date(window.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const startMinute =
      start.getUTCHours() * MINUTES_PER_HOUR + start.getUTCMinutes() + start.getUTCSeconds() / 60;
    const durationMinutes = Math.max(0, (end.getTime() - start.getTime()) / MS_PER_MINUTE);
    spans.push({ window, startMinute, durationMinutes });
  }
  return spans;
}

function isWithin(span: WindowSpan, minute: number): boolean {
  const delta =
    (((minute - span.startMinute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return delta < span.durationMinutes;
}

function arcText(span: WindowSpan, alerts: readonly Alert[], strings: OrlojStrings): string {
  const { window } = span;
  const alert = alerts.find((a) => a.title === window.title);
  if (alert) return alert.text;
  const t = strings.model;
  const severity = {
    incident: t.severityIncident,
    warning: t.severityWarning,
    info: t.severityPlanned,
  }[window.severity];
  const kind = {
    transfer: t.kindTransfer,
    release: t.kindRelease,
    scripted: t.kindScripted,
  }[window.kind];
  return fill(t.arcFallback, { severity, kind });
}

/** Arcs on the 24-hour ring: every non-transfer window, colored by severity. */
export function buildArcs(
  spans: readonly WindowSpan[],
  snapshot: Snapshot,
  minute: number,
  colors: Visuals['colors'],
  strings: OrlojStrings,
): ArcModel[] {
  return spans
    .filter((s) => s.window.kind !== 'transfer')
    .map((span) => {
      const startAngle = hourAngle(span.startMinute / MINUTES_PER_HOUR);
      const endAngle = hourAngle((span.startMinute + span.durationMinutes) / MINUTES_PER_HOUR);
      const startLabel = formatMinute(span.startMinute);
      const endLabel = formatMinute(span.startMinute + span.durationMinutes);
      return {
        id: span.window.id,
        title: fill(strings.model.arcTitle, {
          title: span.window.title,
          start: startLabel,
          end: endLabel,
        }),
        text: arcText(span, snapshot.alerts, strings),
        startAngle,
        endAngle,
        midAngle: (startAngle + endAngle) / 2,
        severity: span.window.severity,
        color: colors[span.window.severity],
        isActive: isWithin(span, minute),
        startLabel,
        endLabel,
        startMinute: span.startMinute,
        endMinute: span.startMinute + span.durationMinutes,
      };
    });
}

/** Silver ticks for transfers from the ingest spoke to the core. */
export function buildTicks(spans: readonly WindowSpan[], strings: OrlojStrings): TickModel[] {
  return spans
    .filter((s) => s.window.kind === 'transfer')
    .map((span) => ({
      id: span.window.id,
      title: span.window.title,
      text: fill(strings.model.tickText, {
        time: formatMinute(span.startMinute),
        utc: strings.model.utc,
      }),
      angle: hourAngle(span.startMinute / MINUTES_PER_HOUR),
      minute: span.startMinute,
    }));
}

/** The next window start after `minute`; wraps to the first start tomorrow. */
export function nextStar(
  spans: readonly WindowSpan[],
  minute: number,
  strings: OrlojStrings,
): StarModel | null {
  if (spans.length === 0) return null;
  const sorted = [...spans].sort((a, b) => a.startMinute - b.startMinute);
  const next = sorted.find((s) => s.startMinute > minute) ?? sorted[0];
  if (!next) return null;
  return {
    angle: hourAngle(next.startMinute / MINUTES_PER_HOUR),
    title: next.window.title,
    minute: next.startMinute,
    label: fill(strings.model.starLabel, {
      title: next.window.title,
      time: formatMinute(next.startMinute),
      utc: strings.model.utc,
    }),
  };
}
