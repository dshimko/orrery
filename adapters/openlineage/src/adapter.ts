// SPDX-License-Identifier: Apache-2.0
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type {
  AdapterContext,
  AdapterHealth,
  OrreryAdapter,
  PlatformEvent,
  ResolvedEnvironment,
  Snapshot,
  Topology,
} from '@orrery/core';
import { buildModel } from './build-model.js';
import { buildEvents, buildSnapshot, type IdentifiedEvent } from './convert/index.js';
import { refName, resolveRef } from './env-refs.js';
import { FileEventSource } from './file-events.js';
import { readEventsFile } from './file-source.js';
import { EventStore } from './event-store.js';
import { LIVE_OVERLAP_MS, liveEvents } from './live.js';
import { MarquezSource } from './marquez.js';
import type { Model } from './model.js';
import { parseOptions, replaySettings, type OpenLineageOptions } from './options.js';
import { describeProblems } from './parse.js';
import { cachedModel, fixedModel, type ModelProvider } from './provider.js';
import { buildRuns } from './runs.js';
import type { EventSource } from './source.js';
import { MS_PER_DAY, type TimeWindow } from './time.js';
import { EVENT_WINDOW_MAX_MS, eventLookbackMs, snapshotLookbackMs } from './windows.js';

const MAX_HEALTH_NOTES = 5;
/** Events converted between yields to the event loop. */
const YIELD_EVERY = 1000;
const DISCOVERY_LOOKBACK_MS = 7 * MS_PER_DAY;

export interface OpenLineageDeps {
  /** Substituted in tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Base for relative file paths. Defaults to the working directory. */
  cwd?: string;
}

interface State {
  env: ResolvedEnvironment;
  ctx: AdapterContext;
  options: OpenLineageOptions;
  source: EventSource;
  models: ModelProvider;
  /** Notes from reading the source (skipped entries). */
  readNotes: string[];
  eventCount: number;
}

/** Renders OpenLineage RunEvents (a file, or a Marquez server) as a solar system. */
export class OpenLineageAdapter implements OrreryAdapter {
  readonly id = 'openlineage';
  private state: State | undefined;
  private truncated = false;
  private readonly disposal = new AbortController();

  constructor(private readonly deps: OpenLineageDeps = {}) {}

  async init(env: ResolvedEnvironment, ctx: AdapterContext): Promise<void> {
    const options = parseOptions(env.options);
    const source = options.source;
    if (source.kind === 'file') {
      const parsed = await readEventsFile(source.path, this.deps.cwd ?? process.cwd());
      const recorded = new FileEventSource(parsed.events, replaySettings(options));
      const model = buildModel(env, buildRuns(parsed.events));
      const note = describeProblems(parsed);
      this.state = {
        env,
        ctx,
        options,
        source: recorded,
        models: fixedModel(model),
        readNotes: note ? [note] : [],
        eventCount: parsed.events.length,
      };
      return;
    }
    const token = resolveRef(source.apiKey, ctx.env);
    if (source.apiKey !== undefined && token === undefined) {
      throw new Error(
        `The environment variable ${refName(source.apiKey) ?? 'for apiKey'} is not set.`,
      );
    }
    const remote = new MarquezSource(
      { url: source.url, namespace: source.namespace, token },
      { fetch: this.deps.fetch ?? globalThis.fetch, nowMs: () => ctx.clock.now().getTime() },
    );
    this.state = {
      env,
      ctx,
      options,
      source: remote,
      models: cachedModel(
        () => this.discover(env, remote, ctx),
        () => ctx.clock.now().getTime(),
      ),
      readNotes: [],
      eventCount: 0,
    };
  }

  private async discover(
    env: ResolvedEnvironment,
    source: EventSource,
    ctx: AdapterContext,
  ): Promise<Model> {
    const now = ctx.clock.now().getTime();
    const window = { since: new Date(now - DISCOVERY_LOOKBACK_MS), until: new Date(now + 1) };
    const { events, truncated } = await source.load(window, this.disposal.signal);
    this.truncated = truncated;
    return buildModel(env, buildRuns(events));
  }

  private ready(): State {
    if (!this.state) throw new Error('OpenLineageAdapter used before init() or after dispose().');
    return this.state;
  }

  async topology(): Promise<Topology> {
    const model = await this.ready().models.get();
    return structuredClone(model.topology);
  }

