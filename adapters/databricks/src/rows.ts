// SPDX-License-Identifier: Apache-2.0
// Typed views over statement rows. Every cell arrives as a string or null (JSON_ARRAY), and any
// column may be missing when a fork overrides a query, so every accessor tolerates absence.
import type { Row } from './contracts.js';
import { parseTimestamp } from './time.js';

export type Tags = Readonly<Record<string, string>>;

export function text(row: Row, column: string): string | undefined {
  const value = row[column];
  return value === null || value === undefined || value === '' ? undefined : value;
}

export function integer(row: Row, column: string): number {
  const parsed = Number(row[column]);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function amount(row: Row, column: string): number {
  const parsed = Number(row[column]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function time(row: Row, column: string): number | undefined {
  return parseTimestamp(row[column]);
}

/** Parses a JSON object of string values (a `to_json(map)` cell). Bad input yields no tags. */
export function parseTags(raw: string | null | undefined): Tags {
  if (raw === null || raw === undefined || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') tags[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') tags[key] = String(value);
  }
  return tags;
}

/** True when every required tag is present with a case-insensitive equal value. */
export function tagsContain(actual: Tags, required: Tags): boolean {
  const lowered = new Map(Object.entries(actual).map(([k, v]) => [k.toLowerCase(), v]));
  return Object.entries(required).every(
    ([key, value]) => lowered.get(key.toLowerCase())?.toLowerCase() === value.toLowerCase(),
  );
}

/** Lowercase `catalog.schema`, the key used for schema lookups. */
export function schemaKey(catalog: string, schema: string): string {
  return `${catalog}.${schema}`.toLowerCase();
}

/** Lowercase, URL-safe id derived from a platform name. */
export function slug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'unnamed' : cleaned;
}
