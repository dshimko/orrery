// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology } from '@orrery/core';
import type { PickTarget } from '@orrery/render';
import { formatAge, formatPercent } from './format.js';

export interface SelectionInfo {
  title: string;
  lines: string[];
}

/** Text for the selection card; null when the target is not in the data. */
export function describePick(
  target: PickTarget,
  topology: Topology,
  snapshot: Snapshot,
): SelectionInfo | null {
  switch (target.kind) {
    case 'hub':
      return {
        title: topology.hub.name,
        lines: [`Core hub. Activity ${formatPercent(snapshot.hub.activity)}.`],
      };
    case 'shipyard':
      return {
        title: topology.shipyard?.name ?? 'Shipyard',
        lines: ['Builds and releases pipelines.'],
      };
    case 'spoke': {
      const spoke = topology.spokes.find((item) => item.id === target.id);
      if (!spoke) return null;
      const state = snapshot.spokes.find((item) => item.id === target.id);
      const lines = [`${spoke.role === 'ingest' ? 'Ingest spoke' : 'Domain spoke'}.`];
      if (state) {
        const verdict = state.pastTarget ? 'past target' : 'within target';
        lines.push(
          `Data age ${formatAge(state.ageMinutes)} of ${formatAge(state.targetMinutes)} (${verdict}).`,
          `Activity ${formatPercent(state.activity)}.`,
        );
      }
      return { title: spoke.name, lines };
    }
    case 'site': {
      for (const group of topology.sourceGroups) {
        const site = group.sites.find((item) => item.id === target.id);
        if (site) return { title: site.name, lines: [`Source site in ${group.name}.`] };
      }
      return null;
    }
    case 'useCase': {
      const useCase = topology.useCases.find((item) => item.id === target.id);
      if (!useCase) return null;
      const state = snapshot.useCases.find((item) => item.id === target.id);
      const lines = state ? [`Status ${state.status}. ${state.note}`] : [];
      return { title: useCase.name, lines };
    }
    case 'foreign': {
      const catalog = topology.foreignCatalogs.find((item) => item.id === target.id);
      if (!catalog) return null;
      return { title: catalog.name, lines: ['Foreign catalog reached by query federation.'] };
    }
  }
}
