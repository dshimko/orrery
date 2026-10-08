// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readForwardedToken, trustsForwardedToken } from '../src/user-token.js';
import { closeApps, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

/** A fork adapter whose snapshot echoes the viewer token it sees, to prove the plumbing. */
function echoAdapterUrl(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'orrery-echo-'));
  const file = path.join(dir, 'echo.mjs');
  writeFileSync(
    file,
    `export default () => {
  let ctx;
  return {
    id: 'echo',
    async init(_env, context) { ctx = context; },
    async topology() { return {}; },
    async snapshot() { return { seenToken: ctx.userToken?.() ?? null }; },
    async *events() {},
    async health() { return { status: 'ok', checkedAt: new Date(0).toISOString() }; },
    async dispose() {},
  };
};\n`,
  );
  return pathToFileURL(file).href;
}

async function seenToken(env: Record<string, string>, header?: string): Promise<unknown> {
  const config = loadExample('demo.yaml');
  const echo = {
    ...config,
    adapters: { echo: { package: echoAdapterUrl() } },
    environments: config.environments.map((e) => (e.id === 'dev' ? { ...e, adapter: 'echo' } : e)),
  };
  const app = await startApp(echo, { env });
  const response = await app.inject({
    method: 'GET',
    url: '/api/env/dev/snapshot',
    headers: header === undefined ? {} : { 'x-forwarded-access-token': header },
  });
  return (JSON.parse(response.body) as { data: { seenToken: unknown } }).data.seenToken;
}

describe('on-behalf-of-user token', () => {
  it('reaches the adapter behind the Databricks Apps proxy', async () => {
    expect(await seenToken({ DATABRICKS_APP_PORT: '8000' }, 'user-token.abc')).toBe(
      'user-token.abc',
    );
  });

  it('is ignored on a standalone server unless the operator opts in', async () => {
    expect(await seenToken({}, 'user-token.abc')).toBeNull();
    expect(await seenToken({ ORRERY_TRUST_FORWARDED_TOKEN: '1' }, 'user-token.abc')).toBe(
      'user-token.abc',
    );
  });

  it('rejects malformed or oversized tokens', async () => {
    expect(await seenToken({ DATABRICKS_APP_PORT: '8000' }, 'bad token\n')).toBeNull();
    expect(readForwardedToken('x'.repeat(9000))).toBeUndefined();
    expect(readForwardedToken(['a', 'b'])).toBeUndefined();
    expect(trustsForwardedToken({})).toBe(false);
  });
});

describe('health is cached per viewer (on-behalf-of-user)', () => {
  it('never serves one viewer health to another or to anonymous requests', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'orrery-health-'));
    const file = path.join(dir, 'health.mjs');
    writeFileSync(
      file,
      `export default () => {
  let ctx;
  return {
    id: 'h',
    async init(_e, c) { ctx = c; },
    async topology() { return {}; },
    async snapshot() { return {}; },
    async *events() {},
    async health() {
      return { status: 'ok', message: 'for ' + (ctx.userToken?.() ?? 'nobody'), checkedAt: new Date(0).toISOString() };
    },
    async dispose() {},
  };
};\n`,
    );
    const config = loadExample('demo.yaml');
    const app = await startApp(
      {
        ...config,
        adapters: { h: { package: pathToFileURL(file).href } },
        environments: config.environments.map((e) => (e.id === 'dev' ? { ...e, adapter: 'h' } : e)),
      },
      { env: { DATABRICKS_APP_PORT: '8000' } },
    );
    const healthFor = async (token?: string) => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/environments',
        headers: token ? { 'x-forwarded-access-token': token } : {},
      });
      const list = (
        JSON.parse(response.body) as { data: { id: string; health: { message?: string } }[] }
      ).data;
      return list.find((e) => e.id === 'dev')?.health.message;
    };
    expect(await healthFor('alice-token')).toBe('for alice-token');
    expect(await healthFor('bob-token')).toBe('for bob-token');
    expect(await healthFor()).toBe('for nobody');
    expect(await healthFor('alice-token')).toBe('for alice-token');
  });
});
