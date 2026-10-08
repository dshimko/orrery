// SPDX-License-Identifier: Apache-2.0
import type { OrreryConfig } from '@orrery/core';
import { afterEach, describe, expect, it } from 'vitest';
import { closeApps, getJson, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

interface Envelope<T> {
  data: T;
}
interface ErrorEnvelope {
  error: { code: string; message: string };
}
interface EnvSummary {
  id: string;
  tier: string;
  health: { status: string; message?: string };
}

const WINDOW = 'since=2026-03-02T10:00:00Z&until=2026-03-02T12:00:00Z';

async function environments(config: OrreryConfig): Promise<EnvSummary[]> {
  const app = await startApp(config);
  const { body } = await getJson(app, '/api/environments');
  return (body as Envelope<EnvSummary[]>).data;
}

describe('meta endpoints', () => {
  it('reports ok on /api/health', async () => {
    const app = await startApp(loadExample('demo.yaml'));
    const response = await getJson(app, '/api/health');
    expect(response).toEqual({ status: 200, body: { data: { status: 'ok' } } });
  });

  it('omits connection, federation hosts, and options from /api/config', async () => {
    const app = await startApp(loadExample('three-env.yaml'));
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    const body = JSON.parse(response.body) as Envelope<{
      environments: Record<string, unknown>[];
      product: { title: string };
    }>;
    expect(response.statusCode).toBe(200);
    expect(body.data.product.title).toBe('Orrery');
    for (const env of body.data.environments) {
      expect(Object.keys(env).sort()).toEqual(['id', 'name', 'tier']);
    }
    for (const forbidden of [
      'ORRERY_STG_HOST',
      'ORRERY_PROD_HOST',
      'connection',
      'federation',
      'warehouseId',
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it('lists all demo environments as ok in promotion order', async () => {
    const list = await environments(loadExample('demo.yaml'));
    expect(list.map((env) => [env.id, env.health.status])).toEqual([
      ['dev', 'ok'],
      ['stg', 'ok'],
      ['prod', 'ok'],
    ]);
  });

  it('follows promotion order before config order', async () => {
    const config = loadExample('demo.yaml');
    const reordered: OrreryConfig = {
      ...config,
      promotion: { order: ['prod', 'dev'], source: 'none' },
    };
    const list = await environments(reordered);
    expect(list.map((env) => env.id)).toEqual(['prod', 'dev', 'stg']);
  });
});

describe('failure isolation', () => {
  it('marks environments whose adapter cannot start as errors while dev keeps working', async () => {
    const app = await startApp(loadExample('three-env.yaml'));
    const list = (await getJson(app, '/api/environments')).body as Envelope<EnvSummary[]>;
    expect(list.data.map((env) => [env.id, env.health.status])).toEqual([
      ['dev', 'ok'],
      ['stg', 'error'],
      ['prod', 'error'],
    ]);
    // No credentials in the test env: the real adapter fails to start, without blocking dev.
    expect(list.data[1]?.health.message).toBe('The databricks adapter failed to start.');

    expect((await getJson(app, '/api/env/dev/topology')).status).toBe(200);
    const unavailable = await getJson(app, '/api/env/stg/topology');
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as ErrorEnvelope).error.code).toBe('adapter_unavailable');
    expect((await getJson(app, '/api/env/prod/snapshot')).status).toBe(503);
    expect((await getJson(app, `/api/env/prod/events?${WINDOW}`)).status).toBe(503);
    expect((await getJson(app, '/api/env/prod/stream')).status).toBe(503);
  });

  it('isolates a fork adapter that cannot be imported', async () => {
    const config = loadExample('demo.yaml');
    const withFork: OrreryConfig = {
      ...config,
      adapters: { fork: { package: '@orrery/does-not-exist' } },
      environments: config.environments.map((env) =>
        env.id === 'stg' ? { ...env, adapter: 'fork' } : env,
      ),
    };
    const list = await environments(withFork);
    expect(list.map((env) => [env.id, env.health.status])).toEqual([
      ['dev', 'ok'],
      ['stg', 'error'],
      ['prod', 'ok'],
    ]);
    expect(list[1]?.health.message).toBe('The fork adapter could not be loaded.');
  });

  it('reports adapter composition as unsupported', async () => {
    const config = loadExample('demo.yaml');
    const composed: OrreryConfig = {
      ...config,
      environments: config.environments.map((env) =>
        env.id === 'dev' ? { ...env, adapter: ['mock', 'mock'] } : env,
      ),
    };
    const list = await environments(composed);
    expect(list[0]?.health).toMatchObject({
      status: 'error',
      message: 'Adapter composition is not supported yet.',
    });
    expect(list[1]?.health.status).toBe('ok');
  });
});

describe('environment data', () => {
  it('returns topology, snapshot, and events', async () => {
    const app = await startApp(loadExample('demo.yaml'));
    const topology = await getJson(app, '/api/env/prod/topology');
    expect(topology.status).toBe(200);
    expect((topology.body as Envelope<{ spokes: unknown[] }>).data.spokes.length).toBeGreaterThan(
      0,
    );

    const snapshot = await getJson(app, '/api/env/prod/snapshot');
    expect(snapshot.status).toBe(200);
    const explicit = await getJson(app, '/api/env/prod/snapshot?at=2026-03-02T03:00:00Z');
    expect(explicit.status).toBe(200);

    const events = await getJson(app, `/api/env/prod/events?${WINDOW}`);
    expect(events.status).toBe(200);
    const list = (events.body as Envelope<{ envId: string; ts: string }[]>).data;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((event) => event.envId === 'prod')).toBe(true);
  });
});

describe('validation', () => {
  it.each([
    ['unknown env', '/api/env/nope/topology', 404, 'not_found'],
    ['bad snapshot time', '/api/env/dev/snapshot?at=yesterday', 400, 'bad_request'],
    ['missing since', '/api/env/dev/events?until=2026-03-02T12:00:00Z', 400, 'bad_request'],
    [
      'bad until',
      '/api/env/dev/events?since=2026-03-02T10:00:00Z&until=2026-13-45',
      400,
      'bad_request',
    ],
    [
      'since after until',
      '/api/env/dev/events?since=2026-03-02T12:00:00Z&until=2026-03-02T10:00:00Z',
      400,
      'bad_request',
    ],
    [
      'since equals until',
      '/api/env/dev/events?since=2026-03-02T12:00:00Z&until=2026-03-02T12:00:00Z',
      400,
      'bad_request',
    ],
    [
      'window over 24 h',
      '/api/env/dev/events?since=2026-03-01T11:59:59Z&until=2026-03-02T12:00:00Z',
      400,
      'window_too_large',
    ],
    ['bad stream time', '/api/env/dev/stream?since=soon', 400, 'bad_request'],
    ['unknown route', '/api/nothing', 404, 'not_found'],
  ])('rejects %s', async (_name, url, status, code) => {
    const app = await startApp(loadExample('demo.yaml'));
    const response = await getJson(app, url);
    expect(response.status).toBe(status);
    expect((response.body as ErrorEnvelope).error.code).toBe(code);
  });

  it('accepts a window of exactly 24 hours', async () => {
    const app = await startApp(loadExample('demo.yaml'));
    const url = '/api/env/dev/events?since=2026-03-01T12:00:00Z&until=2026-03-02T12:00:00Z';
    expect((await getJson(app, url)).status).toBe(200);
  });

  it('has no write endpoints', async () => {
    const app = await startApp(loadExample('demo.yaml'));
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
      const response = await app.inject({ method, url: '/api/env/dev/topology' });
      expect(response.statusCode).toBe(404);
    }
  });
});

describe('rate limiting', () => {
  it('returns 429 once the per-environment burst is spent, without affecting other environments', async () => {
    const app = await startApp(loadExample('demo.yaml'), {
      rateLimit: { ratePerSecond: 0.001, burst: 3 },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1)
      statuses.push((await getJson(app, '/api/env/dev/topology')).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect((await getJson(app, '/api/env/prod/topology')).status).toBe(200);
  });
});
