// SPDX-License-Identifier: Apache-2.0
import type { Alert, ScheduledWindow, Snapshot, Visuals } from '@orrery/core';
import { hourAngle } from '../geometry.js';
import { formatMinute, MS_PER_MINUTE } from './format.js';
import type { ArcModel, StarModel, TickModel } from './types.js';

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

/** A schedule window reduced to minutes of the UTC day. */
export interface WindowSpan {
  window: ScheduledWindow;
  startMinute: number;
  durationMinutes: number;
}

const SEVERITY_LABEL = {
  incident: 'Incident',
  warning: 'Warning',
  info: 'Planned',
} as const;

const KIND_LABEL = {
  transfer: 'transfer',
  release: 'release',
  scripted: 'scheduled event',
} as const;

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

function arcText(span: WindowSpan, alerts: readonly Alert[]): string {
  const { window } = span;
  const alert = alerts.find((a) => a.title === window.title);
  if (alert) return alert.text;
  return `${SEVERITY_LABEL[window.severity]} ${KIND_LABEL[window.kind]}.`;
}

/** Arcs on the 24-hour ring: every non-transfer window, colored by severity. */
export function buildArcs(
  spans: readonly WindowSpan[],
  snapshot: Snapshot,
  minute: number,
  colors: Visuals['colors'],
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
        title: `${span.window.title} ${startLabel} to ${endLabel}`,
        text: arcText(span, snapshot.alerts),
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
export function buildTicks(spans: readonly WindowSpan[]): TickModel[] {
  return spans
    .filter((s) => s.window.kind === 'transfer')
    .map((span) => ({
      id: span.window.id,
      title: span.window.title,
      text: `${formatMinute(span.startMinute)} UTC: consolidated silver moves from the ingest spoke to the core.`,
      angle: hourAngle(span.startMinute / MINUTES_PER_HOUR),
      minute: span.startMinute,
    }));
}

/** The next window start after `minute`; wraps to the first start tomorrow. */
export function nextStar(spans: readonly WindowSpan[], minute: number): StarModel | null {
  if (spans.length === 0) return null;
  const sorted = [...spans].sort((a, b) => a.startMinute - b.startMinute);
  const next = sorted.find((s) => s.startMinute > minute) ?? sorted[0];
  if (!next) return null;
  return {
    angle: hourAngle(next.startMinute / MINUTES_PER_HOUR),
    title: next.window.title,
    minute: next.startMinute,
    label: `${next.window.title} at ${formatMinute(next.startMinute)} UTC`,
  };
}
