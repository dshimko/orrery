// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, type OrreryConfig } from '@orrery/core';
import { FixedClock, silentLogger } from '@orrery/testkit';
import type { FastifyInstance } from 'fastify';
import { buildServer, type BuildServerOptions } from '../src/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const NOW = '2026-03-02T12:00:00.000Z';

export function loadExample(name: string): OrreryConfig {
  const result = parseConfig(readFileSync(path.join(ROOT, 'config/examples', name), 'utf8'));
  if (!result.ok) throw new Error(`Example ${name} is invalid.`);
  return result.config;
}

const open: FastifyInstance[] = [];
/** An empty working directory, so a developer's own `public/private/` never leaks into tests. */
const EMPTY_CWD = mkdtempSync(path.join(tmpdir(), 'orrery-cwd-'));

export async function startApp(
  config: OrreryConfig,
  extra: Partial<BuildServerOptions> = {},
): Promise<FastifyInstance> {
  const app = await buildServer({
    config,
    env: {},
    cwd: EMPTY_CWD,
    clock: new FixedClock(NOW),
    logger: silentLogger,
    ...extra,
  });
  open.push(app);
  return app;
}

export async function closeApps(): Promise<void> {
  await Promise.all(open.splice(0).map((app) => app.close()));
}

export async function getJson(
  app: FastifyInstance,
  url: string,
): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}
