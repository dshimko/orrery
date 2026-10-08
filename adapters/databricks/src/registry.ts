// SPDX-License-Identifier: Apache-2.0
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AllowedQuery, QuerySource } from './contracts.js';
import { assertReadOnly } from './readonly.js';

const QUERY_NAME = /^[a-z][a-z0-9_]*$/;
const SQL_SUFFIX = '.sql';
const MAX_QUERY_BYTES = 256 * 1024;

export interface QueryRegistryOptions {
  /** Directory of shipped queries. Defaults to the adapter's own `sql/` directory. */
  shippedDir?: string;
  /** Fork directory: a same-named file overrides a shipped query; other valid names are added. */
  overrideDir?: string;
}

function defaultShippedDir(): string {
  return fileURLToPath(new URL('../sql/', import.meta.url));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

async function loadDirectory(dir: string): Promise<AllowedQuery[]> {
  let root: string;
  let entries: string[];
  try {
    root = await realpath(dir);
    entries = await readdir(root);
  } catch (error) {
    throw new Error(`Query directory "${dir}" cannot be read: ${describe(error)}`, {
      cause: error,
    });
  }
  const queries: AllowedQuery[] = [];
  for (const entry of entries.filter((e) => e.endsWith(SQL_SUFFIX)).sort()) {
    queries.push(await loadFile(root, entry));
  }
  return queries;
}

async function loadFile(root: string, entry: string): Promise<AllowedQuery> {
  const name = entry.slice(0, -SQL_SUFFIX.length);
  const path = join(root, entry);
  if (!QUERY_NAME.test(name)) {
    throw new Error(`${path}: query file names must match ${QUERY_NAME.source}.sql.`);
  }
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${path}: query files must be regular files, not symlinks.`);
  }
  if (info.size > MAX_QUERY_BYTES) throw new Error(`${path}: query file is too large.`);
  const resolved = await realpath(path);
  if (!resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`${path}: query file resolves outside its directory.`);
  }
  const text = await readFile(resolved, 'utf8');
  return { name, sql: assertReadOnly(path, text), source: path };
}

/** Loads and validates the allowlist. Any invalid file fails the whole load. */
export async function loadQueryRegistry(options: QueryRegistryOptions = {}): Promise<QuerySource> {
  const queries = new Map<string, AllowedQuery>();
  for (const query of await loadDirectory(options.shippedDir ?? defaultShippedDir())) {
    queries.set(query.name, query);
  }
  if (options.overrideDir !== undefined) {
    for (const query of await loadDirectory(options.overrideDir)) {
      queries.set(query.name, query);
    }
  }
  const names = Object.freeze([...queries.keys()].sort());
  return {
    names: () => names,
    get(name: string): AllowedQuery {
      const query = queries.get(name);
      if (query === undefined) throw new Error(`Query "${name}" is not in the allowlist.`);
      return query;
    },
  };
}
