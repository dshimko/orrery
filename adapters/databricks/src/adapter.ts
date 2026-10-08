// SPDX-License-Identifier: Apache-2.0
// The Databricks adapter: discovers topology from Unity Catalog and system tables, and turns run
// timelines, lineage, and query history into snapshots and events. Read-only; every query comes
// from the allowlist, and every viewer's results are cached under their own token key.
import type {
  AdapterContext,
  AdapterHealth,
  OrreryAdapter,
  PlatformEvent,
  ResolvedEnvironment,
  Snapshot,
  Topology,
} from '@orrery/core';
import { createTokenProvider } from './auth.js';
import { createStatementClient } from './client.js';
import {
  SqlError,
  type QuerySource,
  type SqlClient,
  type Target,
  type TokenProvider,
} from './contracts.js';
import {
  buildEvents,
  buildSnapshot,
  parseEvidence,
  type BuildEventsOptions,
  type IdentifiedEvent,
} from './convert/index.js';
import { buildDiscovery, loadInventory, type Discovery } from './discovery/index.js';
import { EVENT_WINDOW_MAX_MS, liveEvents } from './live.js';
import { fetchEventRows, fetchSnapshotRows } from './fetch.js';
import { QueryPoller } from './poller.js';
import { QUERY_NAMES } from './queries.js';
import { loadQueryRegistry } from './registry.js';
import { Degradations, Sources, describeFailure } from './sources.js';
import { resolveTargets } from './targets.js';

export interface DatabricksDeps {
  queries: QuerySource;
  clientFor: (target: Target, tokens: TokenProvider) => SqlClient;
  tokensFor: (target: Target) => TokenProvider;
  now: () => Date;
}

interface State {
  env: ResolvedEnvironment;
  ctx: AdapterContext;
  targets: Target[];
  sources: Sources;
  poller: QueryPoller;
  degraded: Degradations;
  now: () => Date;
}

/** Events handed to the event loop between yields, so a big window cannot starve the server. */
const YIELD_EVERY = 500;
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function assertAllowlist(queries: QuerySource): void {
  const missing = QUERY_NAMES.filter((name) => !queries.names().includes(name));
  if (missing.length > 0) {
    throw new Error(`The query allowlist is missing: ${missing.join(', ')}.`);
  }
}

export class DatabricksAdapter implements OrreryAdapter {
  readonly id = 'databricks';
  private state: State | undefined;
  private readonly disposal = new AbortController();

  constructor(private readonly deps: Partial<DatabricksDeps> = {}) {}

  async init(env: ResolvedEnvironment, ctx: AdapterContext): Promise<void> {
    const targets = resolveTargets(env, ctx.env);
    // A fork overrides any shipped query (or registers new ones) with `options.sqlDir`.
    const sqlDir = env.options?.sqlDir;
    const queries =
      this.deps.queries ??
      (await loadQueryRegistry(typeof sqlDir === 'string' ? { overrideDir: sqlDir } : {}));
    assertAllowlist(queries);
    const now = this.deps.now ?? ((): Date => ctx.clock.now());
    const poller = new QueryPoller({
      queries,
      clientFor: this.deps.clientFor ?? ((target, tokens) => createStatementClient(target, tokens)),
      tokensFor: this.deps.tokensFor ?? ((target) => createTokenProvider(env, target, ctx)),
      now,
      signal: this.signalWith(ctx.signal),
    });
    const degraded = new Degradations();
    this.state = {
      env,
      ctx,
      targets,
      sources: new Sources(poller, targets, degraded),
      poller,
      degraded,
      now,
    };
  }

  private ready(): State {
    if (!this.state) throw new Error('DatabricksAdapter used before init() or after dispose().');
    return this.state;
  }

  private signalWith(...others: (AbortSignal | undefined)[]): AbortSignal {
    return AbortSignal.any([
      this.disposal.signal,
      ...others.filter((s): s is AbortSignal => s !== undefined),
    ]);
  }

