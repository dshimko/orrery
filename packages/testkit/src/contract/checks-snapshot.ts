// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology } from '@orrery/core';
import { ensure, ensureKnown, ensureUnique } from './assert.js';
import { topologyIds } from './ids.js';

const SEVERITIES: readonly string[] = ['incident', 'warning', 'info'];

function ensureUnit(value: number, what: string): void {
  ensure(
    Number.isFinite(value) && value >= 0 && value <= 1,
    `${what} must be in [0,1], got ${value}`,
  );
}

function ensureCount(value: number, what: string): void {
  ensure(
    Number.isInteger(value) && value >= 0,
    `${what} must be a finite non-negative integer, got ${value}`,
  );
}

function checkActivities(snapshot: Snapshot, topology: Topology): void {
  const ids = topologyIds(topology);
  ensureUnit(snapshot.hub.activity, 'hub.activity');
  for (const spoke of snapshot.spokes) {
    ensureKnown(spoke.id, ids.spokes, 'snapshot spoke');
    ensureUnit(spoke.activity, `spoke "${spoke.id}" activity`);
  }
  for (const useCase of snapshot.useCases) {
    ensureKnown(useCase.id, ids.useCases, 'snapshot useCase');
    ensureUnit(useCase.activity, `useCase "${useCase.id}" activity`);
  }
  for (const group of snapshot.sourceGroups) {
    ensureKnown(group.id, ids.sourceGroups, 'snapshot sourceGroup');
    ensureUnit(group.activity, `sourceGroup "${group.id}" activity`);
    for (const site of group.sites) {
      ensureKnown(site.id, ids.sites, 'snapshot site');
      ensureUnit(site.activity, `site "${site.id}" activity`);
    }
  }
  ensureUnit(snapshot.backlog, 'backlog');
  ensureUnit(snapshot.consumerActivity, 'consumerActivity');
}

function checkCountsAndAlerts(snapshot: Snapshot): void {
  for (const [key, value] of Object.entries(snapshot.counts)) ensureCount(value, `counts.${key}`);
  for (const alert of snapshot.alerts) {
    ensure(
      SEVERITIES.includes(alert.severity),
      `alert "${alert.id}" has invalid severity "${alert.severity}"`,
    );
  }
  ensureUnique(
    snapshot.alerts.map((alert) => alert.id),
    'alert',
  );
  snapshot.calendar.days.forEach((day, index) => {
    ensure(
      day.day === index + 1,
      `calendar days must be numbered 1..n consecutively; position ${index + 1} has day ${day.day}`,
    );
  });
}

export function checkSnapshot(snapshot: Snapshot, topology: Topology, at: Date): void {
  ensure(
    snapshot.envId === topology.envId,
    `snapshot.envId "${snapshot.envId}" must equal "${topology.envId}"`,
  );
  ensure(
    snapshot.at === at.toISOString(),
    `snapshot.at "${snapshot.at}" must equal requested ${at.toISOString()}`,
  );
  checkActivities(snapshot, topology);
  checkCountsAndAlerts(snapshot);
}
