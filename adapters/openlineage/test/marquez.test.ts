// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  CACHE_TTL_MS,
  MAX_PAGES,
  MarquezError,
  MarquezSource,
  PAGE_LIMIT,
  type MarquezConfig,
} from '../src/marquez.js';
import { MIN, T0, dataset, ev, wire } from './helpers.js';

interface Call {
  url: URL;
  init: RequestInit;
}

const TOKEN = 'tok-s3cr3t-value';
const window = (fromMin: number, toMin: number) => ({
  since: new Date(T0 + fromMin * MIN),
  until: new Date(T0 + toMin * MIN),
});

function event(index: number, namespace = 'jobs'): Record<string, unknown> {
  return wire(
    ev({
      type: 'COMPLETE',
      atMin: index % 50,
      run: `r${index}`,
      job: `job${index}`,
      namespace,
      outputs: [dataset(`raw.t${index}`)],
    }),
  );
}

const events = (count: number, namespace = 'jobs'): Record<string, unknown>[] =>
  Array.from({ length: count }, (_, i) => event(i, namespace));

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

/** A fetch that records calls and answers from `handler`. */
function fakeFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: new URL(String(input)), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  return { impl, calls };
}

function source(
  handler: Parameters<typeof fakeFetch>[0],
  config: Partial<MarquezConfig> = {},
  extra: { nowMs?: () => number; timeoutMs?: number } = {},
) {
  const fake = fakeFetch(handler);
  const client = new MarquezSource(
    { url: 'https://marquez.example.org', ...config },
    {
      fetch: fake.impl,
      nowMs: extra.nowMs ?? (() => T0),
      ...(extra.timeoutMs ? { timeoutMs: extra.timeoutMs } : {}),
    },
  );
  return { client, calls: fake.calls };
}

describe('MarquezSource requests', () => {
  it('sends one read-only GET with the documented query and a bearer key', async () => {
    const { client, calls } = source(() => json({ events: [] }), { token: TOKEN });
    await client.load(window(0, 60));
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.init.method).toBe('GET');
    expect(call?.init.body).toBeUndefined();
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(`${call?.url.origin}${call?.url.pathname}`).toBe(
      'https://marquez.example.org/api/v1/events/lineage',
    );
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      sortDirection: 'desc',
      after: new Date(T0).toISOString(),
      before: new Date(T0 + 60 * MIN).toISOString(),
      limit: String(PAGE_LIMIT),
      offset: '0',
    });
  });

  it('sends no Authorization header without a key', async () => {
    const { client, calls } = source(() => json({ events: [] }));
    await client.load(window(0, 60));
    expect(calls[0]?.init.headers).toEqual({ Accept: 'application/json' });
  });

  it('keeps a base path in front of the API path', async () => {
    const { client, calls } = source(() => json({ events: [] }), {
      url: 'https://gw.example.org/marquez/',
    });
    await client.load(window(0, 60));
    expect(calls[0]?.url.pathname).toBe('/marquez/api/v1/events/lineage');
  });

  it('snaps the requested window to whole minutes and filters locally to the exact window', async () => {
    const inside = event(1);
    const before = { ...event(2), eventTime: new Date(T0 - 1000).toISOString() };
    const { client, calls } = source(() => json({ events: [inside, before] }));
    const loaded = await client.load({
      since: new Date(T0 + 1500),
      until: new Date(T0 + 30 * MIN + 1500),
    });
    expect(calls[0]?.url.searchParams.get('after')).toBe(new Date(T0).toISOString());
    expect(calls[0]?.url.searchParams.get('before')).toBe(new Date(T0 + 31 * MIN).toISOString());
    expect(loaded.events.map((e) => e.runId)).toEqual(['r1']);
  });

  it('check() asks for a single event', async () => {
    const { client, calls } = source(() => json({ events: [] }));
    await client.check();
    expect(calls[0]?.url.searchParams.get('limit')).toBe('1');
  });
});

describe('MarquezSource results', () => {
  it('reads every page until a short one', async () => {
    const { client, calls } = source((call) => {
      const offset = Number(call.url.searchParams.get('offset'));
      return json({ events: events(offset === 0 ? PAGE_LIMIT : 5) });
    });
    const loaded = await client.load(window(-60, 120));
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', String(PAGE_LIMIT)]);
    expect(loaded.events).toHaveLength(PAGE_LIMIT + 5);
    expect(loaded.truncated).toBe(false);
  });

  it('stops at the page limit and says so', async () => {
    const { client, calls } = source(() => json({ events: events(PAGE_LIMIT) }));
    const loaded = await client.load(window(-60, 120));
    expect(calls).toHaveLength(MAX_PAGES);
    expect(loaded.truncated).toBe(true);
  });

  it('keeps only events of the configured namespace', async () => {
    const { client } = source(
      () => json({ events: [...events(2, 'wanted'), ...events(3, 'other')] }),
      {
        namespace: 'wanted',
      },
    );
    const loaded = await client.load(window(-60, 120));
    expect(loaded.events.map((e) => e.job.namespace)).toEqual(['wanted', 'wanted']);
  });

  it('counts entries that are not RunEvents instead of failing', async () => {
    const { client } = source(() => json({ events: [event(1), { nonsense: true }, 5] }));
    const loaded = await client.load(window(-60, 120));
    expect(loaded.events).toHaveLength(1);
    expect(client.skipped).toBe(2);
  });
});

