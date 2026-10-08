// SPDX-License-Identifier: Apache-2.0
import { Topology, type TopologyInput, type TopologyOverrides } from './topology.js';
import { formatPath, type ConfigIssue } from './errors.js';

type Listed = { id: string } & Record<string, unknown>;
type ListKey = 'spokes' | 'sourceGroups' | 'useCases';
const LIST_KEYS: readonly ListKey[] = ['spokes', 'sourceGroups', 'useCases'];

export type ResolveResult = { ok: true; topology: Topology } | { ok: false; issues: ConfigIssue[] };

/** Merges `overlay` items into `base` by id: matching ids merge field-wise, new ids append. */
export function mergeById<T extends Listed>(
  base: readonly T[] = [],
  overlay: readonly T[] = [],
): T[] {
  const overlayById = new Map(overlay.map((item) => [item.id, item]));
  const merged = base.map((item) => {
    const patch = overlayById.get(item.id);
    return patch ? ({ ...item, ...patch } as T) : item;
  });
  const baseIds = new Set(base.map((item) => item.id));
  return [...merged, ...overlay.filter((item) => !baseIds.has(item.id))];
}

function applyLayer(base: TopologyInput, layer: TopologyOverrides): TopologyInput {
  const excluded = new Set(layer.exclude ?? []);
  const lists = Object.fromEntries(
    LIST_KEYS.map((key) => [
      key,
      mergeById(base[key] as Listed[] | undefined, layer[key] as Listed[] | undefined).filter(
        (item) => !excluded.has(item.id),
      ),
    ]),
  );
  return {
    ...base,
    ...lists,
    hub: { ...base.hub, ...layer.hub },
    ...(layer.medallion ? { medallion: layer.medallion } : {}),
  };
}

/** Flattens the `extends` chain of a named topology, base first. */
function chainOf(
  name: string,
  topologies: Readonly<Record<string, TopologyInput>>,
): string[] | ConfigIssue {
  const chain: string[] = [];
  let current: string | undefined = name;
  while (current) {
    if (chain.includes(current)) {
      return {
        path: `topologies.${name}.extends`,
        message: `Topology inheritance cycle: ${[...chain, current].join(' -> ')}.`,
      };
    }
    chain.push(current);
    current = topologies[current]?.extends;
  }
  return chain.reverse();
}

/**
 * Resolves an environment's topology: walks `extends` from the root base, applies each layer and
 * then the environment's overrides, and validates the result is complete.
 */
export function resolveTopology(
  name: string,
  topologies: Readonly<Record<string, TopologyInput>>,
  overrides: TopologyOverrides | undefined,
  pathPrefix: string,
): ResolveResult {
  const chain = chainOf(name, topologies);
  if (!Array.isArray(chain)) return { ok: false, issues: [chain] };

  const layered = chain.reduce<TopologyInput>(
    (acc, layerName) => applyLayer(acc, topologies[layerName] ?? {}),
    {},
  );
  const withOverrides = overrides ? applyLayer(layered, overrides) : layered;
  const { extends: _extends, exclude: _exclude, ...candidate } = withOverrides;

  const parsed = Topology.safeParse(candidate);
  if (parsed.success) return { ok: true, topology: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: `${pathPrefix}.${formatPath(issue.path)}`,
      message: `${issue.message} (after resolving topology "${name}")`,
    })),
  };
}
