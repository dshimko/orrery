// SPDX-License-Identifier: Apache-2.0
// Rows to PlatformEvents. Every event has a stable identity (for live de-duplication) and a
// timestamp taken from the data, never from the clock, so a given row set always yields the same
// events and any split of a window yields the same events in total.
import { DEFAULT_EVENT_WORKLOAD, type PlatformEvent } from '@orrery/core';
import { schemaMatches } from '../discovery/matchers.js';
import type { Discovery, Model, Tier } from '../discovery/types.js';
import { schemaKey } from '../rows.js';
import { MS_PER_MINUTE, type TimeWindow } from '../time.js';
import { ALERT_WINDOW_MS, deriveAlerts } from './alerts.js';
import { classifyObject, classifyWrite, type RunClass } from './classify.js';
import { releaseOf, type Evidence } from './evidence.js';
import { PAST_TARGET_FACTOR } from './freshness.js';

export interface IdentifiedEvent {
  /** Stable identity: the same real-world occurrence always has the same id. */
  id: string;
  event: PlatformEvent;
}

type Draft = {
  [K in PlatformEvent['type']]: Omit<Extract<PlatformEvent, { type: K }>, 'envId' | 'ts'>;
}[PlatformEvent['type']];

const TYPE_ORDER: readonly PlatformEvent['type'][] = [
  'alert.close',
  'alert.open',
  'deploy',
  'source.stream',
  'source.batch',
  'ingest.gate',
  'transfer',
  'copy',
  'product.publish',
  'ml.run',
  'freshness.change',
  'serve.read',
  'federation.query',
  'promotion',
];
const MINUTES_PER_BATCH_POD = 10;
const MAX_BATCH_PODS = 4;

class Collector {
  private readonly items = new Map<string, { ms: number; event: PlatformEvent }>();

  constructor(
    private readonly envId: string,
    private readonly window: TimeWindow,
  ) {}

  add(id: string, ms: number, draft: Draft): void {
    if (ms < this.window.since.getTime() || ms >= this.window.until.getTime()) return;
    const workload = DEFAULT_EVENT_WORKLOAD[draft.type];
    const event = {
      ...draft,
      envId: this.envId,
      ts: new Date(ms).toISOString(),
      ...(workload ? { workload } : {}),
    } as PlatformEvent;
    this.items.set(id, { ms, event });
  }

  result(): IdentifiedEvent[] {
    return [...this.items.entries()]
      .sort(
        ([ia, a], [ib, b]) =>
          a.ms - b.ms ||
          TYPE_ORDER.indexOf(a.event.type) - TYPE_ORDER.indexOf(b.event.type) ||
          ia.localeCompare(ib),
      )
      .map(([id, item]) => ({ id, event: item.event }));
  }
}

function runDraft(model: Model, klass: RunClass, durationMs: number): Draft | undefined {
  switch (klass.type) {
    case 'source.stream':
    case 'source.batch': {
      const siteId = model.groupSites.get(klass.groupId);
      if (siteId === undefined) return undefined;
      const base = {
        tier: klass.tier,
        sourceGroupId: klass.groupId,
        siteId,
        spokeId: klass.spokeId,
      };
      if (klass.type === 'source.stream') return { type: 'source.stream', ...base };
      const pods = Math.floor(durationMs / MS_PER_MINUTE / MINUTES_PER_BATCH_POD);
      return { type: 'source.batch', ...base, size: 1 + Math.min(MAX_BATCH_PODS - 1, pods) };
    }
    case 'transfer':
      return { type: 'transfer', tier: klass.tier, fromSpokeId: klass.spokeId, hubId: model.hubId };
    case 'copy':
      return { type: 'copy', tier: klass.tier, hubId: model.hubId, spokeId: klass.spokeId };
    case 'product.publish':
      return {
        type: 'product.publish',
        tier: klass.tier,
        hubId: model.hubId,
        spokeId: klass.spokeId,
      };
    case 'ml.run':
      return { type: 'ml.run', spokeId: klass.spokeId };
  }
}

function runEvents(out: Collector, discovery: Discovery, evidence: Evidence): void {
  const { model } = discovery;
  for (const run of evidence.runs) {
    if (run.outcome !== 'success') continue;
    const object = model.objects.get(run.objectKey);
    if (!object) continue;
    const triggered = run.triggerJobKey ? model.objects.get(run.triggerJobKey) : undefined;
    const covered = triggered !== undefined && classifyObject(model, triggered) !== undefined;
    const klass = covered ? undefined : classifyObject(model, object);
    const draft = klass ? runDraft(model, klass, run.endedMs - run.startedMs) : undefined;
    if (draft) out.add(`run:${run.runKey}`, run.endedMs, draft);
    if (object.spokeId !== undefined) {
      const target = model.spokes.get(object.spokeId)?.targetMinutes ?? 0;
      out.add(`fresh:${object.spokeId}:${run.runKey}`, run.endedMs, {
        type: 'freshness.change',
        spokeId: object.spokeId,
        ageMinutes: 0,
        targetMinutes: target,
        pastTarget: false,
      });
    }
  }
}

