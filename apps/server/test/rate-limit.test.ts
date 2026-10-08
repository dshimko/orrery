// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/rate-limit.js';
import { closeApps, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

const SLOW = { ratePerSecond: 0.001 };

describe('RateLimiter', () => {
  it('keeps one client exhausting its bucket from limiting another', () => {
    const limiter = new RateLimiter(['dev'], {
      client: { ...SLOW, burst: 2 },
      global: { ...SLOW, burst: 100 },
    });
    expect([1, 2, 3].map(() => limiter.tryTake('dev', 'ip:a'))).toEqual([true, true, false]);
    expect(limiter.tryTake('dev', 'ip:b')).toBe(true);
  });

  it('applies the global cap across clients and refunds the client on refusal', () => {
    const limiter = new RateLimiter(['dev'], {
      client: { ...SLOW, burst: 5 },
      global: { ...SLOW, burst: 3 },
    });
    expect(limiter.tryTake('dev', 'ip:a', 2)).toBe(true);
    expect(limiter.tryTake('dev', 'ip:b', 2)).toBe(false);
    // b's refused request took nothing from b: it can still spend what the global bucket holds.
    expect(limiter.tryTake('dev', 'ip:b', 1)).toBe(true);
    expect(limiter.tryTake('dev', 'ip:c', 1)).toBe(false);
  });

  it('keeps separate buckets for each environment', () => {
    const limiter = new RateLimiter(['dev', 'prod'], { client: { ...SLOW, burst: 1 } });
    expect(limiter.tryTake('dev', 'ip:a')).toBe(true);
    expect(limiter.tryTake('dev', 'ip:a')).toBe(false);
    expect(limiter.tryTake('prod', 'ip:a')).toBe(true);
  });

  it('bounds client buckets and evicts the least recently used first', () => {
    const limiter = new RateLimiter(['dev'], {
      client: { ...SLOW, burst: 1 },
      global: { ...SLOW, burst: 1000 },
      maxClients: 3,
    });
    for (const client of ['a', 'b', 'c']) expect(limiter.tryTake('dev', client)).toBe(true);
    expect(limiter.tryTake('dev', 'a')).toBe(false); // refreshes a's recency
    expect(limiter.tryTake('dev', 'd')).toBe(true); // evicts b, the least recently used
    expect(limiter.clientCount('dev')).toBe(3);
    expect(limiter.tryTake('dev', 'a')).toBe(false); // a kept its spent bucket
    expect(limiter.tryTake('dev', 'b')).toBe(true); // b was evicted and starts fresh
    for (let i = 0; i < 50; i += 1) limiter.tryTake('dev', `many-${i}`);
    expect(limiter.clientCount('dev')).toBe(3);
  });
});

const TOPOLOGY = '/api/env/dev/topology';

function statusFor(
  app: Awaited<ReturnType<typeof startApp>>,
  remoteAddress: string,
  headers: Record<string, string> = {},
): Promise<number> {
  return app
    .inject({ method: 'GET', url: TOPOLOGY, remoteAddress, headers })
    .then((r) => r.statusCode);
}

describe('per-client rate limiting over HTTP', () => {
  const limits = { client: { ...SLOW, burst: 2 }, global: { ...SLOW, burst: 100 } };

  it('does not 429 a second client when the first is exhausted', async () => {
    const app = await startApp(loadExample('demo.yaml'), { rateLimit: limits });
    const first = [];
    for (let i = 0; i < 3; i += 1) first.push(await statusFor(app, '10.0.0.1'));
    expect(first).toEqual([200, 200, 429]);
    expect(await statusFor(app, '10.0.0.2')).toBe(200);
  });

  it('applies the global cap to many clients', async () => {
    const app = await startApp(loadExample('demo.yaml'), {
      rateLimit: { client: { ...SLOW, burst: 2 }, global: { ...SLOW, burst: 3 } },
    });
    const statuses = [];
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']) {
      statuses.push(await statusFor(app, ip));
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    const spoof = (n: number) => ({ 'x-forwarded-for': `203.0.113.${n}` });
    const direct = await startApp(loadExample('demo.yaml'), { rateLimit: limits });
    const results = [];
    for (let i = 1; i <= 3; i += 1) results.push(await statusFor(direct, '10.0.0.1', spoof(i)));
    expect(results).toEqual([200, 200, 429]);

    const proxied = await startApp(loadExample('demo.yaml'), {
      rateLimit: limits,
      env: { ORRERY_TRUST_PROXY: '1' },
    });
    const forwarded = [];
    for (let i = 1; i <= 3; i += 1) forwarded.push(await statusFor(proxied, '10.0.0.1', spoof(i)));
    expect(forwarded).toEqual([200, 200, 200]);
  });

  it('trusts the proxy behind Databricks Apps', async () => {
    const app = await startApp(loadExample('demo.yaml'), {
      rateLimit: limits,
      env: { DATABRICKS_APP_PORT: '8000' },
    });
    const statuses = [];
    for (let i = 1; i <= 3; i += 1) {
      statuses.push(await statusFor(app, '10.0.0.1', { 'x-forwarded-for': `203.0.113.${i}` }));
    }
    expect(statuses).toEqual([200, 200, 200]);
  });

  it('behind a trusted proxy, uses only the hop the proxy appended (no spoofing)', async () => {
    const app = await startApp(loadExample('demo.yaml'), {
      rateLimit: limits,
      env: { ORRERY_TRUST_PROXY: '1' },
    });
    // The client varies the leftmost entry; the proxy appends the real address (rightmost).
    const statuses = [];
    for (let i = 1; i <= 3; i += 1) {
      statuses.push(
        await statusFor(app, '10.0.0.1', { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.7` }),
      );
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('keys clients by forwarded viewer token when trusted', async () => {
    const app = await startApp(loadExample('demo.yaml'), {
      rateLimit: limits,
      env: { ORRERY_TRUST_FORWARDED_TOKEN: '1' },
    });
    const asViewer = (token: string) =>
      statusFor(app, '10.0.0.1', { 'x-forwarded-access-token': token });
    expect([await asViewer('alice'), await asViewer('alice'), await asViewer('alice')]).toEqual([
      200, 200, 429,
    ]);
    expect(await asViewer('bob')).toBe(200);
  });
});
