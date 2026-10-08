// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseRef, ref } from '../src/index.js';

describe('object refs', () => {
  it('parses kind:id and bare singleton kinds', () => {
    expect(parseRef('spoke:sales')).toEqual({ kind: 'spoke', id: 'sales' });
    expect(parseRef('shipyard')).toEqual({ kind: 'shipyard', id: undefined });
  });

  it('rejects unknown kinds, empty ids, and extra segments', () => {
    expect(parseRef('planet:sales')).toBeUndefined();
    expect(parseRef('spoke:')).toBeUndefined();
    expect(parseRef('spoke:a:b')).toBeUndefined();
  });

  it('builds refs that round-trip', () => {
    expect(ref('useCase', 'exec')).toBe('useCase:exec');
    expect(ref('shipyard')).toBe('shipyard');
    expect(parseRef(ref('site', 'region-a-1'))).toEqual({ kind: 'site', id: 'region-a-1' });
  });
});
