// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import {
  buildUrl,
  envPath,
  isWallQuery,
  matchRoute,
  parseQuery,
  withWall,
} from '../src/lib/router.js';

describe('matchRoute', () => {
  test('matches the home route', () => {
    expect(matchRoute('/')).toEqual({ name: 'home' });
  });

  test('matches an environment route and decodes the id', () => {
    expect(matchRoute('/env/prod')).toEqual({ name: 'env', id: 'prod' });
    expect(matchRoute('/env/a%20b/')).toEqual({ name: 'env', id: 'a b' });
  });

  test('matches the compare route', () => {
    expect(matchRoute('/compare')).toEqual({ name: 'compare' });
    expect(matchRoute('/compare/')).toEqual({ name: 'compare' });
  });

  test('returns notFound for unknown paths and malformed escapes', () => {
    expect(matchRoute('/env')).toEqual({ name: 'notFound' });
    expect(matchRoute('/env/a/b')).toEqual({ name: 'notFound' });
    expect(matchRoute('/other')).toEqual({ name: 'notFound' });
    expect(matchRoute('/env/%E0%A4%A')).toEqual({ name: 'notFound' });
  });
});

describe('query helpers', () => {
  test('parses a query string, keeping the first duplicate', () => {
    expect(parseQuery('?t=10:40&speed=2&t=11:00')).toEqual({ t: '10:40', speed: '2' });
    expect(parseQuery('')).toEqual({});
  });

  test('builds a stable url without empty values', () => {
    expect(buildUrl('/env/prod', { tier: 'gold', t: '10:40', workload: '' })).toBe(
      '/env/prod?t=10%3A40&tier=gold',
    );
    expect(buildUrl('/env/prod', {})).toBe('/env/prod');
  });

  test('builds an encoded environment path', () => {
    expect(envPath('a b')).toBe('/env/a%20b');
  });
});

describe('wall query', () => {
  test('detects wall mode only for wall=1', () => {
    expect(isWallQuery({ wall: '1' })).toBe(true);
    expect(isWallQuery({ wall: '0' })).toBe(false);
    expect(isWallQuery({})).toBe(false);
  });

  test('adds and removes wall without touching other parameters', () => {
    expect(withWall({ t: '10:40' }, true)).toEqual({ t: '10:40', wall: '1' });
    expect(withWall({ t: '10:40', wall: '1' }, false)).toEqual({ t: '10:40' });
  });
});
