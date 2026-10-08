// SPDX-License-Identifier: Apache-2.0
// Generates the configuration reference in docs/configuration.md from the committed JSON Schema
// (packages/core/schema/orrery.config.schema.json) and the hand-written descriptions in
// docs/config-descriptions.json, so the reference cannot drift from the schema.
//
//   node scripts/config-reference.mjs            print the generated section
//   node scripts/config-reference.mjs --write    rewrite the section in docs/configuration.md
//   node scripts/config-reference.mjs --check    exit 1 when docs/configuration.md is stale
//
// Path notation: `a.b` is a key, `a[]` is an array item, and `a.*` is any key of a map.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as prettier from 'prettier';

const ROOT = resolve(import.meta.dirname, '..');
export const SCHEMA_FILE = resolve(ROOT, 'packages/core/schema/orrery.config.schema.json');
export const DESCRIPTIONS_FILE = resolve(ROOT, 'docs/config-descriptions.json');
export const DOC_FILE = resolve(ROOT, 'docs/configuration.md');
export const BEGIN_MARKER = '<!-- BEGIN GENERATED -->';
export const END_MARKER = '<!-- END GENERATED -->';

/** The matcher object appears under spokes, source groups, and use cases; it is listed once. */
const MATCHER_PATHS = [
  'topologies.*.spokes[].match',
  'topologies.*.sourceGroups[].match',
  'topologies.*.useCases[].match',
];
const MATCHER_PREFIX = 'match';
/** An environment's overrides have the shape of a topology without `extends`; listed once. */
const COLLAPSED_PATHS = new Set(['environments[].overrides', ...MATCHER_PATHS]);

const ID_PATTERN = '^[a-z0-9][a-z0-9_-]{0,62}$';
const KNOWN_PATTERNS = new Map([
  [ID_PATTERN, 'id: lowercase letters, digits, `-`, `_` (1 to 63 characters)'],
  ['^#[0-9a-fA-F]{6}$', 'hex color `#RRGGBB`'],
  ['^\\$\\{env:([A-Z_][A-Z0-9_]*)\\}$', '`${env:NAME}` reference only'],
  ['^([01]\\d|2[0-3]):[0-5]\\d$', '24-hour UTC time `HH:MM`'],
  [
    '^(hub|spoke|sourceGroup|site|useCase|foreign|metastore|shipyard)(:[a-z0-9][a-z0-9_-]*)?$',
    '`kind:id` such as `spoke:sales`, or a bare kind',
  ],
]);

function joinPath(base, key) {
  return base ? `${base}.${key}` : key;
}

/** Children of `node` as [path, childNode, isRequired] triples, without the node's own row. */
function childrenOf(node, path) {
  if (node.$ref) throw new Error(`${path}: $ref is not supported by the reference generator.`);
  if (node.anyOf) return node.anyOf.flatMap((branch) => childrenOf(branch, path));
  if (node.type === 'object' && node.properties) {
    const required = new Set(node.required ?? []);
    return Object.entries(node.properties).map(([key, child]) => [
      joinPath(path, key),
      child,
      required.has(key),
    ]);
  }
  if (node.type === 'object' && node.additionalProperties?.type === 'object') {
    return childrenOf(node.additionalProperties, `${path}.*`);
  }
  if (node.type === 'array' && node.items && typeof node.items === 'object') {
    return childrenOf(node.items, `${path}[]`);
  }
  return [];
}

function collect(node, path, isRequired, rows) {
  rows.push({ path, node, isRequired });
  if (COLLAPSED_PATHS.has(path)) return;
  for (const [childPath, child, childRequired] of childrenOf(node, path)) {
    collect(child, childPath, childRequired, rows);
  }
}

function nodeAt(schema, path) {
  return collectRowsRaw(schema).find((row) => row.path === path)?.node;
}

function collectRowsRaw(schema) {
  const rows = [];
  for (const [path, node, isRequired] of childrenOf(schema, '')) {
    collect(node, path, isRequired, rows);
  }
  return rows;
}

/**
 * Every documented path, in schema order, followed by the shared matcher keys. Each row is
 * `{ path, node, isRequired }`.
 */
export function collectRows(schema) {
  const rows = collectRowsRaw(schema);
  const matcherNode = nodeAt(schema, MATCHER_PATHS[0]);
  const matcherRows = [];
  for (const [path, child, isRequired] of childrenOf(matcherNode, MATCHER_PREFIX)) {
    collect(child, path, isRequired, matcherRows);
  }
  return [...rows, ...matcherRows];
}

export function collectPaths(schema) {
  return collectRows(schema).map((row) => row.path);
}

function typeOf(node) {
  if (node.anyOf) return node.anyOf.map(typeOf).join(' or ');
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return node.type ?? 'enum';
  if (node.type === 'array') {
    if (node.prefixItems) return `[${node.prefixItems.map(typeOf).join(', ')}]`;
    return `array of ${node.items ? typeOf(node.items) : 'any'}`;
  }
  if (node.type === 'object') {
    if (node.properties) return 'object';
    const value = node.additionalProperties;
    if (!value || Object.keys(value).length === 0) return 'map of any';
    return `map of ${typeOf(value)}`;
  }
  return node.type ?? 'any';
}

