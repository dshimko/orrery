// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import {
  compareUrl,
  defaultComparePair,
  parseCompareEnvs,
  serializeCompareEnvs,
  withCompareSlot,
} from '../src/lib/compare.js';

const ORDER = ['dev', 'stg', 'prod'];

describe('parseCompareEnvs', () => {
  test('keeps two or three known ids in the given order', () => {
    expect(parseCompareEnvs('stg,prod', ORDER)).toEqual(['stg', 'prod']);
    expect(parseCompareEnvs('prod,dev,stg', ORDER)).toEqual(['prod', 'dev', 'stg']);
  });

  test('drops unknown and repeated ids', () => {
    expect(parseCompareEnvs('dev,nope,stg,dev', ORDER)).toEqual(['dev', 'stg']);
  });

  test('caps the list at three', () => {
    expect(parseCompareEnvs('dev,stg,prod,qa', [...ORDER, 'qa'])).toEqual(['dev', 'stg', 'prod']);
  });

  test('falls back to the last two environments when fewer than two are valid', () => {
    expect(parseCompareEnvs(undefined, ORDER)).toEqual(['stg', 'prod']);
    expect(parseCompareEnvs('', ORDER)).toEqual(['stg', 'prod']);
    expect(parseCompareEnvs('dev', ORDER)).toEqual(['stg', 'prod']);
    expect(parseCompareEnvs('x,y', ORDER)).toEqual(['stg', 'prod']);
  });

  test('tolerates spaces and empty entries', () => {
    expect(parseCompareEnvs(' dev , ,stg', ORDER)).toEqual(['dev', 'stg']);
  });
});

describe('defaults and urls', () => {
  test('the default pair is the last two in promotion order', () => {
    expect(defaultComparePair(ORDER)).toEqual(['stg', 'prod']);
    expect(defaultComparePair(['only'])).toEqual(['only']);
  });

  test('serializes and builds a compare url', () => {
    expect(serializeCompareEnvs(['stg', 'prod'])).toBe('stg,prod');
    expect(compareUrl(['stg', 'prod'])).toBe('/compare?envs=stg%2Cprod');
    expect(parseCompareEnvs('stg,prod', ORDER)).toEqual(['stg', 'prod']);
  });
});

describe('withCompareSlot', () => {
  test('replaces a slot', () => {
    expect(withCompareSlot(['stg', 'prod'], 0, 'dev')).toEqual(['dev', 'prod']);
  });

  test('swaps when the environment is already shown elsewhere', () => {
    expect(withCompareSlot(['stg', 'prod'], 0, 'prod')).toEqual(['prod', 'stg']);
  });

  test('adds a third slot and removes it again', () => {
    const three = withCompareSlot(['stg', 'prod'], 2, 'dev');
    expect(three).toEqual(['stg', 'prod', 'dev']);
    expect(withCompareSlot(three, 2, null)).toEqual(['stg', 'prod']);
  });

  test('never drops below two environments', () => {
    expect(withCompareSlot(['stg', 'prod'], 1, null)).toEqual(['stg', 'prod']);
  });
});
