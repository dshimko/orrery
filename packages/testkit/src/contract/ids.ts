// SPDX-License-Identifier: Apache-2.0
import type { Topology } from '@orrery/core';

export interface TopologyIds {
  hub: string;
  spokes: ReadonlySet<string>;
  sites: ReadonlySet<string>;
  sourceGroups: ReadonlySet<string>;
  useCases: ReadonlySet<string>;
  foreignCatalogs: ReadonlySet<string>;
}

export function topologyIds(topology: Topology): TopologyIds {
  return {
    hub: topology.hub.id,
    spokes: new Set(topology.spokes.map((spoke) => spoke.id)),
    sites: new Set(topology.sourceGroups.flatMap((group) => group.sites.map((site) => site.id))),
    sourceGroups: new Set(topology.sourceGroups.map((group) => group.id)),
    useCases: new Set(topology.useCases.map((useCase) => useCase.id)),
    foreignCatalogs: new Set(topology.foreignCatalogs.map((catalog) => catalog.id)),
  };
}
