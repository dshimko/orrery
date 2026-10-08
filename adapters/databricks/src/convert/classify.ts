// SPDX-License-Identifier: Apache-2.0
// Decides which vehicle a completed pipeline or job represents, from the spoke role and tier it
// writes to (spec: batch to the ingest spoke, transfers to the hub, copies out, gold products).
import type { Model, ModelObject, Tier } from '../discovery/types.js';

export type RunClass =
  | { type: 'source.stream' | 'source.batch'; tier: 'bronze'; groupId: string; spokeId: string }
  | { type: 'transfer'; tier: Tier; spokeId: string }
  | { type: 'copy' | 'product.publish'; tier: Tier; spokeId: string }
  | { type: 'ml.run'; spokeId: string };

/** The vehicle a completed run of `object` produces; undefined when it has no place in the scene. */
export function classifyObject(model: Model, object: ModelObject): RunClass | undefined {
  const spokeId = object.spokeId;
  if (spokeId === undefined) return undefined;
  if (object.isMl) return { type: 'ml.run', spokeId };
  const role = model.spokes.get(spokeId)?.role;
  if (role === 'ingest') {
    if (object.tier !== 'bronze') return { type: 'transfer', tier: object.tier, spokeId };
    const groupId = object.groupId ?? model.defaultGroupId;
    if (groupId === undefined) return undefined;
    return {
      type: object.streaming ? 'source.stream' : 'source.batch',
      tier: 'bronze',
      groupId,
      spokeId,
    };
  }
  return { type: object.tier === 'gold' ? 'product.publish' : 'copy', tier: object.tier, spokeId };
}

/** The vehicle a lineage write into a schema of `spokeId` and `tier` produces. */
export function classifyWrite(
  model: Model,
  spokeId: string,
  tier: Tier | undefined,
): RunClass | undefined {
  const role = model.spokes.get(spokeId)?.role;
  if (role === 'ingest') {
    return tier === 'silver' || tier === 'gold' ? { type: 'transfer', tier, spokeId } : undefined;
  }
  return { type: tier === 'gold' ? 'product.publish' : 'copy', tier: tier ?? 'silver', spokeId };
}
