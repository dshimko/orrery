// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';
import { collect, loadExampleEnvironment } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { SCRIPTS_BY_TIER } from '../src/index.js';
import { DAY, at, demoEnv, started } from './helpers.js';

const MS_PER_MINUTE = 60_000;
const plus = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MS_PER_MINUTE);

function scriptCases() {
  return (['dev', 'stg', 'prod'] as const).flatMap((tier) =>
    (SCRIPTS_BY_TIER[tier] ?? []).map((entry) => ({ tier, entry })),
  );
}

describe('scripted incidents', () => {
  it.each(scriptCases())(
    '$tier $entry.id opens at $entry.at and closes on time',
    async ({ tier, entry }) => {
      const adapter = await started(demoEnv(tier));
      const opens = at(entry.at);
      const closes = plus(opens, entry.durationMinutes);
      const id = `${tier}:${entry.id}:${DAY}`;

      const opened = await collect(adapter.events(opens, plus(opens, 1)));
      expect(opened).toContainEqual(
        expect.objectContaining({
          type: 'alert.open',
          ts: opens.toISOString(),
          alert: expect.objectContaining({ id, severity: entry.severity, title: entry.title }),
        }),
      );
      const closed = await collect(adapter.events(closes, plus(closes, 1)));
      expect(closed).toContainEqual(
        expect.objectContaining({ type: 'alert.close', ts: closes.toISOString(), alertId: id }),
      );

      const ids = async (when: Date) => (await adapter.snapshot(when)).alerts.map((a) => a.id);
      if (entry.at !== '00:00') expect(await ids(plus(opens, -1))).not.toContain(id);
      expect(await ids(opens)).toContain(id);
      expect(await ids(plus(closes, -1))).toContain(id);
      expect(await ids(closes)).not.toContain(id);
    },
  );

  it('counts only warnings and incidents as open incidents', async () => {
    const adapter = await started(demoEnv('prod'));
    const snapshot = await adapter.snapshot(at('11:00'));
    expect(snapshot.alerts.map((a) => a.severity).sort()).toEqual(['incident']);
    expect(snapshot.counts.openIncidents).toBe(1);
    expect((await adapter.snapshot(at('01:30'))).counts.openIncidents).toBe(0);
  });

  it('turns targeted stations to alert status with the alert title', async () => {
    const adapter = await started(demoEnv('prod'));
    const risk = (await adapter.snapshot(at('11:00'))).useCases.find((u) => u.id === 'risk');
    expect(risk).toEqual({
      id: 'risk',
      activity: 1,
      status: 'incident',
      note: 'Cross-domain quality alert',
    });
    const quiet = (await adapter.snapshot(at('09:59'))).useCases.find((u) => u.id === 'risk');
    expect(quiet?.status).toBe('ok');
  });

  it('blocks promotion from stg and warns stations reading the affected spoke', async () => {
    const adapter = await started(demoEnv('stg'));
    const events = await collect(adapter.events(at('14:00'), at('14:01')));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'promotion',
        status: 'blocked',
        fromEnvId: 'stg',
        toEnvId: 'prod',
      }),
    );
    const demand = (await adapter.snapshot(at('14:30'))).useCases.find((u) => u.id === 'demand');
    expect(demand).toMatchObject({ status: 'warning', note: 'Waiting on blocked release' });
  });

  it('promotes when a release window ends', async () => {
    const adapter = await started(demoEnv('dev'));
    const events = await collect(adapter.events(at('16:30'), at('16:31')));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'promotion',
        status: 'promoted',
        fromEnvId: 'dev',
        toEnvId: 'stg',
      }),
    );
  });

  it('sparks rejects at the gantry during schema drift', async () => {
    const adapter = await started(demoEnv('dev'));
    const share = async (from: string, to: string) => {
      const gates = (await collect(adapter.events(at(from), at(to)))).filter(
        (e): e is Extract<PlatformEvent, { type: 'ingest.gate' }> => e.type === 'ingest.gate',
      );
      return gates.filter((g) => g.result === 'reject').length / Math.max(1, gates.length);
    };
    expect(await share('10:00', '11:30')).toBeGreaterThan(0.35);
    expect(await share('12:00', '14:00')).toBeLessThan(0.35);
    expect((await adapter.snapshot(at('10:30'))).counts.failedRuns).toBeGreaterThan(
      (await adapter.snapshot(at('09:59'))).counts.failedRuns,
    );
  });

  it('uses incidents from config instead of the tier default', async () => {
    const env = loadExampleEnvironment('demo.yaml', 'prod');
    const custom = {
      ...env,
      mock: {
        scale: 1,
        failureRate: 0.015,
        deploysPerHour: 0.6,
        agingFactor: 1,
        ...env.mock,
        incidents: [
          {
            id: 'drill',
            at: '23:30',
            durationMinutes: 60,
            severity: 'incident' as const,
            kind: 'drill',
            title: 'Drill',
            text: '',
            targets: ['spoke:sales' as const, 'spoke:nope' as const],
          },
          {
            id: 'ghost',
            at: '05:00',
            durationMinutes: 10,
            severity: 'info' as const,
            kind: 'x',
            title: 'Ghost',
            text: '',
            targets: ['spoke:nope' as const],
          },
        ],
      },
    };
    const adapter = await started(custom);
    const late = await adapter.snapshot(at('00:15', '2026-10-08'));
    expect(late.alerts).toEqual([
      expect.objectContaining({
        id: `prod:drill:${DAY}`,
        targets: ['spoke:sales'],
        openedAt: at('23:30').toISOString(),
      }),
    ]);
    expect(late.previousDayClean).toBe(false);
    expect((await adapter.snapshot(at('05:05'))).alerts).toEqual([]);
    expect((await adapter.snapshot(at('05:05'))).schedule.map((w) => w.id)).toContain(
      `drill@${DAY}`,
    );
  });
});
