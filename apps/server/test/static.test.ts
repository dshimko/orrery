// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../src/app.js';
import { closeApps, loadExample, startApp } from './helpers.js';

let sandbox: string;
let webDir: string;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'orrery-static-'));
  webDir = path.join(sandbox, 'dist');
  mkdirSync(path.join(webDir, 'assets'), { recursive: true });
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Orrery</title>');
  writeFileSync(path.join(webDir, 'assets', 'app.js'), 'export {};');
  writeFileSync(path.join(sandbox, 'secret.txt'), 'top secret');
  symlinkSync(path.join(sandbox, 'secret.txt'), path.join(webDir, 'link.txt'));
});

afterEach(async () => {
  await closeApps();
  rmSync(sandbox, { recursive: true, force: true });
});

async function app() {
  return startApp(loadExample('demo.yaml'), { webDir });
}

describe('static files', () => {
  it('serves index.html at / and as the SPA fallback', async () => {
    const server = await app();
    for (const url of ['/', '/env/prod', '/env/prod/deep?x=1']) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<title>Orrery</title>');
    }
  });

  it('serves assets with their content type and 404s missing assets', async () => {
    const server = await app();
    const found = await server.inject({ method: 'GET', url: '/assets/app.js' });
    expect(found.statusCode).toBe(200);
    expect(found.headers['content-type']).toContain('text/javascript');
    const missing = await server.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(missing.statusCode).toBe(404);
  });

  it.each([
    '/../secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E%2Fsecret.txt',
    '/assets/../../secret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '/..\\secret.txt',
    '/%5c..%5csecret.txt',
    '/%00',
    '/%',
  ])('rejects traversal attempt %s', async (url) => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.body).not.toContain('top secret');
  });

  it('does not follow a symlink out of the web root', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/link.txt' });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('top secret');
  });

  it('returns a JSON 404 when the web build is absent', async () => {
    const server = await startApp(loadExample('demo.yaml'), { webDir: path.join(sandbox, 'none') });
    const response = await server.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe('not_found');
  });

  it('does not fall back to index.html for /api paths or non-GET methods', async () => {
    const server = await app();
    expect((await server.inject({ method: 'GET', url: '/api/unknown' })).statusCode).toBe(404);
    expect((await server.inject({ method: 'POST', url: '/' })).statusCode).toBe(404);
  });
});

describe('security headers', () => {
  it.each(['/', '/assets/app.js', '/api/health', '/api/nope', '/api/env/nope/topology'])(
    'sets CSP and friends on %s',
    async (url) => {
      const server = await app();
      const response = await server.inject({ method: 'GET', url });
      expect(response.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    },
  );

  it('names no third-party hosts in the CSP', () => {
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:|\/\//);
  });
});