  /** Reads the environment's structure. Cheap when cached: topology rows live for an hour. */
  private async discover(signal?: AbortSignal): Promise<Discovery> {
    const { env, ctx, targets, sources, now } = this.ready();
    const nowMs = now().getTime();
    const inventories = await Promise.all(
      targets.map((target) => loadInventory(sources, target, nowMs, signal)),
    );
    return buildDiscovery({
      env,
      peers: ctx.peers ?? [env],
      targets,
      inventories,
      envVars: ctx.env,
      ...(ctx.promotion ? { promotion: ctx.promotion } : {}),
    });
  }

  private async discoverOrThrow(signal?: AbortSignal): Promise<Discovery> {
    const discovery = await this.discover(signal);
    if (discovery.health.status === 'error') {
      const message = discovery.health.messages.join(' ');
      throw discovery.health.errorCode
        ? new SqlError(discovery.health.errorCode, message)
        : new Error(message);
    }
    return discovery;
  }

  async topology(): Promise<Topology> {
    return (await this.discoverOrThrow(this.signalWith())).topology;
  }

  async snapshot(at?: Date): Promise<Snapshot> {
    const { ctx, degraded, sources } = this.ready();
    const when = at ?? ctx.clock.now();
    const signal = this.signalWith(ctx.signal);
    const discovery = await this.discoverOrThrow(signal);
    const rows = await fetchSnapshotRows(sources, when.getTime(), signal);
    return buildSnapshot(discovery, parseEvidence(rows), when, degraded.names(sources.viewer()));
  }

  events(since: Date, until?: Date, signal?: AbortSignal): AsyncIterable<PlatformEvent> {
    const state = this.ready();
    const merged = this.signalWith(state.ctx.signal, signal);
    if (until === undefined) {
      return liveEvents({
        since,
        signal: merged,
        clock: state.ctx.clock,
        logger: state.ctx.logger,
        poll: (window) =>
          this.window(window.since, window.until, merged, { liveNowMs: window.until.getTime() }),
      });
    }
    return this.bounded(since, until, merged);
  }

  private async window(
    since: Date,
    until: Date,
    signal: AbortSignal,
    options: BuildEventsOptions = {},
  ): Promise<IdentifiedEvent[]> {
    const { sources } = this.ready();
    const discovery = await this.discoverOrThrow(signal);
    const rows = await fetchEventRows(sources, { since, until }, signal);
    return buildEvents(discovery, parseEvidence(rows), { since, until }, options);
  }

  private async *bounded(
    since: Date,
    until: Date,
    signal: AbortSignal,
  ): AsyncGenerator<PlatformEvent> {
    if (until.getTime() - since.getTime() > EVENT_WINDOW_MAX_MS) {
      throw new RangeError('events() windows are limited to 24 hours.');
    }
    if (until <= since) return;
    let events: IdentifiedEvent[];
    try {
      events = await this.window(since, until, signal);
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
    for (const [index, item] of events.entries()) {
      if (signal.aborted) return;
      if (index > 0 && index % YIELD_EVERY === 0) await tick();
      yield item.event;
    }
  }

  async health(): Promise<AdapterHealth> {
    const { ctx, degraded, poller, sources } = this.ready();
    const checkedAt = ctx.clock.now().toISOString();
    let discovery: Discovery;
    try {
      discovery = await this.discover(this.signalWith(ctx.signal));
    } catch (error) {
      if (this.disposal.signal.aborted) throw error;
      return { status: 'error', message: describeFailure(error), checkedAt };
    }
    const viewer = sources.viewer();
    const degradedNotes = degraded.messages(viewer);
    const truncatedNames = poller.truncated(viewer);
    const notes = [
      ...discovery.health.messages,
      ...degradedNotes,
      ...truncatedNames.map(
        (name) => `Query ${name} hit its row limit; results may be incomplete.`,
      ),
    ];
    const impaired =
      discovery.health.status !== 'ok' || degradedNotes.length > 0 || truncatedNames.length > 0;
    const status = discovery.health.status === 'error' ? 'error' : impaired ? 'degraded' : 'ok';
    return {
      status,
      checkedAt,
      ...(notes.length > 0 ? { message: notes.join(' ') } : {}),
      ...(discovery.health.unmatchedCatalogs.length > 0
        ? { unmatchedCatalogs: [...discovery.health.unmatchedCatalogs] }
        : {}),
    };
  }

  async dispose(): Promise<void> {
    this.disposal.abort();
    this.state?.poller.clear();
    this.state = undefined;
  }
}
