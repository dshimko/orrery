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
import { buildWorld, type World } from './build.js';
import { eventsBetween } from './events.js';
import { snapshotAt } from './snapshot.js';

/** How often the live stream emits, in clock milliseconds. */
const LIVE_TICK_MS = 1000;

/** Parses MOCK_SPEED: a positive multiplier for simulated time in live mode (default 1). */
export function parseSpeed(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const speed = Number(raw);
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`MOCK_SPEED must be a positive number, got "${raw}".`);
  }
  return speed;
}

/**
 * Deterministic, seeded, time-of-day driven adapter. The same seed and time always give the same
 * topology, snapshot, and events. MOCK_SEED overrides seeds; MOCK_SPEED speeds up live time.
 */
export class MockAdapter implements OrreryAdapter {
  readonly id = 'mock';
  private state: { world: World; ctx: AdapterContext; speed: number; startMs: number } | undefined;
  private readonly disposal = new AbortController();

  async init(env: ResolvedEnvironment, ctx: AdapterContext): Promise<void> {
    this.state = {
      world: buildWorld(env, ctx.env.MOCK_SEED),
      ctx,
      speed: parseSpeed(ctx.env.MOCK_SPEED),
      startMs: ctx.clock.now().getTime(),
    };
  }

  private ready(): NonNullable<MockAdapter['state']> {
    if (!this.state) throw new Error('MockAdapter used before init() or after dispose().');
    return this.state;
  }

  /** Simulated now: the clock, sped up by MOCK_SPEED since init. */
  private now(): Date {
    const { ctx, speed, startMs } = this.ready();
    return new Date(startMs + (ctx.clock.now().getTime() - startMs) * speed);
  }

  async topology(): Promise<Topology> {
    return structuredClone(this.ready().world.topology);
  }

  async snapshot(at?: Date): Promise<Snapshot> {
    return snapshotAt(this.ready().world, at ?? this.now());
  }

  events(since: Date, until?: Date, signal?: AbortSignal): AsyncIterable<PlatformEvent> {
    const state = this.ready();
    if (until) return toAsync(eventsBetween(state.world, since, until), signal);
    return this.live(state, since, signal);
  }

  private async *live(
    { world, ctx, speed, startMs }: NonNullable<MockAdapter['state']>,
    since: Date,
    caller?: AbortSignal,
  ): AsyncGenerator<PlatformEvent> {
    const simulatedNow = () => new Date(startMs + (ctx.clock.now().getTime() - startMs) * speed);
    const signals = [
      this.disposal.signal,
      ...(ctx.signal ? [ctx.signal] : []),
      ...(caller ? [caller] : []),
    ];
    const signal = AbortSignal.any(signals);
    let cursor = since;
    while (!signal.aborted) {
      const now = simulatedNow();
      if (now > cursor) {
        for (const event of eventsBetween(world, cursor, now)) {
          if (signal.aborted) return;
          yield event;
        }
        cursor = now;
      }
      try {
        await ctx.clock.sleep(LIVE_TICK_MS, signal);
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
    }
  }

  async health(): Promise<AdapterHealth> {
    const { ctx } = this.ready();
    return { status: 'ok', message: 'Mock data', checkedAt: ctx.clock.now().toISOString() };
  }

  async dispose(): Promise<void> {
    this.disposal.abort();
    this.state = undefined;
  }
}

async function* toAsync<T>(items: Iterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
  for (const item of items) {
    if (signal?.aborted) return;
    yield item;
  }
}
