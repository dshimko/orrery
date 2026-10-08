// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  assignCatalogs,
  conflictMessage,
  globToRegExp,
  matchGlob,
  scopeMatch,
} from '../src/index.js';

const env = (id: string, catalogs?: string[], tag?: Record<string, string>) => ({
  id,
  scope: { ...(catalogs ? { catalogs } : {}), ...(tag ? { tag } : {}) },
});

describe('catalog scoping', () => {
  it('matches globs case-insensitively and treats regex characters literally', () => {
    expect(matchGlob('dev_*', 'DEV_Sales')).toBe(true);
    expect(matchGlob('a.b?', 'a.bc')).toBe(true);
    expect(matchGlob('a.b?', 'axbc')).toBe(false);
    expect(globToRegExp('*_dev').test('sales_dev_x')).toBe(false);
  });

  it('strips the environment tag at the start or end to the same base name', () => {
    const dev = env('dev', ['dev_*', '*_dev']);
    expect(scopeMatch(dev, { name: 'dev_sales' })).toBe('sales');
    expect(scopeMatch(dev, { name: 'Sales_DEV' })).toBe('sales');
    expect(scopeMatch(dev, { name: 'prod_sales' })).toBeUndefined();
  });

  it('does not match when the star captures nothing, and takes the first star as the base', () => {
    const dev = env('dev', ['dev_*', '*_dev']);
    expect(scopeMatch(dev, { name: 'dev_' })).toBeUndefined();
    expect(scopeMatch(dev, { name: '_dev' })).toBeUndefined();
    expect(scopeMatch(env('x', ['*_mid_*']), { name: 'Sales_mid_eu' })).toBe('sales');
  });

  it('accepts a Unity Catalog tag for catalogs that follow neither form', () => {
    const dev = env('dev', ['dev_*'], { env: 'dev' });
    expect(scopeMatch(dev, { name: 'legacy', tags: { env: 'DEV' } })).toBe('legacy');
    expect(scopeMatch(dev, { name: 'legacy', tags: { env: 'prod' } })).toBeUndefined();
    expect(scopeMatch({ scope: undefined }, { name: 'dev_x' })).toBeUndefined();
  });

  it('reports catalogs matching two environments with both names, and unmatched catalogs', () => {
    const result = assignCatalogs(
      [{ name: 'dev_sales' }, { name: 'sales_stg' }, { name: 'dev_stg' }, { name: 'scratch' }],
      [
        env('dev', ['dev_*', '*_dev']),
        env('stg', ['stg_*', '*_stg']),
        { id: 'demo', scope: undefined },
      ],
    );
    expect(result.byEnv.get('dev')).toEqual([
      { catalog: 'dev_sales', base: 'sales' },
      { catalog: 'dev_stg', base: 'stg' },
    ]);
    expect(result.byEnv.get('stg')).toEqual([
      { catalog: 'sales_stg', base: 'sales' },
      { catalog: 'dev_stg', base: 'dev' },
    ]);
    expect(result.conflicts).toEqual([{ catalog: 'dev_stg', envIds: ['dev', 'stg'] }]);
    const [conflict] = result.conflicts;
    if (!conflict) throw new Error('expected a conflict');
    expect(conflictMessage(conflict)).toContain('dev, stg');
    expect(result.unmatched).toEqual(['scratch']);
  });
});
