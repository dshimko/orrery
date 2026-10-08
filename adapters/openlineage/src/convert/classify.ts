// SPDX-License-Identifier: Apache-2.0
// What a finished run draws: the spoke roles it touches decide the vehicle.
//
//   writes an ingest spoke, from a matched source group   source.batch (source.stream when streaming)
//   writes an ingest spoke, from anywhere else            transfer (ingest to hub)
//   writes a domain spoke, reading that spoke too         product.publish (domain to hub)
//   writes a domain spoke, reading elsewhere              copy (hub to domain)
//   writes only hub datasets (consumed by other jobs)     transfer, from the ingest spoke it reads
import { groupOf, siteOf, sourcesOf, spokeOf, useCasesOf, type ModelCore } from '../model.js';
import type { Run } from '../runs.js';
import { datasetKey, type DatasetRef } from '../types.js';

export type Tier = 'bronze' | 'silver' | 'gold';

export type RunClass =
  | {
      type: 'source.stream' | 'source.batch';
      tier: 'bronze';
      spokeId: string;
      groupId: string;
      siteId: string;
    }
  | { type: 'transfer' | 'copy'; tier: 'silver'; spokeId: string }
  | { type: 'product.publish'; tier: 'gold'; spokeId: string };

/** Distinct spokes of `refs`, in config order. */
function spokesOf(model: ModelCore, refs: readonly DatasetRef[]): string[] {
  const ids = new Set(refs.map((ref) => spokeOf(model, ref)));
  return model.spokes.map((spoke) => spoke.id).filter((id) => ids.has(id));
}

export const writtenSpokes = (model: ModelCore, run: Run): string[] => spokesOf(model, run.outputs);
export const readSpokes = (model: ModelCore, run: Run): string[] => spokesOf(model, run.inputs);

function roleOf(model: ModelCore, spokeId: string): 'ingest' | 'domain' | undefined {
  return model.spokes.find((spoke) => spoke.id === spokeId)?.role;
}

function ingestClass(model: ModelCore, run: Run, spokeId: string): RunClass {
  for (const source of sourcesOf(model, run)) {
    const group = groupOf(model.groups, source);
    const siteId = group ? siteOf(group, source.key) : undefined;
    if (group && siteId !== undefined) {
      const type = run.job.streaming ? 'source.stream' : 'source.batch';
      return { type, tier: 'bronze', spokeId, groupId: group.id, siteId };
    }
  }
  return { type: 'transfer', tier: 'silver', spokeId };
}

export function hasHubOutput(model: ModelCore, run: Run): boolean {
  return run.outputs.some(
    (ref) =>
      spokeOf(model, ref) === undefined &&
      (model.datasets.get(datasetKey(ref))?.consumers.size ?? 0) > 0,
  );
}

/** The vehicles a run draws when it completes (or, for streaming, heartbeats). */
export function classifyRun(model: ModelCore, run: Run): RunClass[] {
  const written = writtenSpokes(model, run);
  const read = readSpokes(model, run);
  const classes = written.flatMap((spokeId): RunClass[] => {
    if (roleOf(model, spokeId) === 'ingest') return [ingestClass(model, run, spokeId)];
    return read.includes(spokeId)
      ? [{ type: 'product.publish', tier: 'gold', spokeId }]
      : [{ type: 'copy', tier: 'silver', spokeId }];
  });
  if (classes.length > 0 || !hasHubOutput(model, run)) return classes;
  const from = read.find((spokeId) => roleOf(model, spokeId) === 'ingest');
  return from === undefined ? [] : [{ type: 'transfer', tier: 'silver', spokeId: from }];
}

/** The spokes a sink job reads: those of its inputs, or of its outputs when it has no inputs. */
export function consumedSpokes(model: ModelCore, run: Run): string[] {
  const read = readSpokes(model, run);
  return read.length > 0 ? read : writtenSpokes(model, run);
}

/** Serving reads of a sink run: each matching use case reads from each spoke the job reads. */
export function serveReads(model: ModelCore, run: Run): { useCaseId: string; spokeId: string }[] {
  const useCases = useCasesOf(model, run);
  const spokes = consumedSpokes(model, run);
  return useCases.flatMap((useCase) =>
    spokes.map((spokeId) => ({ useCaseId: useCase.id, spokeId })),
  );
}
