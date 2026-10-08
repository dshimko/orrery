// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenProvider } from '../src/auth.js';
import { SqlError, type Target } from '../src/contracts.js';
import {
  CLIENT_ID,
  SECRET,
  TOKEN,
  fakeFetch,
  jsonResponse,
  makeContext,
  makeEnvironment,
} from './helpers.js';

const target: Target = { metastore: 'primary', host: 'https://h.example.com', warehouseId: 'w' };
const m2m = makeEnvironment({
  connection: {
    auth: 'oauth-m2m',
    clientId: '${env:CID}',
    clientSecret: '${env:CSEC}',
  },
});
const env = { CID: CLIENT_ID, CSEC: SECRET };

describe('client credentials', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends Basic auth and a form body to the token endpoint', async () => {
    const f = fakeFetch(() => jsonResponse({ access_token: TOKEN, expires_in: 3600 }));
    const provider = createTokenProvider(m2m, target, makeContext(env), f.fetch);
    expect(await provider.token()).toBe(TOKEN);
    const call = f.calls[0];
    expect(call?.url).toBe('https://h.example.com/oidc/v1/token');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.body).toBe('grant_type=client_credentials&scope=all-apis');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')}`,
    );
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(provider.cacheKey()).toBe('sp:primary');
  });

  it('caches until 60 s before expiry, then refreshes', async () => {
    let n = 0;
    const f = fakeFetch(() =>
      jsonResponse({ access_token: `${TOKEN}-${(n += 1)}`, expires_in: 300 }),
    );
    const provider = createTokenProvider(m2m, target, makeContext(env), f.fetch);
    expect(await provider.token()).toBe(`${TOKEN}-1`);
    vi.advanceTimersByTime(239_000);
    expect(await provider.token()).toBe(`${TOKEN}-1`);
    vi.advanceTimersByTime(2_000);
    expect(await provider.token()).toBe(`${TOKEN}-2`);
    expect(f.calls).toHaveLength(2);
  });

  it('single-flights concurrent refreshes', async () => {
    const f = fakeFetch(() => jsonResponse({ access_token: TOKEN, expires_in: 3600 }));
    const provider = createTokenProvider(m2m, target, makeContext(env), f.fetch);
    const tokens = await Promise.all([provider.token(), provider.token(), provider.token()]);
    expect(tokens).toEqual([TOKEN, TOKEN, TOKEN]);
    expect(f.calls).toHaveLength(1);
  });

  it('uses DATABRICKS_CLIENT_ID/SECRET for app-service-principal only', async () => {
    const f = fakeFetch(() => jsonResponse({ access_token: TOKEN, expires_in: 3600 }));
    const appEnv = {
      DATABRICKS_CLIENT_ID: CLIENT_ID,
      DATABRICKS_CLIENT_SECRET: SECRET,
    };
    const sp = createTokenProvider(makeEnvironment(), target, makeContext(appEnv), f.fetch);
    expect(await sp.token()).toBe(TOKEN);
    const m2mNoRefs = makeEnvironment({ connection: { auth: 'oauth-m2m' } });
    const bad = createTokenProvider(m2mNoRefs, target, makeContext(appEnv), f.fetch);
    await expect(bad.token()).rejects.toMatchObject({ code: 'auth' });
  });

  it.each([401, 403])('maps HTTP %i to an auth error without secrets', async (status) => {
    const f = fakeFetch(() => jsonResponse({ error: 'invalid_client', secret: SECRET }, status));
    const provider = createTokenProvider(m2m, target, makeContext(env), f.fetch);
    const error = await provider.token().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SqlError);
    expect((error as SqlError).code).toBe('auth');
    expect((error as SqlError).message).not.toContain(SECRET);
    expect((error as SqlError).message).not.toContain(CLIENT_ID);
  });

  it('maps other failures and malformed bodies to auth errors', async () => {
    const f500 = fakeFetch(() => jsonResponse({}, 500));
    await expect(
      createTokenProvider(m2m, target, makeContext(env), f500.fetch).token(),
    ).rejects.toMatchObject({ code: 'auth' });
    const fBad = fakeFetch(() => jsonResponse({ nope: true }));
    await expect(
      createTokenProvider(m2m, target, makeContext(env), fBad.fetch).token(),
    ).rejects.toMatchObject({ code: 'auth' });
    const fNet = fakeFetch(() => Promise.reject(new Error(`boom ${SECRET}`)) as never);
    const error = await createTokenProvider(m2m, target, makeContext(env), fNet.fetch)
      .token()
      .then(
        () => undefined,
        (e: unknown) => e as SqlError,
      );
    expect(error?.code).toBe('auth');
    expect(error?.message).not.toContain(SECRET);
  });

  it('is abortable', async () => {
    const f = fakeFetch(() => new Promise<Response>(() => undefined) as never);
    const provider = createTokenProvider(m2m, target, makeContext(env), f.fetch);
    const controller = new AbortController();
    const pending = provider.token(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'canceled' });
    await expect(provider.token(controller.signal)).rejects.toMatchObject({ code: 'canceled' });
  });
});

describe('pat', () => {
  const pat = makeEnvironment({ connection: { auth: 'pat', token: '${env:PAT}' } });

  it('returns the PAT and warns once', async () => {
    const ctx = makeContext({ PAT: TOKEN });
    const provider = createTokenProvider(pat, target, ctx);
    expect(await provider.token()).toBe(TOKEN);
    expect(await provider.token()).toBe(TOKEN);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]).not.toContain(TOKEN);
    expect(provider.cacheKey()).toBe('sp:primary');
  });

  it('fails when the token variable is unset', async () => {
    const provider = createTokenProvider(pat, target, makeContext({}));
    await expect(provider.token()).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('on-behalf-of-user', () => {
  const obo = makeEnvironment({ connection: { auth: 'on-behalf-of-user' } });

  it('fails without a viewer token', async () => {
    const provider = createTokenProvider(
      obo,
      target,
      makeContext({}, () => undefined),
    );
    await expect(provider.token()).rejects.toThrow(
      'No user token: on-behalf-of-user needs a signed-in viewer.',
    );
    const none = createTokenProvider(obo, target, makeContext({}));
    await expect(none.token()).rejects.toMatchObject({ code: 'auth' });
    expect(none.cacheKey()).toBe('obo:anonymous');
  });

  it('returns the viewer token and keys the cache per user without leaking it', async () => {
    let current: string | undefined = 'user-a-token';
    const provider = createTokenProvider(
      obo,
      target,
      makeContext({}, () => current),
    );
    expect(await provider.token()).toBe('user-a-token');
    const keyA = provider.cacheKey();
    current = 'user-b-token';
    const keyB = provider.cacheKey();
    expect(keyA).toMatch(/^obo:[0-9a-f]{64}$/);
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toContain('user-a-token');
  });
});
