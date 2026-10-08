// SPDX-License-Identifier: Apache-2.0
// Starts the packaged server from build/app with the demo config and checks it over HTTP.
// Usage: node scripts/verify-package.mjs   (run `pnpm package` first)
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build/app');
const PORT = Number(process.env.VERIFY_PORT ?? 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`ok: ${message}`);
}

/** @param {import('node:child_process').ChildProcess} child */
async function waitForHealth(child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`server did not become healthy within ${READY_TIMEOUT_MS} ms`);
}

async function runChecks() {
  const health = await fetch(`${BASE}/api/health`);
  assert(health.status === 200, '/api/health returns 200');
  const snapshot = await fetch(`${BASE}/api/env/prod/snapshot`);
  assert(snapshot.status === 200, '/api/env/prod/snapshot returns 200');
  const body = await snapshot.json();
  assert(typeof body === 'object' && body !== null, 'snapshot body is a JSON object');
  const page = await fetch(`${BASE}/`);
  assert(page.status === 200, '/ returns 200');
  assert(
    (page.headers.get('content-type') ?? '').includes('text/html'),
    '/ is served as text/html',
  );
  assert(Boolean(page.headers.get('content-security-policy')), '/ carries a CSP header');
}

async function main() {
  if (!existsSync(path.join(APP_DIR, 'server/main.mjs'))) {
    throw new Error('build/app is missing. Run `pnpm package` first.');
  }
  const sqlFiles = readdirSync(path.join(APP_DIR, 'sql')).filter((name) => name.endsWith('.sql'));
  assert(sqlFiles.length > 0, 'sql/ sits beside server/ where the Databricks adapter looks');
  const child = spawn(process.execPath, ['server/main.mjs'], {
    cwd: APP_DIR,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(PORT),
      ORRERY_WEB_DIR: 'web',
      ORRERY_CONFIG: 'config/demo.yaml',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    await waitForHealth(child);
    await runChecks();
    console.log('Package verified.');
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
