// SPDX-License-Identifier: Apache-2.0
// Regression tests for the milestone 3 adversarial review findings.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { eventsCost, MAX_STREAMS_PER_ENV } from '../src/routes/env.js';
import { TokenBucket } from '../src/rate-limit.js';
import { NOW, closeApps, getJson, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

const minutesBefore = (minutes: number) =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

describe('stream hardening', () => {
  it('rejects a live stream that starts more than 15 minutes ago (no unbounded replay)', async () => {
    const app = await startApp(loadExample('demo.yaml'));
    const { status, body } = await getJson(app, `/api/env/dev/stream?since=${minutesBefore(16)}`);
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: 'since_too_old' } });
  });

  it('does not expose HEAD on the stream route', async () => {
    const app = await startApp(loadExample('demo.yaml'));
    const response = await app.inject({ method: 'HEAD', url: '/api/env/dev/stream' });
    expect(response.statusCode).toBe(404);
  });

  it('caps concurrent streams per environment', () => {
    expect(MAX_STREAMS_PER_ENV).toBeGreaterThan(0);
    expect(MAX_STREAMS_PER_ENV).toBeLessThanOrEqual(64);
  });
});

describe('rate limiting by cost', () => {
  it('charges event windows by length', () => {
    const since = new Date(NOW);
    expect(eventsCost(since, new Date(since.getTime() + 60_000))).toBe(2);
    expect(eventsCost(since, new Date(since.getTime() + 24 * 3_600_000))).toBe(25);
  });

  it('refuses a cost larger than the remaining tokens without taking any', () => {
    let now = 0;
    const bucket = new TokenBucket({ ratePerSecond: 1, burst: 10 }, () => now);
    expect(bucket.tryTake(25)).toBe(false);
    expect(bucket.tryTake(10)).toBe(true);
    expect(bucket.tryTake(1)).toBe(false);
    now = 1000;
    expect(bucket.tryTake(1)).toBe(true);
  });

  it('limits full-day event requests well below the per-request limit', async () => {
    const app = await startApp(loadExample('demo.yaml'));
    const day = `since=${minutesBefore(24 * 60)}&until=${NOW}`;
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1)
      statuses.push((await getJson(app, `/api/env/dev/events?${day}`)).status);
    expect(statuses).toEqual([200, 429, 429]);
  });
});

describe('startup isolation', () => {
  it('a fork adapter whose import never settles cannot block the server', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'orrery-hang-'));
    const file = path.join(dir, 'hang.mjs');
    writeFileSync(file, 'await new Promise(() => {});\nexport default () => ({});\n');
    const config = loadExample('demo.yaml');
    const hung = {
      ...config,
      adapters: { hang: { package: pathToFileURL(file).href } },
      environments: config.environments.map((env) =>
        env.id === 'stg' ? { ...env, adapter: 'hang' } : env,
      ),
    };
    const started = Date.now();
    const app = await startApp(hung, { initTimeoutMs: 200 });
    expect(Date.now() - started).toBeLessThan(5000);
    const { body } = await getJson(app, '/api/environments');
    const list = (body as { data: { id: string; health: { status: string } }[] }).data;
    expect(list.map((e) => [e.id, e.health.status])).toEqual([
      ['dev', 'ok'],
      ['stg', 'error'],
      ['prod', 'ok'],
    ]);
  });
});