  async snapshot(at?: Date): Promise<Snapshot> {
    const state = this.ready();
    const when = at ?? state.ctx.clock.now();
    const atMs = when.getTime();
    if (Number.isNaN(atMs)) throw new RangeError('Invalid snapshot time.');
    const model = await state.models.get();
    const since = new Date(atMs - snapshotLookbackMs(model));
    const { events, truncated } = await state.source.load(
      { since, until: new Date(atMs + 1) },
      this.disposal.signal,
    );
    this.truncated = truncated;
    return buildSnapshot(model, buildRuns(events, atMs), when);
  }

  events(since: Date, until?: Date, signal?: AbortSignal): AsyncIterable<PlatformEvent> {
    const state = this.ready();
    if (!until) return this.live(state, since, signal);
    if (until.getTime() - since.getTime() > EVENT_WINDOW_MAX_MS) {
      throw new RangeError('Event windows are limited to 24 hours.');
    }
    return this.window(state, { since, until }, signal);
  }

  private async *window(
    state: State,
    window: TimeWindow,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<PlatformEvent> {
    const model = await state.models.get();
    const from = new Date(window.since.getTime() - eventLookbackMs(model));
    const loaded = await state.source.load({ since: from, until: window.until }, signal);
    this.truncated = loaded.truncated;
    const events = buildEvents(model, buildRuns(loaded.events), window);
    for (const [index, item] of events.entries()) {
      if (signal?.aborted || this.disposal.signal.aborted) return;
      if (index > 0 && index % YIELD_EVERY === 0) await yieldToLoop();
      yield item.event;
    }
  }

  private live(
    state: State,
    since: Date,
    caller: AbortSignal | undefined,
  ): AsyncGenerator<PlatformEvent> {
    const signals = [
      this.disposal.signal,
      ...(state.ctx.signal ? [state.ctx.signal] : []),
      ...(caller ? [caller] : []),
    ];
    const signal = AbortSignal.any(signals);
    return liveEvents({
      since,
      signal,
      clock: state.ctx.clock,
      logger: state.ctx.logger,
      poll: this.incrementalPoll(state, signal),
    });
  }

  /** A poll that reads only what it has not read yet and converts the accumulated runs. */
  private incrementalPoll(
    state: State,
    signal: AbortSignal,
  ): (window: TimeWindow) => Promise<IdentifiedEvent[]> {
    const store = new EventStore();
    let loadedUntilMs: number | undefined;
    return async (window) => {
      const model = await state.models.get();
      const lookback = eventLookbackMs(model);
      const fromMs =
        loadedUntilMs === undefined
          ? window.since.getTime() - lookback
          : loadedUntilMs - LIVE_OVERLAP_MS;
      const loaded = await state.source.load(
        { since: new Date(fromMs), until: window.until },
        signal,
      );
      this.truncated = loaded.truncated;
      store.add(loaded.events);
      store.prune(window.since.getTime() - lookback);
      loadedUntilMs = window.until.getTime();
      return buildEvents(model, buildRuns(store.all()), window);
    };
  }

  async health(): Promise<AdapterHealth> {
    const state = this.ready();
    const checkedAt = state.ctx.clock.now().toISOString();
    try {
      await state.source.check(this.disposal.signal);
      const model = await state.models.get();
      const notes = [
        ...state.readNotes,
        ...model.notes,
        ...(this.truncated
          ? ['The source returned more events than the read limit; older ones were left out.']
          : []),
      ];
      if (notes.length === 0) {
        return { status: 'ok', message: this.describe(state), checkedAt };
      }
      const shown = notes.slice(0, MAX_HEALTH_NOTES).join(' ');
      const more =
        notes.length > MAX_HEALTH_NOTES ? ` (${notes.length - MAX_HEALTH_NOTES} more)` : '';
      return { status: 'degraded', message: `${shown}${more}`, checkedAt };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'The OpenLineage source failed.',
        checkedAt,
      };
    }
  }

  private describe(state: State): string {
    if (state.options.source.kind === 'marquez') return 'Reading run events from Marquez.';
    const replay = replaySettings(state.options);
    const mode = replay
      ? ' replayed every ' + (replay.periodMs === MS_PER_DAY ? 'day' : 'hour')
      : '';
    return `${state.eventCount} run events from a file${mode}.`;
  }

  async dispose(): Promise<void> {
    this.disposal.abort();
    this.state?.source.dispose?.();
    this.state = undefined;
  }
}
