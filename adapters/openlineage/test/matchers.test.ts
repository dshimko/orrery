// SPDX-License-Identifier: Apache-2.0
import type { Matcher } from '@orrery/core';
import { describe, expect, it } from 'vitest';
import {
  datasetSubject,
  jobSubject,
  subjectMatches,
  tagsContain,
  unsupportedClauses,
} from '../src/matchers.js';
import { dataset } from './helpers.js';

const asset = (name: string, namespace = 'lake', tags: Record<string, string> = {}) =>
  datasetSubject(dataset(name, namespace, tags), []);

describe('subjectMatches', () => {
  it('matches the catalog glob against the namespace, case-insensitively', () => {
    expect(subjectMatches({ catalog: 'lake*' }, asset('a.b', 'LAKE_PROD'))).toBe(true);
    expect(subjectMatches({ catalog: 'lake' }, asset('a.b', 'other'))).toBe(false);
  });

  it('matches the schema glob against the whole name or its first dotted segment', () => {
    expect(subjectMatches({ schema: 'public' }, asset('public.menus'))).toBe(true);
    expect(subjectMatches({ schema: 'public.men*' }, asset('public.menus'))).toBe(true);
    expect(subjectMatches({ schema: 'public.men*' }, asset('public.drivers'))).toBe(false);
    expect(subjectMatches({ schema: 'menus' }, asset('public.menus'))).toBe(false);
    expect(subjectMatches({ schema: 'orders' }, asset('orders'))).toBe(true);
  });

  it('requires every clause to match', () => {
    const matcher: Matcher = { catalog: 'lake', schema: 'raw.*' };
    expect(subjectMatches(matcher, asset('raw.a'))).toBe(true);
    expect(subjectMatches(matcher, asset('raw.a', 'other'))).toBe(false);
    expect(subjectMatches(matcher, asset('mart.a'))).toBe(false);
  });

  it('matches dataset tags from the tags facet, ignoring case', () => {
    const subject = asset('a', 'lake', { Domain: 'Sales' });
    expect(subjectMatches({ tag: { domain: 'sales' } }, subject)).toBe(true);
    expect(subjectMatches({ tag: { domain: 'ops' } }, subject)).toBe(false);
    expect(subjectMatches({ tag: { missing: 'x' } }, subject)).toBe(false);
  });

  it('matches jobTag and pipelineTag against the producing jobs of a dataset', () => {
    const subject = datasetSubject(dataset('a'), [{ team: 'x' }, { team: 'y', kind: 'etl' }]);
    expect(subjectMatches({ jobTag: { team: 'y' } }, subject)).toBe(true);
    expect(subjectMatches({ pipelineTag: { kind: 'etl' } }, subject)).toBe(true);
    // Both tags must be on the same job.
    expect(subjectMatches({ jobTag: { team: 'x', kind: 'etl' } }, subject)).toBe(false);
    expect(subjectMatches({ jobTag: { team: 'z' } }, datasetSubject(dataset('a'), []))).toBe(false);
  });

  it('matches a job by name, namespace, and its own tags', () => {
    const job = jobSubject({
      namespace: 'jobs',
      name: 'load_orders',
      tags: { processingType: 'BATCH' },
      streaming: false,
    });
    expect(subjectMatches({ schema: 'load_*' }, job)).toBe(true);
    expect(subjectMatches({ catalog: 'jobs' }, job)).toBe(true);
    expect(subjectMatches({ jobTag: { processingType: 'batch' } }, job)).toBe(true);
    expect(subjectMatches({ tag: { processingType: 'STREAMING' } }, job)).toBe(false);
  });

  it('never matches a matcher that uses a clause events cannot answer', () => {
    expect(subjectMatches({ catalog: 'lake', sqlPredicate: 'x = 1' }, asset('a'))).toBe(false);
    expect(subjectMatches({ dashboardTag: { use_case: 'x' } }, asset('a'))).toBe(false);
    expect(unsupportedClauses({ sqlPredicate: 'x', dashboardTag: { a: 'b' } })).toEqual([
      'sqlPredicate',
      'dashboardTag',
    ]);
    expect(unsupportedClauses({ catalog: 'x' })).toEqual([]);
  });
});

describe('tagsContain', () => {
  it('needs every wanted key', () => {
    expect(tagsContain({ a: '1', b: '2' }, { a: '1' })).toBe(true);
    expect(tagsContain({ a: '1' }, { a: '1', b: '2' })).toBe(false);
  });
});
