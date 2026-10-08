// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LOGO_BYTES, SVG_CONTENT_SECURITY_POLICY } from '../src/branding.js';
import { closeApps, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>1</script></svg>';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function workdir(): string {
  return mkdtempSync(path.join(tmpdir(), 'orrery-brand-'));
}

function writeLogo(cwd: string, name: string, body: string | Buffer): string {
  const dir = path.join(cwd, 'public/private');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
}

async function branding(app: Awaited<ReturnType<typeof startApp>>): Promise<unknown> {
  const response = await app.inject({ method: 'GET', url: '/api/config' });
  return (JSON.parse(response.body) as { data: { branding: unknown } }).data.branding;
}

describe('fork logo', () => {
  it('reports a null logoUrl and 404s the route when there is no logo', async () => {
    const app = await startApp(loadExample('demo.yaml'), { cwd: workdir() });
    expect(await branding(app)).toEqual({ logoUrl: null });
    expect((await app.inject({ method: 'GET', url: '/branding/logo' })).statusCode).toBe(404);
  });

  it('serves public/private/logo.png with caching and nosniff headers', async () => {
    const cwd = workdir();
    writeLogo(cwd, 'logo.png', PNG);
    const app = await startApp(loadExample('demo.yaml'), { cwd });
    const response = await app.inject({ method: 'GET', url: '/branding/logo' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.rawPayload.equals(PNG)).toBe(true);
    expect(await branding(app)).toEqual({ logoUrl: '/branding/logo' });
  });

  it('adds a sandboxing CSP to an SVG logo named by ORRERY_LOGO', async () => {
    const cwd = workdir();
    const file = writeLogo(cwd, 'mark.svg', SVG);
    const app = await startApp(loadExample('demo.yaml'), {
      cwd,
      env: { ORRERY_LOGO: file },
    });
    const response = await app.inject({ method: 'GET', url: '/branding/logo' });
    expect(response.headers['content-type']).toBe('image/svg+xml');
    expect(response.headers['content-security-policy']).toBe(SVG_CONTENT_SECURITY_POLICY);
    expect(SVG_CONTENT_SECURITY_POLICY).toContain('sandbox');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses an oversized logo at startup', async () => {
    const cwd = workdir();
    writeLogo(cwd, 'logo.webp', Buffer.alloc(MAX_LOGO_BYTES + 1));
    await expect(startApp(loadExample('demo.yaml'), { cwd })).rejects.toThrow(/larger than 512 KB/);
  });

  it('refuses a symlink that points outside the logo directory', async () => {
    const cwd = workdir();
    const outside = path.join(workdir(), 'secret.svg');
    writeFileSync(outside, SVG);
    const dir = path.join(cwd, 'public/private');
    mkdirSync(dir, { recursive: true });
    symlinkSync(outside, path.join(dir, 'logo.svg'));
    await expect(startApp(loadExample('demo.yaml'), { cwd })).rejects.toThrow(
      /outside its directory/,
    );
  });

  it('allows a symlink that stays inside the directory', async () => {
    const cwd = workdir();
    const real = writeLogo(cwd, 'real.png', PNG);
    symlinkSync(real, path.join(path.dirname(real), 'logo.png'));
    const app = await startApp(loadExample('demo.yaml'), { cwd });
    expect(await branding(app)).toEqual({ logoUrl: '/branding/logo' });
  });

  it('rejects an ORRERY_LOGO of an unsupported type or a missing file', async () => {
    const cwd = workdir();
    const file = writeLogo(cwd, 'logo.gif', 'GIF89a');
    await expect(
      startApp(loadExample('demo.yaml'), { cwd, env: { ORRERY_LOGO: file } }),
    ).rejects.toThrow(/\.svg, \.png, or \.webp/);
    await expect(
      startApp(loadExample('demo.yaml'), { cwd, env: { ORRERY_LOGO: path.join(cwd, 'no.png') } }),
    ).rejects.toThrow(/Cannot read logo/);
  });
});
