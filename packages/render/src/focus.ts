// SPDX-License-Identifier: Apache-2.0
// Camera focus targets and the accessible summary of the scene.
import type { SceneModel } from './sim/model.js';
import { ORIGIN, type Vec3 } from './sim/math.js';
import type { PickTarget } from './types.js';

const FOCUS_DISTANCE = {
  hub: 30,
  spoke: 28,
  site: 30,
  useCase: 20,
  foreign: 40,
  shipyard: 34,
} as const;

/** Live position getter for a pick target; the camera follows it as the body moves. */
export function focusPosition(model: SceneModel, target: PickTarget): () => Vec3 {
  switch (target.kind) {
    case 'spoke':
      return () => model.spokeById.get(target.id)?.pos ?? ORIGIN;
    case 'site':
      return () => model.siteById.get(target.id)?.pos ?? ORIGIN;
    case 'useCase':
      return () => model.stationById.get(target.id)?.pos ?? ORIGIN;
    case 'foreign':
      return () => model.cometById.get(target.id)?.pos ?? ORIGIN;
    case 'shipyard':
      return () => model.yard;
    default:
      return () => ORIGIN;
  }
}

export const focusDistance = (target: PickTarget): number => FOCUS_DISTANCE[target.kind];

/** One-sentence summary for the canvas's aria-label. */
export function describeScene(model: SceneModel): string {
  const { topology, snapshot } = model;
  const parts = [
    `${topology.spokes.length} spokes`,
    `${model.siteById.size} source sites`,
    `${topology.useCases.length} use cases`,
    `${topology.foreignCatalogs.length} foreign catalogs`,
    `${snapshot.alerts.length} open alerts`,
  ];
  return `${topology.hub.name} system view: ${parts.join(', ')}.`;
}

/** Applies the first snapshot's activity levels so the scene does not fade up from zero. */
export function primeLevels(model: SceneModel): void {
  const { snapshot } = model;
  for (const group of snapshot.sourceGroups) {
    for (const site of group.sites) {
      const body = model.siteById.get(site.id);
      if (body) body.activity = site.activity;
    }
  }
  for (const state of snapshot.useCases) {
    const station = model.stationById.get(state.id);
    if (station) station.activity = state.activity;
  }
}
