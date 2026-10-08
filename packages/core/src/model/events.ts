// SPDX-License-Identifier: Apache-2.0
import type { Alert } from './snapshot.js';

interface EventBase {
  envId: string;
  /** ISO timestamp. */
  ts: string;
  /** Workload id from `visuals.workloads`, when the event belongs to one. */
  workload?: string;
  tier?: 'bronze' | 'silver' | 'gold';
}

export interface SourceStreamEvent extends EventBase {
  type: 'source.stream';
  sourceGroupId: string;
  siteId: string;
  spokeId: string;
}

export interface SourceBatchEvent extends EventBase {
  type: 'source.batch';
  sourceGroupId: string;
  siteId: string;
  spokeId: string;
  /** Number of cargo pods in the batch. */
  size: number;
}

export interface IngestGateEvent extends EventBase {
  type: 'ingest.gate';
  spokeId: string;
  result: 'pass' | 'reject';
}

export interface TransferEvent extends EventBase {
  type: 'transfer';
  fromSpokeId: string;
  hubId: string;
}

export interface CopyEvent extends EventBase {
  type: 'copy';
  hubId: string;
  spokeId: string;
}

export interface ProductPublishEvent extends EventBase {
  type: 'product.publish';
  spokeId: string;
  hubId: string;
}

export interface FreshnessChangeEvent extends EventBase {
  type: 'freshness.change';
  spokeId: string;
  ageMinutes: number;
  targetMinutes: number;
  pastTarget: boolean;
}

export interface MlRunEvent extends EventBase {
  type: 'ml.run';
  spokeId: string;
}

export interface ServeReadEvent extends EventBase {
  type: 'serve.read';
  useCaseId: string;
  spokeId: string;
}

export interface FederationQueryEvent extends EventBase {
  type: 'federation.query';
  foreignCatalogId: string;
}

export interface DeployEvent extends EventBase {
  type: 'deploy';
  release: string;
  spokeId?: string;
}

export interface PromotionEvent extends EventBase {
  type: 'promotion';
  release: string;
  fromEnvId: string;
  toEnvId: string;
  status: 'promoted' | 'blocked';
}

export interface AlertOpenEvent extends EventBase {
  type: 'alert.open';
  alert: Alert;
}

export interface AlertCloseEvent extends EventBase {
  type: 'alert.close';
  alertId: string;
}

export type PlatformEvent =
  | SourceStreamEvent
  | SourceBatchEvent
  | IngestGateEvent
  | TransferEvent
  | CopyEvent
  | ProductPublishEvent
  | FreshnessChangeEvent
  | MlRunEvent
  | ServeReadEvent
  | FederationQueryEvent
  | DeployEvent
  | PromotionEvent
  | AlertOpenEvent
  | AlertCloseEvent;

export type PlatformEventType = PlatformEvent['type'];

export const PLATFORM_EVENT_TYPES: readonly PlatformEventType[] = [
  'source.stream',
  'source.batch',
  'ingest.gate',
  'transfer',
  'copy',
  'product.publish',
  'freshness.change',
  'ml.run',
  'serve.read',
  'federation.query',
  'deploy',
  'promotion',
  'alert.open',
  'alert.close',
];

/** Default workload for each event type, matching the ids in `DEFAULT_WORKLOADS`. */
export const DEFAULT_EVENT_WORKLOAD: Partial<Record<PlatformEventType, string>> = {
  'source.stream': 'streaming',
  'source.batch': 'batch',
  transfer: 'transfer',
  copy: 'transfer',
  'ingest.gate': 'transform',
  'product.publish': 'transform',
  'ml.run': 'ml',
  'serve.read': 'serving',
  deploy: 'build',
};
