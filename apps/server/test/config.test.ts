// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resolveListenOptions } from '../src/config.js';

describe('resolveListenOptions', () => {
  it('defaults to loopback on 8787', () => {
    expect(resolveListenOptions({})).toEqual({ host: '127.0.0.1', port: 8787 });
  });

  it('prefers PORT over DATABRICKS_APP_PORT', () => {
    const env = { PORT: '9000', DATABRICKS_APP_PORT: '8000' };
    expect(resolveListenOptions(env).port).toBe(9000);
  });

  it('uses DATABRICKS_APP_PORT and binds all interfaces when it is set', () => {
    expect(resolveListenOptions({ DATABRICKS_APP_PORT: '8000' })).toEqual({
      host: '0.0.0.0',
      port: 8000,
    });
  });

  it('lets HOST override the Databricks Apps default', () => {
    const env = { DATABRICKS_APP_PORT: '8000', HOST: '10.0.0.1' };
    expect(resolveListenOptions(env).host).toBe('10.0.0.1');
  });

  it('rejects a malformed DATABRICKS_APP_PORT', () => {
    expect(() => resolveListenOptions({ DATABRICKS_APP_PORT: 'abc' })).toThrow(/PORT must be/);
  });
});

describe('loadConfig path resolution', () => {
  let sandbox: string;
  let originalCwd: string;
  const demo = readFileSync(
    path.resolve(import.meta.dirname, '../../../config/examples/demo.yaml'),
    'utf8',
  );

  beforeEach(() => {
    originalCwd = process.cwd();
    sandbox = mkdtempSync(path.join(tmpdir(), 'orrery-config-'));
    mkdirSync(path.join(sandbox, 'config'));
    writeFileSync(path.join(sandbox, 'config', 'private.yaml'), demo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('resolves a relative ORRERY_CONFIG against the working directory', async () => {
    process.chdir(sandbox);
    const loaded = await loadConfig({ ORRERY_CONFIG: 'config/private.yaml' });
    expect(loaded.isDefault).toBe(false);
    expect(path.basename(loaded.source)).toBe('private.yaml');
  });

  it('uses the repository demo config by default when running from source', async () => {
    const loaded = await loadConfig({});
    expect(loaded.isDefault).toBe(true);
    expect(loaded.source).toMatch(/config\/examples\/demo\.yaml$/);
  });

  it('reports a clear error for a missing explicit config', async () => {
    await expect(loadConfig({ ORRERY_CONFIG: path.join(sandbox, 'nope.yaml') })).rejects.toThrow(
      /Cannot read config file/,
    );
  });
});
