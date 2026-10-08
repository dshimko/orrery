// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Visuals } from '@orrery/core';
import { clamp } from './format.js';
import type { FiguresModel, IncidentLevel } from './types.js';

/** Spend per hour at which the miser's purse is full (reference scale). */
const SPEND_FULL_PURSE = 520;
const MIN_PURSE = 0.25;

export function buildFigures(
  snapshot: Snapshot,
  spokeCount: number,
  colors: Visuals['colors'],
): FiguresModel {
  const open = snapshot.counts.openIncidents;
  const hasIncident = snapshot.alerts.some((a) => a.severity === 'incident');
  const incidentLevel: IncidentLevel = open <= 0 ? 'none' : hasIncident ? 'incident' : 'warning';
  return {
    spend: Math.round(snapshot.spendPerHour),
    purseTarget: clamp(snapshot.spendPerHour / SPEND_FULL_PURSE, MIN_PURSE, 1),
    spokesPastTarget: snapshot.counts.spokesPastTarget,
    spokeCount,
    openIncidents: open,
    incidentLevel,
    incidentColor: incidentLevel === 'incident' ? colors.incident : colors.warning,
    incidentTitles: snapshot.alerts.filter((a) => a.severity !== 'info').map((a) => a.title),
    consumerActivity: clamp(snapshot.consumerActivity, 0, 1),
  };
}
