// SPDX-License-Identifier: Apache-2.0
import { PLATFORM_EVENT_TYPES, type PlatformEvent, type Topology } from '@orrery/core';
import { ensure, ensureKnown } from './assert.js';
import { topologyIds, type TopologyIds } from './ids.js';

function checkReferences(event: PlatformEvent, ids: TopologyIds): void {
  switch (event.type) {
    case 'source.stream':
    case 'source.batch':
      ensureKnown(event.sourceGroupId, ids.sourceGroups, `${event.type} sourceGroupId`);
      ensureKnown(event.siteId, ids.sites, `${event.type} siteId`);
      ensureKnown(event.spokeId, ids.spokes, `${event.type} spokeId`);
      return;
    case 'ingest.gate':
    case 'freshness.change':
    case 'ml.run':
      ensureKnown(event.spokeId, ids.spokes, `${event.type} spokeId`);
      return;
    case 'transfer':
      ensureKnown(event.fromSpokeId, ids.spokes, 'transfer fromSpokeId');
      ensure(event.hubId === ids.hub, `transfer hubId "${event.hubId}" must be "${ids.hub}"`);
      return;
    case 'copy':
    case 'product.publish':
      ensureKnown(event.spokeId, ids.spokes, `${event.type} spokeId`);
      ensure(event.hubId === ids.hub, `${event.type} hubId "${event.hubId}" must be "${ids.hub}"`);
      return;
    case 'serve.read':
      ensureKnown(event.useCaseId, ids.useCases, 'serve.read useCaseId');
      ensureKnown(event.spokeId, ids.spokes, 'serve.read spokeId');
      return;
    case 'federation.query':
      ensureKnown(event.foreignCatalogId, ids.foreignCatalogs, 'federation.query foreignCatalogId');
      return;
    case 'deploy':
      if (event.spokeId !== undefined) ensureKnown(event.spokeId, ids.spokes, 'deploy spokeId');
      return;
    default:
      return;
  }
}

function checkOrdering(events: readonly PlatformEvent[], since: Date, until: Date): void {
  let previous = -Infinity;
  for (const event of events) {
    const ts = Date.parse(event.ts);
    ensure(Number.isFinite(ts), `event ${event.type} has invalid ts "${event.ts}"`);
    ensure(
      ts >= since.getTime() && ts < until.getTime(),
      `event ${event.type} ts ${event.ts} is outside [${since.toISOString()}, ${until.toISOString()})`,
    );
    ensure(ts >= previous, `event ${event.type} ts ${event.ts} is earlier than the previous event`);
    previous = ts;
  }
}

function checkAlertCloses(
  events: readonly PlatformEvent[],
  openAtSince: ReadonlySet<string>,
): void {
  const opened = new Set(openAtSince);
  for (const event of events) {
    if (event.type === 'alert.open') opened.add(event.alert.id);
    if (event.type === 'alert.close') {
      ensure(
        opened.has(event.alertId),
        `alert.close "${event.alertId}" was never opened in the window or open at its start`,
      );
    }
  }
}

/**
 * Checks a bounded event window. `openAtSince` holds the alert ids open in `snapshot(since)`.
 */
export function checkEvents(
  events: readonly PlatformEvent[],
  topology: Topology,
  window: { since: Date; until: Date },
  openAtSince: ReadonlySet<string> = new Set(),
): void {
  const ids = topologyIds(topology);
  checkOrdering(events, window.since, window.until);
  for (const event of events) {
    ensure(
      event.envId === topology.envId,
      `event ${event.type} envId "${event.envId}" must equal "${topology.envId}"`,
    );
    ensure(
      (PLATFORM_EVENT_TYPES as readonly string[]).includes(event.type),
      `unknown event type "${event.type}"`,
    );
    checkReferences(event, ids);
  }
  checkAlertCloses(events, openAtSince);
}
