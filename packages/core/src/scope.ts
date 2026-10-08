// SPDX-License-Identifier: Apache-2.0
// Environment scoping by catalog name (spec: Configuration model, "Environment scope").
// An environment owns the catalogs matching its `scope.catalogs` globs, case-insensitively, or
// carrying all of its `scope.tag` tags. The text a glob's single `*` captured is the catalog's
// base name, so `dev_sales` and `sales_dev` both resolve to `sales` for spoke matching. Only the
// first `*` is the base; later ones are matched but ignored. A `*` that captures nothing does not
// match (`dev_` is not in `dev_*`), since it would leave the catalog without a base name.
import type { ResolvedEnvironment } from './config/load.js';

const SPECIAL = /[.+^${}()|[\]\\]/g;

/** Compiles a `*`/`?` glob to a case-insensitive, fully anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const source = glob.replace(SPECIAL, '\\$&').replace(/\*/g, '(.*)').replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i');
}

export function matchGlob(glob: string, value: string): boolean {
  return globToRegExp(glob).test(value);
}

export interface CatalogInfo {
  name: string;
  tags?: Readonly<Record<string, string>>;
}

export interface ScopedCatalog {
  catalog: string;
  /** Catalog name with the environment tag stripped (lowercase). */
  base: string;
}

/** The base name if `catalog` is in `env`'s scope, else undefined. */
export function scopeMatch(
  env: Pick<ResolvedEnvironment, 'scope'>,
  catalog: CatalogInfo,
): string | undefined {
  const scope = env.scope;
  if (!scope) return undefined;
  for (const glob of scope.catalogs ?? []) {
    const match = globToRegExp(glob).exec(catalog.name);
    if (!match || match[1] === '') continue;
    return (match[1] ?? catalog.name).toLowerCase();
  }
  const tag = scope.tag;
  if (tag && Object.keys(tag).length > 0) {
    const tags = catalog.tags ?? {};
    const all = Object.entries(tag).every(
      ([key, value]) => (tags[key] ?? '').toLowerCase() === value.toLowerCase(),
    );
    if (all) return catalog.name.toLowerCase();
  }
  return undefined;
}

export interface ScopeResult {
  byEnv: ReadonlyMap<string, readonly ScopedCatalog[]>;
  /** Catalogs claimed by more than one environment: a configuration error. */
  conflicts: readonly { catalog: string; envIds: readonly string[] }[];
  /** Catalogs no environment claims; listed in each environment's health check. */
  unmatched: readonly string[];
}

/** Assigns catalogs to environments that declare a scope. */
export function assignCatalogs(
  catalogs: readonly CatalogInfo[],
  environments: readonly Pick<ResolvedEnvironment, 'id' | 'scope'>[],
): ScopeResult {
  const scoped = environments.filter((env) => env.scope);
  const byEnv = new Map<string, ScopedCatalog[]>(scoped.map((env) => [env.id, []]));
  const conflicts: { catalog: string; envIds: string[] }[] = [];
  const unmatched: string[] = [];
  for (const catalog of catalogs) {
    const hits = scoped.flatMap((env) => {
      const base = scopeMatch(env, catalog);
      return base === undefined ? [] : [{ envId: env.id, base }];
    });
    if (hits.length === 0) unmatched.push(catalog.name);
    if (hits.length > 1)
      conflicts.push({ catalog: catalog.name, envIds: hits.map((h) => h.envId) });
    for (const hit of hits) byEnv.get(hit.envId)?.push({ catalog: catalog.name, base: hit.base });
  }
  return { byEnv, conflicts, unmatched };
}

/** Human-readable conflict message naming both environments (spec: fails validation). */
export function conflictMessage(conflict: { catalog: string; envIds: readonly string[] }): string {
  return `Catalog "${conflict.catalog}" matches more than one environment: ${conflict.envIds.join(', ')}. Narrow their scope.catalogs or scope.tag.`;
}
