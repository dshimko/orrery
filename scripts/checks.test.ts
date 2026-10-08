// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { findTerms, parseDenylist } from './check-denylist.mjs';
import { findViolations, isAllowed } from './check-licenses.mjs';
import { hasHeader, needsHeader } from './check-spdx.mjs';

describe('license allowlist', () => {
  it.each([
    ['MIT', true],
    ['Apache-2.0', true],
    ['(MIT OR GPL-3.0)', true],
    ['MIT AND ISC', true],
    ['MIT AND GPL-3.0', false],
    ['MPL-2.0', false],
    ['LGPL-3.0', false],
    ['UNLICENSED', false],
    ['OFL-1.1', false],
  ])('%s -> %s', (expression, expected) => {
    expect(isAllowed(expression, 'some-pkg')).toBe(expected);
  });

  it('allows OFL-1.1 only for font packages', () => {
    expect(isAllowed('OFL-1.1', '@fontsource/cinzel')).toBe(true);
  });

  it('honours dev exceptions but never in production', () => {
    const pkg = { name: 'minimatch', license: 'BlueOak-1.0.0' };
    const exceptions = [{ package: 'minimatch', license: 'BlueOak-1.0.0' }];
    expect(findViolations([pkg], [], exceptions)).toEqual([]);
    expect(findViolations([pkg], [pkg], exceptions)).toEqual([{ ...pkg, inProduction: true }]);
    expect(findViolations([{ ...pkg, license: 'GPL-3.0' }], [], exceptions)).toHaveLength(1);
  });
});

describe('denylist', () => {
  it('parses terms, ignoring comments and blank lines', () => {
    expect(parseDenylist('# org names\nAcme Corp\n\n  Site Nine  # plant\n')).toEqual([
      'Acme Corp',
      'Site Nine',
    ]);
  });

  it('matches whole words case-insensitively with line numbers', () => {
    const text = 'name: Region A\nhost: acme corp internal\nacmecorporation is fine';
    expect(findTerms(text, ['Acme Corp'])).toEqual([{ term: 'Acme Corp', line: 2 }]);
  });

  it('treats regex characters in terms literally', () => {
    expect(findTerms('a.b.c', ['a.b'])).toHaveLength(1);
    expect(findTerms('axb', ['a.b'])).toHaveLength(0);
  });
});

describe('SPDX headers', () => {
  it('requires headers on source files but not on references or lockfiles', () => {
    expect(needsHeader('packages/core/src/index.ts')).toBe(true);
    expect(needsHeader('config/examples/three-env.yaml')).toBe(true);
    expect(needsHeader('.githooks/pre-commit')).toBe(true);
    expect(needsHeader('reference/system-view.html')).toBe(false);
    expect(needsHeader('pnpm-lock.yaml')).toBe(false);
    expect(needsHeader('README.md')).toBe(false);
  });

  it('finds the header only near the top', () => {
    expect(hasHeader('// SPDX-License-Identifier: Apache-2.0\nexport {};')).toBe(true);
    expect(hasHeader(`${'\n'.repeat(10)}// SPDX-License-Identifier: Apache-2.0`)).toBe(false);
  });
});
