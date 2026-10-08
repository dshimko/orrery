// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { resolveRef } from '../src/env-refs.js';
import { normalizeHost, resolveTargets } from '../src/targets.js';
import { makeEnvironment } from './helpers.js';

describe('resolveRef', () => {
  it('expands env references and passes literals through', () => {
    expect(resolveRef('${env:A}', { A: 'x' })).toBe('x');
    expect(resolveRef('literal', {})).toBe('literal');
  });

  it('returns undefined for undefined, missing, or empty values', () => {
    expect(resolveRef(undefined, {})).toBeUndefined();
    expect(resolveRef('${env:A}', {})).toBeUndefined();
    expect(resolveRef('${env:A}', { A: '' })).toBeUndefined();
    expect(resolveRef('', {})).toBeUndefined();
  });
});

describe('normalizeHost', () => {
  it('adds https and strips a trailing slash', () => {
    expect(normalizeHost('dbc-1.cloud.databricks.com', 'x')).toBe(
      'https://dbc-1.cloud.databricks.com',
    );
    expect(normalizeHost('https://h.example.com/', 'x')).toBe('https://h.example.com');
  });

  it.each([
    'http://h.example.com',
    'https://user:pw@h.example.com',
    'https://h.example.com/path',
    'https://h.example.com/?q=1',
    'https://h.example.com/#frag',
    'https://',
    'ftp://h.example.com',
  ])('rejects %s without echoing it', (raw) => {
    let message = '';
    try {
      normalizeHost(raw, 'label');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('pw');
    expect(message).not.toContain(raw);
  });
});

describe('resolveTargets', () => {
  it('builds one primary target without federation', () => {
    const environment = makeEnvironment({
      connection: { host: '${env:H}', warehouseId: 'wh1', auth: 'pat' },
    });
    expect(resolveTargets(environment, { H: 'a.b.com' })).toEqual([
      { metastore: 'primary', host: 'https://a.b.com', warehouseId: 'wh1' },
    ]);
  });

  it.each(['single-workspace', 'multi-workspace'])('uses connection for %s', (mode) => {
    const environment = makeEnvironment({
      connection: { host: 'a.b.com', warehouseId: 'wh1' },
      federation: { mode },
    });
    expect(resolveTargets(environment, {})).toHaveLength(1);
  });

  it('falls back to DATABRICKS_HOST for Databricks Apps', () => {
    const environment = makeEnvironment({ connection: { warehouseId: 'wh1' } });
    expect(
      resolveTargets(environment, { DATABRICKS_HOST: 'app.cloud.databricks.com' })[0]?.host,
    ).toBe('https://app.cloud.databricks.com');
  });

  it('builds one target per metastore in multi-metastore mode', () => {
    const environment = makeEnvironment({
      federation: {
        mode: 'multi-metastore',
        metastores: [
          { id: 'eu', host: '${env:EU_HOST}', warehouseId: 'w-eu' },
          { id: 'us', host: 'us.example.com', warehouseId: '${env:US_WH}' },
        ],
      },
    });
    expect(resolveTargets(environment, { EU_HOST: 'eu.example.com', US_WH: 'w-us' })).toEqual([
      { metastore: 'eu', host: 'https://eu.example.com', warehouseId: 'w-eu' },
      { metastore: 'us', host: 'https://us.example.com', warehouseId: 'w-us' },
    ]);
  });

  it('names the environment and field, never the value, when host is missing', () => {
    const environment = makeEnvironment({ connection: { host: '${env:H}', warehouseId: 'w' } });
    expect(() => resolveTargets(environment, {})).toThrow(/prod.*connection\.host/);
  });

  it('names the field when the warehouse is missing', () => {
    const environment = makeEnvironment({ connection: { host: 'a.b.com' } });
    expect(() => resolveTargets(environment, {})).toThrow(/prod.*connection\.warehouseId/);
  });

  it('names the metastore field in multi-metastore mode', () => {
    const environment = makeEnvironment({
      federation: { mode: 'multi-metastore', metastores: [{ id: 'eu', host: 'h.com' }] },
    });
    expect(() => resolveTargets(environment, {})).toThrow(/metastores\[eu\]\.warehouseId/);
  });

  it('rejects multi-metastore without metastores', () => {
    const environment = makeEnvironment({ federation: { mode: 'multi-metastore' } });
    expect(() => resolveTargets(environment, {})).toThrow(/federation\.metastores/);
  });

  it('rejects an insecure host', () => {
    const environment = makeEnvironment({
      connection: { host: 'http://a.b.com', warehouseId: 'w' },
    });
    expect(() => resolveTargets(environment, {})).toThrow(/https/);
  });
});
