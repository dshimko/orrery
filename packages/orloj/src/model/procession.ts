// SPDX-License-Identifier: Apache-2.0
import { lcg, type Snapshot, type Visuals } from '@orrery/core';
import { fill } from '../strings.js';
import type { OrlojStrings } from '../types.js';
import { MS_PER_DAY, clamp } from './format.js';
import type { WindowSpan } from './schedule.js';
import type { ProcessionFigure, ProcessionModel } from './types.js';

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const SEED_FACE_STRIDE = 100;
/** Running pipelines per extra figure: figures = 3 + running ÷ 40. */
const BASE_FIGURES = 3;
const PIPELINES_PER_FIGURE = 40;
/** Workloads that populate the procession, in the reference's draw order. */
const MIX_ORDER = ['batch', 'transform', 'serving', 'streaming', 'ml'] as const;
const BUILD_WORKLOAD = 'build';

function workloadColor(visuals: Visuals, id: string): string {
  return visuals.workloads.find((w) => w.id === id)?.color ?? visuals.colors.gold;
}

function workloadLabel(visuals: Visuals, id: string): string {
  return visuals.workloads.find((w) => w.id === id)?.name.toLowerCase() ?? id;
}

/** True when a release window overlaps the UTC hour that contains `minute`. */
function hasReleaseInHour(spans: readonly WindowSpan[], hour: number): boolean {
  const hourStart = hour * MINUTES_PER_HOUR;
  const hourEnd = hourStart + MINUTES_PER_HOUR;
  return spans.some((s) => {
    if (s.window.kind !== 'release') return false;
    const startsInHour = s.startMinute >= hourStart && s.startMinute < hourEnd;
    const coversHour = s.startMinute <= hourStart && s.startMinute + s.durationMinutes > hourStart;
    return startsInHour || coversHour;
  });
}

function pickWorkload(
  weights: readonly (readonly [string, number])[],
  total: number,
  roll: number,
): string {
  let acc = 0;
  const target = roll * total;
  for (const [id, weight] of weights) {
    acc += weight;
    if (target <= acc) return id;
  }
  return weights[0]?.[0] ?? 'batch';
}

function describe(visuals: Visuals, figures: readonly ProcessionFigure[]): string {
  const counts = new Map<string, number>();
  for (const f of figures) counts.set(f.workload, (counts.get(f.workload) ?? 0) + 1);
  return [...counts.entries()].map(([id, n]) => `${n} ${workloadLabel(visuals, id)}`).join(', ');
}

/**
 * The hourly procession. The figure set is seeded per face, hour, and day (stability rule 5), so
 * it is identical across frames; it marches only in the first `procession.minutes` of the hour.
 */
export function buildProcession(
  snapshot: Snapshot,
  spans: readonly WindowSpan[],
  seed: number,
  at: Date,
  minuteOfDay: number,
  visuals: Visuals,
  strings: OrlojStrings,
): ProcessionModel {
  const cfg = visuals.orloj.procession;
  const hour = at.getUTCHours();
  const day = Math.floor(at.getTime() / MS_PER_DAY);
  const rand = lcg(seed * SEED_FACE_STRIDE + hour + day * HOURS_PER_DAY);

  const weights = MIX_ORDER.map((id) => [id, Math.max(0, snapshot.workloads[id] ?? 0)] as const);
  const sum = weights.reduce((acc, [, w]) => acc + w, 0);
  const usable = sum > 0 ? weights : MIX_ORDER.map((id) => [id, 1] as const);
  const total = sum > 0 ? sum : MIX_ORDER.length;

  const count = clamp(
    Math.round(BASE_FIGURES + snapshot.counts.runningPipelines / PIPELINES_PER_FIGURE),
    cfg.minFigures,
    cfg.maxFigures,
  );
  const figures: ProcessionFigure[] = [];
  for (let k = 0; k < count; k += 1) {
    const workload = pickWorkload(usable, total, rand());
    figures.push({ workload, color: workloadColor(visuals, workload) });
  }
  const hasRelease = hasReleaseInHour(spans, hour);
  if (hasRelease) {
    figures.push({ workload: BUILD_WORKLOAD, color: workloadColor(visuals, BUILD_WORKLOAD) });
  }

  const minuteInHour = minuteOfDay - hour * MINUTES_PER_HOUR;
  const progress = minuteInHour < cfg.minutes ? clamp(minuteInHour / cfg.minutes, 0, 1) : null;
  return {
    figures,
    progress,
    hasRelease,
    text: fill(strings.model.processionText, {
      count: figures.length,
      mix: describe(visuals, figures),
    }),
  };
}
