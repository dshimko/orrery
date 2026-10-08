// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OrreryConfig } from '@orrery/core';
import { afterEach, describe, expect, it } from 'vitest';
import { closeApps, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

/** A fork adapter whose snapshot echoes the promotion block from its context. */
function promotionEchoUrl(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'orrery-promo-'));
  const file = path.join(dir, 'promo.mjs');
  writeFileSync(
    file,
    `export default () => {
  let ctx;
  return {
    id: 'promo',
    async init(_env, context) { ctx = context; },
    async topology() { return {}; },
    async snapshot() { return { promotion: ctx.promotion ?? null }; },
    async *events() {},
    async health() { return { status: 'ok', checkedAt: new Date(0).toISOString() }; },
    async dispose() {},
  };
};\n`,
  );
  return pathToFileURL(file).href;
}

async function seenPromotion(promotion: OrreryConfig['promotion']): Promise<unknown> {
  const { promotion: _ignored, ...base } = loadExample('demo.yaml');
  const app = await startApp({
    ...base,
    ...(promotion ? { promotion } : {}),
    adapters: { promo: { package: promotionEchoUrl() } },
    environments: base.environments.map((e) => (e.id === 'dev' ? { ...e, adapter: 'promo' } : e)),
  });
  const response = await app.inject({ method: 'GET', url: '/api/env/dev/snapshot' });
  return (JSON.parse(response.body) as { data: { promotion: unknown } }).data.promotion;
}

describe('promotion config reaches adapters', () => {
  it('passes config.promotion as ctx.promotion', async () => {
    const promotion = { order: ['dev', 'prod'], source: 'job-tag' as const, tagKey: 'release' };
    expect(await seenPromotion(promotion)).toEqual(promotion);
  });

  it('leaves ctx.promotion unset when the config has none', async () => {
    expect(await seenPromotion(undefined)).toBeNull();
  });
});