describe('MarquezSource caching', () => {
  it('serves a repeated window from one upstream read within the TTL, then rereads', async () => {
    let now = T0;
    const { client, calls } = source(() => json({ events: [] }), {}, { nowMs: () => now });
    await Promise.all([client.load(window(0, 60)), client.load(window(0, 60))]);
    await client.load(window(0, 60));
    expect(calls).toHaveLength(1);
    now += CACHE_TTL_MS + 1;
    await client.load(window(0, 60));
    expect(calls).toHaveLength(2);
  });

  it('does not cache a failed read', async () => {
    let fail = true;
    const { client, calls } = source(() =>
      fail ? new Response('', { status: 503 }) : json({ events: [] }),
    );
    await expect(client.load(window(0, 60))).rejects.toThrow('Marquez returned HTTP 503.');
    fail = false;
    await expect(client.load(window(0, 60))).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it('evicts old entries so the cache stays bounded', async () => {
    const { client, calls } = source(() => json({ events: [] }));
    for (let i = 0; i < 40; i += 1) await client.load(window(i * 100, i * 100 + 10));
    await client.load(window(0, 10));
    expect(calls).toHaveLength(41);
  });
});

describe('MarquezSource errors', () => {
  it('maps credential refusals without the key', async () => {
    const { client } = source(() => new Response('bad token ' + TOKEN, { status: 401 }), {
      token: TOKEN,
    });
    const error = await client.load(window(0, 60)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MarquezError);
    expect((error as MarquezError).code).toBe('auth');
    expect((error as Error).message).toBe('Marquez refused the credentials (HTTP 401).');
    expect(String(error)).not.toContain(TOKEN);
  });

  it('maps other statuses', async () => {
    const { client } = source(() => new Response('', { status: 500 }));
    await expect(client.load(window(0, 60))).rejects.toMatchObject({ code: 'http' });
  });

  it('hides the cause of a network failure, which can carry the URL or the key', async () => {
    const { client } = source(
      () => {
        throw new TypeError(`fetch failed for https://marquez.example.org with ${TOKEN}`);
      },
      { token: TOKEN },
    );
    const error = (await client.load(window(0, 60)).catch((e: unknown) => e)) as MarquezError;
    expect(error.code).toBe('network');
    expect(error.message).toBe('Marquez could not be reached.');
    expect(JSON.stringify(error) + String(error.stack).split('\n')[0]).not.toContain(TOKEN);
  });

  it('times out a request that never answers', async () => {
    const { client } = source(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = call.init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      {},
      { timeoutMs: 20 },
    );
    await expect(client.load(window(0, 60))).rejects.toMatchObject({
      code: 'timeout',
      message: 'Marquez did not answer within 0.02 s.',
    });
  });

  it('lets a caller abort, as the caller aborted and not as a Marquez failure', async () => {
    const controller = new AbortController();
    const { client } = source(() => new Promise<Response>(() => undefined));
    const pending = client.load(window(0, 60), controller.signal);
    controller.abort(new Error('client went away'));
    await expect(pending).rejects.toThrow('client went away');
  });

  it('rejects a call whose signal is already aborted', async () => {
    const { client, calls } = source(() => json({ events: [] }));
    const controller = new AbortController();
    controller.abort(new Error('gone'));
    await expect(client.load(window(0, 60), controller.signal)).rejects.toThrow('gone');
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it('rejects bodies that are not JSON, lack an events list, or are too large', async () => {
    const bad = source(() => new Response('<html>', { status: 200 }));
    await expect(bad.client.load(window(0, 60))).rejects.toMatchObject({ code: 'format' });
    const shape = source(() => json({ nope: [] }));
    await expect(shape.client.load(window(0, 60))).rejects.toThrow(
      'Marquez returned no events list.',
    );
    const big = source(() =>
      json({ events: [] }, { headers: { 'content-length': String(50 * 1024 * 1024) } }),
    );
    await expect(big.client.load(window(0, 60))).rejects.toThrow('too large');
  });

  it('stops reading a chunked body without Content-Length once it exceeds the cap', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(1024 * 1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const streaming = source(() => new Response(endless, { status: 200 }));
    await expect(streaming.client.load(window(0, 60))).rejects.toThrow('too large');
    expect(pulled).toBeLessThan(25);
  });

  it('stops in-flight reads on dispose', async () => {
    const { client } = source(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = call.init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    const pending = client.load(window(0, 60)).catch((e: unknown) => e);
    await Promise.resolve();
    client.dispose();
    client.dispose();
    expect(await pending).toBeDefined();
  });
});
