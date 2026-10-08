// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collect } from '../collect.js';
import {
  checkDeepEqual,
  checkEvents,
  checkHealth,
  checkJsonRoundTrip,
  checkSnapshot,
  checkTopology,
} from './checks.js';
import type { ContractOptions, ContractSubject } from './types.js';

const MS_PER_MINUTE = 60_000;
const DEFAULT_WINDOW_MINUTES = 60;

/** Registers the shared adapter contract suite. Every adapter must pass it. */
export function runAdapterContract(
  name: string,
  setup: () => Promise<ContractSubject>,
  options: ContractOptions = {},
): void {
  const deterministic = options.deterministic ?? true;
  const windowMs = (options.eventWindowMinutes ?? DEFAULT_WINDOW_MINUTES) * MS_PER_MINUTE;

  describe(`adapter contract: ${name}`, () => {
    let subject: ContractSubject;

    beforeEach(async () => {
      subject = await setup();
    });

    afterEach(async () => {
      await subject.adapter.dispose();
    });

    const init = async (): Promise<ContractSubject> => {
      await subject.adapter.init(subject.env, subject.ctx);
      return subject;
    };
    const window = (): { since: Date; until: Date } => ({
      since: subject.at,
      until: new Date(subject.at.getTime() + windowMs),
    });
    const readEvents = async (
      adapter: ContractSubject['adapter'],
      since: Date,
      until: Date,
    ): Promise<PlatformEvent[]> => collect(adapter.events(since, until));

    it('has a non-empty id and initialises', async () => {
      expect(subject.adapter.id.length).toBeGreaterThan(0);
      await expect(init()).resolves.toBeDefined();
    });

    it('returns a topology consistent with the environment config', async () => {
      const { adapter, env } = await init();
      checkTopology(await adapter.topology(), env);
    });

    it('returns a well-formed snapshot for a given time', async () => {
      const { adapter, at } = await init();
      checkSnapshot(await adapter.snapshot(at), await adapter.topology(), at);
    });

    it('uses the context clock when snapshot has no argument', async () => {
      const { adapter, ctx } = await init();
      const expected = ctx.clock.now();
      const snapshot = await adapter.snapshot();
      expect(snapshot.at).toBe(expected.toISOString());
    });

    it('returns ordered, in-window events that reference known topology ids', async () => {
      const { adapter } = await init();
      const { since, until } = window();
      const events = await readEvents(adapter, since, until);
      const open = new Set((await adapter.snapshot(since)).alerts.map((alert) => alert.id));
      checkEvents(events, await adapter.topology(), { since, until }, open);
    });

    it.runIf(deterministic)('is deterministic across adapter instances', async () => {
      const first = await init();
      const second = await setup();
      try {
        await second.adapter.init(second.env, second.ctx);
        const { since, until } = window();
        checkDeepEqual(
          await second.adapter.snapshot(first.at),
          await first.adapter.snapshot(first.at),
          'snapshots from two instances',
        );
        checkDeepEqual(
          await readEvents(second.adapter, since, until),
          await readEvents(first.adapter, since, until),
          'events from two instances',
        );
      } finally {
        await second.adapter.dispose();
      }
    });

    it.runIf(deterministic)('gives the same events when the window is split in two', async () => {
      const { adapter } = await init();
      const { since, until } = window();
      const middle = new Date(since.getTime() + windowMs / 2);
      const whole = await readEvents(adapter, since, until);
      const halves = [
        ...(await readEvents(adapter, since, middle)),
        ...(await readEvents(adapter, middle, until)),
      ];
      checkDeepEqual(halves, whole, 'events from split windows and the whole window');
    });

    it('survives a JSON round trip', async () => {
      const { adapter, at } = await init();
      const { since, until } = window();
      checkJsonRoundTrip(await adapter.topology(), 'topology');
      checkJsonRoundTrip(await adapter.snapshot(at), 'snapshot');
      checkJsonRoundTrip(await readEvents(adapter, since, until), 'events');
    });

    it('reports health', async () => {
      const { adapter } = await init();
      checkHealth(await adapter.health());
    });

    it('disposes idempotently', async () => {
      const { adapter } = await init();
      await expect(adapter.dispose()).resolves.toBeUndefined();
      await expect(adapter.dispose()).resolves.toBeUndefined();
    });
  });
}
