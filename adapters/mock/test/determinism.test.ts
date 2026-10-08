// SPDX-License-Identifier: Apache-2.0
// Gate: mock determinism. Snapshots of snapshot() and the first 500 events for a fixed seed and
// time. A drift fails CI; update intentionally with `pnpm vitest run -u` and review the diff.
import { collect } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { at, demoEnv, started } from './helpers.js';

const FIRST_EVENTS = 500;

describe('mock determinism', () => {
  it('gives identical snapshots for the same seed and time across instances', async () => {
    const [a, b] = [await started(demoEnv('prod')), await started(demoEnv('prod'))];
    expect(await b.snapshot(at('10:45'))).toEqual(await a.snapshot(at('10:45')));
  });

  it('changes when the seed changes (MOCK_SEED)', async () => {
    const base = await started(demoEnv('prod'));
    const reseeded = await started(demoEnv('prod'), at('12:00'), { MOCK_SEED: '7' });
    const range = [at('00:00'), at('01:00')] as const;
    expect(await collect(reseeded.events(...range))).not.toEqual(
      await collect(base.events(...range)),
    );
  });

  it.each(['dev', 'stg', 'prod'] as const)(
    '%s snapshot at 10:45 matches the recording',
    async (id) => {
      const adapter = await started(demoEnv(id));
      expect(await adapter.snapshot(at('10:45'))).toMatchSnapshot();
    },
  );

  it.each(['dev', 'stg', 'prod'] as const)(
    '%s first 500 events of the day match the recording',
    async (id) => {
      const adapter = await started(demoEnv(id));
      const events = await collect(
        adapter.events(at('00:00'), at('00:00', '2026-10-08')),
        FIRST_EVENTS,
      );
      expect(events).toHaveLength(FIRST_EVENTS);
      expect(events).toMatchSnapshot();
    },
  );
});