function constraintsOf(node) {
  if (node.anyOf) {
    return node.anyOf.flatMap(constraintsOf).filter((item, i, all) => all.indexOf(item) === i);
  }
  const parts = [];
  if (node.enum) parts.push(node.enum.map((value) => `\`${value}\``).join(', '));
  if (node.pattern) parts.push(KNOWN_PATTERNS.get(node.pattern) ?? `pattern \`${node.pattern}\``);
  if (node.minLength !== undefined && node.minLength > 0 && !node.pattern) parts.push('non-empty');
  if (node.minimum !== undefined) parts.push(`>= ${node.minimum}`);
  if (node.exclusiveMinimum !== undefined) parts.push(`> ${node.exclusiveMinimum}`);
  if (node.maximum !== undefined) parts.push(`<= ${node.maximum}`);
  if (node.minItems !== undefined && !node.prefixItems)
    parts.push(`at least ${node.minItems} item`);
  if (node.propertyNames?.pattern) {
    const keyRule = KNOWN_PATTERNS.get(node.propertyNames.pattern);
    if (keyRule) parts.push(`keys are ${keyRule}`);
  }
  if (node.type === 'array' && node.items && typeof node.items === 'object') {
    const inner = constraintsOf(node.items).filter((item) => !item.startsWith('non-empty'));
    parts.push(...inner.map((item) => `items: ${item}`));
  }
  if (node.type === 'object' && node.additionalProperties && !node.properties) {
    const inner = constraintsOf(node.additionalProperties);
    parts.push(...inner.map((item) => `values: ${item}`));
  }
  return parts;
}

function defaultOf(node) {
  if (node.default === undefined) return '';
  if (
    typeof node.default === 'object' &&
    Object.keys(node.default).length === 0 &&
    !Array.isArray(node.default)
  ) {
    return '';
  }
  return `\`${JSON.stringify(node.default)}\``;
}

function cell(text) {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function describeRow(row, descriptions) {
  const description = descriptions[row.path];
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`Missing description for "${row.path}" in docs/config-descriptions.json.`);
  }
  const constraints = constraintsOf(row.node).join('; ');
  return `| \`${row.path}\` | ${cell(typeOf(row.node))} | ${row.isRequired ? 'yes' : ''} | ${cell(
    defaultOf(row.node),
  )} | ${cell(constraints)} | ${cell(description.trim())} |`;
}

const TABLE_HEADER = [
  '| Path | Type | Required | Default | Allowed | Description |',
  '| --- | --- | --- | --- | --- | --- |',
];

function sectionOf(path) {
  const first = path.split(/[.[]/)[0] ?? path;
  return first === MATCHER_PREFIX ? 'match' : first;
}

/** Groups rows by top-level key, keeping schema order. */
function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = sectionOf(row.path);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

const SECTION_TITLES = new Map([['match', 'Matcher keys (`match`)']]);

/** The generated Markdown, without the surrounding markers, formatted as `prettier` would. */
export async function generateReference(schema, descriptions) {
  const rows = collectRows(schema);
  const lines = [
    '_Generated by `scripts/config-reference.mjs` from `packages/core/schema/orrery.config.schema.json`',
    'and `docs/config-descriptions.json`. Run `pnpm docs:config` after changing either. Do not edit',
    'this section by hand._',
    '',
    'Path notation: `a.b` is a key, `a[]` is an item of a list, and `a.*` is any key of a map.',
    '',
  ];
  for (const [section, sectionRows] of groupRows(rows)) {
    lines.push(`### ${SECTION_TITLES.get(section) ?? `\`${section}\``}`, '', ...TABLE_HEADER);
    lines.push(...sectionRows.map((row) => describeRow(row, descriptions)), '');
  }
  const options = (await prettier.resolveConfig(DOC_FILE)) ?? {};
  return prettier.format(`${lines.join('\n').trimEnd()}\n`, { ...options, parser: 'markdown' });
}

/** Replaces the text between the markers, or throws when a marker is missing. */
export function replaceSection(document, generated) {
  const begin = document.indexOf(BEGIN_MARKER);
  const end = document.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`docs/configuration.md needs ${BEGIN_MARKER} and ${END_MARKER} markers.`);
  }
  return `${document.slice(0, begin + BEGIN_MARKER.length)}\n\n${generated}\n${document.slice(end)}`;
}

export function loadInputs() {
  return {
    schema: JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')),
    descriptions: JSON.parse(readFileSync(DESCRIPTIONS_FILE, 'utf8')),
  };
}

async function main(args) {
  const { schema, descriptions } = loadInputs();
  const generated = await generateReference(schema, descriptions);
  const current = readFileSync(DOC_FILE, 'utf8');
  const next = replaceSection(current, generated);
  if (args.includes('--write')) {
    writeFileSync(DOC_FILE, next);
    console.log(`Wrote the configuration reference to docs/configuration.md`);
  } else if (args.includes('--check')) {
    if (next !== current) {
      console.error(
        'docs/configuration.md is stale. Run `pnpm docs:config` and commit the result.',
      );
      process.exit(1);
    }
    console.log('Configuration reference: up to date');
  } else {
    process.stdout.write(generated);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
