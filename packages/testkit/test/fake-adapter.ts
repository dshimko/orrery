// SPDX-License-Identifier: Apache-2.0
import type {
  AdapterContext,
  AdapterHealth,
  OrreryAdapter,
  PlatformEvent,
  ResolvedEnvironment,
  Snapshot,
  Topology,
} from '@orrery/core';

const MINUTE_MS = 60_000;

/** Small deterministic adapter: events derive from the minute number only. */
export class FakeAdapter implements OrreryAdapter {
  readonly id = 'fake';
  private env: ResolvedEnvironment | undefined;
  private ctx: AdapterContext | undefined;

  async init(env: ResolvedEnvironment, ctx: AdapterContext): Promise<void> {
    this.env = env;
    this.ctx = ctx;
    await Promise.resolve();
  }

  private requireEnv(): ResolvedEnvironment {
    if (!this.env) throw new Error('init() was not called');
    return this.env;
  }

  async topology(): Promise<Topology> {
    const env = this.requireEnv();
    const [a, b] = env.resolvedTopology.spokes;
    if (!a || !b) throw new Error('fake adapter needs two configured spokes');
    const spoke = (id: string, role: 'ingest' | 'domain'): Topology['spokes'][number] => ({
      id,
      name: id,
      role,
      metastore: 'main',
      freshness: { cadenceMinutes: 15, targetMinutes: 21, offsetMinutes: 0 },
      metrics: { pipelines: 1, products: 1, complexity: 1, volume: 1 },
      hasMl: false,
      isShared: false,
    });
    return {
      envId: env.id,
      hub: { id: 'core', name: 'Core', metastore: 'main' },
      spokes: [spoke(a.id, 'ingest'), spoke(b.id, 'domain')],
      sourceGroups: [
        {
          id: 'region',
          name: 'Region',
          utcOffset: 0,
          sites: [
            { id: 'site-1', name: 'One' },
            { id: 'site-2', name: 'Two' },
          ],
        },
      ],
      useCases: [{ id: 'exec', name: 'Exec', reads: [b.id] }],
      metastores: [{ id: 'main', name: 'Main', status: 'ok' }],
      foreignCatalogs: [],
    };
  }

  async snapshot(at?: Date): Promise<Snapshot> {
    const when = at ?? this.ctx?.clock.now() ?? new Date(0);
    const topology = await this.topology();
    const activity = (when.getUTCMinutes() % 10) / 10;
    return {
      envId: topology.envId,
      at: when.toISOString(),
      hub: { activity },
      spokes: topology.spokes.map((s) => ({
        id: s.id,
        ageMinutes: 5,
        targetMinutes: 21,
        pastTarget: false,
        activity,
      })),
      sourceGroups: [
        {
          id: 'region',
          activity,
          sites: [
            { id: 'site-1', activity },
            { id: 'site-2', activity },
          ],
        },
      ],
      useCases: [{ id: 'exec', activity, status: 'ok', note: '' }],
      workloads: { batch: activity },
      counts: {
        runningPipelines: 2,
        failedRuns: 0,
        spokesPastTarget: 0,
        deploysToday: 1,
        products: 3,
        openIncidents: 0,
      },
      backlog: 0.25,
      spendPerHour: 12.5,
      consumerActivity: activity,
      previousDayClean: true,
      alerts: [],
      schedule: [],
      calendar: {
        year: when.getUTCFullYear(),
        month: when.getUTCMonth() + 1,
        days: [1, 2, 3].map((day) => ({
          day,
          releases: 0,
          promotion: false,
          monthEndClose: false,
          isPast: true,
        })),
      },
    };
  }

  async *events(since: Date, until?: Date): AsyncGenerator<PlatformEvent> {
    const env = this.requireEnv();
    const topology = await this.topology();
    const [a, b] = topology.spokes;
    if (!a || !b) return;
    const end = until ?? new Date(since.getTime() + 60 * MINUTE_MS);
    const first = Math.ceil(since.getTime() / MINUTE_MS);
    for (let minute = first; minute * MINUTE_MS < end.getTime(); minute++) {
      const ts = new Date(minute * MINUTE_MS).toISOString();
      if (minute % 20 === 0) {
        yield {
          envId: env.id,
          ts,
          type: 'source.stream',
          sourceGroupId: 'region',
          siteId: minute % 40 === 0 ? 'site-1' : 'site-2',
          spokeId: a.id,
        };
      }
      if (minute % 30 === 0)
        yield { envId: env.id, ts, type: 'transfer', fromSpokeId: a.id, hubId: 'core' };
      if (minute % 45 === 0)
        yield { envId: env.id, ts, type: 'serve.read', useCaseId: 'exec', spokeId: b.id };
    }
  }

  async health(): Promise<AdapterHealth> {
    return { status: 'ok', checkedAt: (this.ctx?.clock.now() ?? new Date(0)).toISOString() };
  }

  async dispose(): Promise<void> {
    this.env = undefined;
    await Promise.resolve();
  }
}