/** A spoke crosses its target when no run refreshes it within target x 1.03 minutes. */
function crossingEvents(out: Collector, model: Model, evidence: Evidence): void {
  for (const spoke of model.spokes.values()) {
    const times = evidence.runs
      .filter(
        (r) => r.outcome === 'success' && model.objects.get(r.objectKey)?.spokeId === spoke.id,
      )
      .map((r) => r.endedMs);
    const limitMs = spoke.targetMinutes * PAST_TARGET_FACTOR * MS_PER_MINUTE;
    times.forEach((startMs, i) => {
      const crossesAt = startMs + limitMs;
      const next = times[i + 1];
      if (next !== undefined && next <= crossesAt) return;
      out.add(`late:${spoke.id}:${startMs}`, crossesAt, {
        type: 'freshness.change',
        spokeId: spoke.id,
        ageMinutes: Math.round(spoke.targetMinutes * PAST_TARGET_FACTOR * 10) / 10,
        targetMinutes: spoke.targetMinutes,
        pastTarget: true,
      });
    });
  }
}

function alertEvents(out: Collector, model: Model, evidence: Evidence): void {
  for (const item of deriveAlerts(model, evidence.runs)) {
    out.add(`alert.open:${item.alert.id}`, item.openedMs, {
      type: 'alert.open',
      alert: item.alert,
    });
    if (item.closedMs !== undefined && item.openedMs > item.closedMs - ALERT_WINDOW_MS) {
      out.add(`alert.close:${item.alert.id}`, item.closedMs, {
        type: 'alert.close',
        alertId: item.alert.id,
      });
    }
  }
}

function writeEvents(out: Collector, model: Model, evidence: Evidence): void {
  for (const write of evidence.writes) {
    const schema = model.schemas.get(write.targetKey);
    if (schema?.spokeId === undefined) continue;
    const klass = classifyWrite(model, schema.spokeId, schema.tier);
    const draft = klass ? runDraft(model, klass, 0) : undefined;
    if (draft)
      out.add(
        `write:${write.minuteMs}:${write.entityType}:${write.targetKey}`,
        write.minuteMs,
        draft,
      );
  }
}

function readEvents(out: Collector, discovery: Discovery, evidence: Evidence): void {
  const { model } = discovery;
  for (const read of evidence.reads) {
    const foreignId = model.foreign.get(read.catalog.toLowerCase());
    if (foreignId !== undefined) {
      out.add(`federation:${foreignId}:${read.minuteMs}`, read.minuteMs, {
        type: 'federation.query',
        foreignCatalogId: foreignId,
      });
      continue;
    }
    const schema = model.schemas.get(schemaKey(read.catalog, read.schema));
    if (schema?.spokeId === undefined) continue;
    for (const useCase of model.useCases) {
      if (!schemaMatches(useCase.matcher, schema)) continue;
      out.add(`read:${useCase.id}:${schema.spokeId}:${read.minuteMs}`, read.minuteMs, {
        type: 'serve.read',
        tier: 'gold' satisfies Tier,
        useCaseId: useCase.id,
        spokeId: schema.spokeId,
      });
    }
  }
}

function gateEvents(out: Collector, model: Model, evidence: Evidence): void {
  for (const gate of evidence.gates) {
    const spokeId = model.objects.get(gate.objectKey)?.spokeId ?? model.ingestId;
    if (spokeId === undefined) continue;
    out.add(`gate:${gate.objectKey}:${gate.minuteMs}`, gate.minuteMs, {
      type: 'ingest.gate',
      tier: 'silver',
      spokeId,
      result: gate.failed > 0 ? 'reject' : 'pass',
    });
  }
}

function deployEvents(out: Collector, model: Model, evidence: Evidence): void {
  for (const change of evidence.changes) {
    const release = releaseOf(change, model.releaseTagKey);
    if (release === undefined) continue;
    const spokeId = model.objects.get(change.objectKey)?.spokeId;
    out.add(`deploy:${change.objectKey}:${change.changedMs}`, change.changedMs, {
      type: 'deploy',
      release,
      ...(spokeId !== undefined ? { spokeId } : {}),
    });
  }
}

/** All events with `since <= ts < until`, sorted by timestamp, with stable identities. */
export function buildEvents(
  discovery: Discovery,
  evidence: Evidence,
  window: TimeWindow,
): IdentifiedEvent[] {
  const { model } = discovery;
  const out = new Collector(model.envId, window);
  runEvents(out, discovery, evidence);
  crossingEvents(out, model, evidence);
  alertEvents(out, model, evidence);
  writeEvents(out, model, evidence);
  readEvents(out, discovery, evidence);
  gateEvents(out, model, evidence);
  deployEvents(out, model, evidence);
  return out.result();
}
