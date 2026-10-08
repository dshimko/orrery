// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BEGIN_MARKER,
  DOC_FILE,
  END_MARKER,
  collectPaths,
  generateReference,
  loadInputs,
  replaceSection,
} from './config-reference.mjs';

const { schema, descriptions } = loadInputs() as {
  schema: Record<string, unknown>;
  descriptions: Record<string, string>;
};

describe('configuration reference', () => {
  it('documents every key of the JSON Schema', () => {
    const paths = collectPaths(schema) as string[];
    const missing = paths.filter((path) => !descriptions[path]?.trim());
    expect(missing, 'paths without a description in docs/config-descriptions.json').toEqual([]);
  });

  it('has no descriptions for keys that are not in the schema', () => {
    const paths = new Set(collectPaths(schema) as string[]);
    const stale = Object.keys(descriptions).filter((path) => !paths.has(path));
    expect(stale, 'stale keys in docs/config-descriptions.json').toEqual([]);
  });

  it('matches the generated section committed in docs/configuration.md', async () => {
    const document = readFileSync(DOC_FILE, 'utf8');
    const generated = await generateReference(schema, descriptions);
    expect(
      replaceSection(document, generated) === document,
      'docs/configuration.md is stale: run `pnpm docs:config`',
    ).toBe(true);
  });

  it('lists nested keys, list items, and map values with a stable path notation', () => {
    const paths = collectPaths(schema) as string[];
    expect(paths).toContain('environments[].scope.catalogs');
    expect(paths).toContain('topologies.*.spokes[].freshness.targetMinutes');
    expect(paths).toContain('visuals.orloj.dial.center');
    expect(paths).toContain('match.sqlPredicate');
  });

  it('fails loudly when a description is missing', async () => {
    const { 'product.title': _removed, ...rest } = descriptions;
    await expect(generateReference(schema, rest)).rejects.toThrow(/product\.title/);
  });

  it('requires both markers when replacing the section', () => {
    expect(() => replaceSection('no markers', 'x')).toThrow(/markers/);
    expect(replaceSection(`a\n${BEGIN_MARKER}\nold\n${END_MARKER}\nb`, 'new\n')).toBe(
      `a\n${BEGIN_MARKER}\n\nnew\n\n${END_MARKER}\nb`,
    );
  });
});
