// SPDX-License-Identifier: Apache-2.0
import type { ResolvedEnvironment, Topology } from '@orrery/core';
import { ensure, ensureKnown, ensureUnique } from './assert.js';

export function checkTopology(topology: Topology, env: ResolvedEnvironment): void {
  ensure(
    topology.envId === env.id,
    `topology.envId "${topology.envId}" must equal env.id "${env.id}"`,
  );
  ensure(topology.hub.id.length > 0, 'topology.hub.id must be non-empty');

  const spokeIds = topology.spokes.map((spoke) => spoke.id);
  ensureUnique(spokeIds, 'spoke');
  const configured = new Set(env.resolvedTopology.spokes.map((spoke) => spoke.id));
  for (const id of spokeIds) ensureKnown(id, configured, 'spoke (from env.resolvedTopology)');

  const spokes = new Set(spokeIds);
  for (const useCase of topology.useCases) {
    for (const id of useCase.reads) ensureKnown(id, spokes, `useCase "${useCase.id}" reads spoke`);
  }

  const siteIds = topology.sourceGroups.flatMap((group) => group.sites.map((site) => site.id));
  ensureUnique(siteIds, 'site');

  const metastores = new Set(topology.metastores.map((metastore) => metastore.id));
  for (const spoke of topology.spokes) {
    ensureKnown(spoke.metastore, metastores, `spoke "${spoke.id}" metastore`);
  }
}
