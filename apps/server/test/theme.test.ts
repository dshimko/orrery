// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigError } from '@orrery/core';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { deepMerge } from '../src/theme.js';
import { closeApps, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

const DEMO = path.resolve(import.meta.dirname, '../../../config/examples/demo.yaml');

function workdir(): string {
  return mkdtempSync(path.join(tmpdir(), 'orrery-theme-'));
}

function writeTheme(cwd: string, text: string): string {
  const dir = path.join(cwd, 'config/private');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'theme.yaml');
  writeFileSync(file, text);
  return file;
}

const load = (cwd: string, extra: Record<string, string> = {}) =>
  loadConfig({ ORRERY_CONFIG: DEMO, ...extra }, cwd);

describe('deepMerge', () => {
  it('merges objects and replaces arrays and scalars', () => {
    expect(deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, d: 2 })).toEqual({
      a: { b: 1, c: [3] },
      d: 2,
    });
  });
});

describe('fork theme', () => {
  it('leaves visuals alone when there is no theme file', async () => {
    const base = await load(workdir());
    expect(base.themeSource).toBeUndefined();
    expect(base.config.visuals).toEqual(loadExample('demo.yaml').visuals);
  });

  it('merges config/private/theme.yaml over the config visuals', async () => {
    const cwd = workdir();
    const file = writeTheme(
      cwd,
      'visuals:\n  lighting:\n    ambientIntensity: 0.9\n  time:\n    speeds: [3]\n',
    );
    const base = await load(workdir());
    const themed = await load(cwd);
    expect(themed.themeSource).toBe(file);
    expect(themed.config.visuals.time.speeds).toEqual([3]); // arrays replace
    expect(themed.config.visuals.time.secondsPerSimDay).toBe(
      base.config.visuals.time.secondsPerSimDay,
    );
    expect(themed.config.visuals.lighting).toEqual({
      ...base.config.visuals.lighting,
      ambientIntensity: 0.9,
    }); // objects merge
    expect(themed.config.visuals.camera).toEqual(base.config.visuals.camera);
  });

  it('prefers ORRERY_THEME and returns the merged visuals from /api/config', async () => {
    const cwd = workdir();
    writeTheme(cwd, 'visuals:\n  camera:\n    fovDeg: 3\n');
    const other = path.join(cwd, 'other.yaml');
    writeFileSync(other, 'visuals:\n  camera:\n    fovDeg: 50\n');
    const { config, themeSource } = await load(cwd, { ORRERY_THEME: 'other.yaml' });
    expect(themeSource).toBe(other);
    const app = await startApp(config);
    const body = JSON.parse((await app.inject({ method: 'GET', url: '/api/config' })).body) as {
      data: { visuals: { camera: { fovDeg: number } } };
    };
    expect(body.data.visuals.camera.fovDeg).toBe(50);
  });

  it('fails startup with the issue path for an invalid value', async () => {
    const cwd = workdir();
    writeTheme(cwd, 'visuals:\n  camera:\n    fovDeg: not-a-number\n');
    const error = await load(cwd).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.map((i) => i.path)).toEqual(['visuals.camera.fovDeg']);
    expect((error as Error).message).toContain('theme.yaml: 1 config problem');
  });

  it('fails on unknown keys like the main config', async () => {
    const cwd = workdir();
    writeTheme(cwd, 'visuals:\n  lightning: 2\n');
    const error = (await load(cwd).catch((e: unknown) => e)) as ConfigError;
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.issues[0]?.message).toMatch(/lighting/);
  });

  it('rejects a top-level key other than visuals and a missing visuals object', async () => {
    const cwd = workdir();
    writeTheme(cwd, 'visuals:\n  camera:\n    fovDeg: 2\nproduct:\n  name: X\n');
    const extra = (await load(cwd).catch((e: unknown) => e)) as ConfigError;
    expect(extra.issues.map((i) => i.path)).toEqual(['product']);
    writeTheme(cwd, '');
    const empty = (await load(cwd).catch((e: unknown) => e)) as ConfigError;
    expect(empty).toBeInstanceOf(ConfigError);
  });

  it('reports YAML syntax errors and an unreadable ORRERY_THEME', async () => {
    const cwd = workdir();
    writeTheme(cwd, 'visuals: [unclosed\n');
    const syntax = (await load(cwd).catch((e: unknown) => e)) as ConfigError;
    expect(syntax.issues[0]?.path).toBe('(yaml)');
    await expect(load(workdir(), { ORRERY_THEME: 'missing.yaml' })).rejects.toThrow(
      /Cannot read theme file/,
    );
  });
});
