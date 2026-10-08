// SPDX-License-Identifier: Apache-2.0
// The mock's built-in world: facts a real adapter would discover from the platform (metrics,
// sites, which spokes a use case reads), keyed by the ids used in config/examples/demo.yaml.
// Ids not listed here get seeded defaults, so any topology works with the mock.
import type { ScriptedIncident, SpokeMetrics } from '@orrery/core';

export interface SpokeFacts {
  metrics: SpokeMetrics;
  curve: string;
  hasMl?: boolean;
  isShared?: boolean;
}

export const SPOKES: Readonly<Record<string, SpokeFacts>> = {
  ingest: {
    metrics: { pipelines: 64, products: 60, complexity: 3.6, volume: 140 },
    curve: 'ingest',
  },
  supply: {
    metrics: { pipelines: 78, products: 34, complexity: 3.2, volume: 760 },
    curve: 'supply',
    isShared: true,
  },
  operations: {
    metrics: { pipelines: 150, products: 62, complexity: 4.5, volume: 2200 },
    curve: 'operations',
    hasMl: true,
  },
  quality: {
    metrics: { pipelines: 70, products: 40, complexity: 3.8, volume: 480 },
    curve: 'quality',
    isShared: true,
  },
  customer: {
    metrics: { pipelines: 96, products: 52, complexity: 4.2, volume: 3300 },
    curve: 'customer',
    hasMl: true,
    isShared: true,
  },
  sales: { metrics: { pipelines: 52, products: 26, complexity: 2.5, volume: 350 }, curve: 'sales' },
  finance: {
    metrics: { pipelines: 40, products: 22, complexity: 3.0, volume: 160 },
    curve: 'finance',
  },
};

export interface SourceGroupFacts {
  sites: number;
  shifts: 'two' | 'three';
}

export const SOURCE_GROUPS: Readonly<Record<string, SourceGroupFacts>> = {
  'region-a': { sites: 1, shifts: 'two' },
  'region-b': { sites: 2, shifts: 'two' },
  'region-c': { sites: 2, shifts: 'two' },
  'region-d': { sites: 3, shifts: 'two' },
  'region-e': { sites: 2, shifts: 'three' },
};
export const DEFAULT_SITES = 2;

export interface UseCaseFacts {
  reads: readonly string[];
  /** Notes shown when activity is above or below `busyAbove`. */
  busy: string;
  quiet: string;
  busyAbove: number;
  /** Activity follows the shipyard's working hours instead of an office's. */
  atShipyard?: boolean;
  /** Mostly idle watcher that wakes up on alerts. */
  isWatcher?: boolean;
}

export const USE_CASES: Readonly<Record<string, UseCaseFacts>> = {
  exec: {
    reads: ['operations', 'supply', 'finance'],
    busy: 'Rebalancing the plan',
    quiet: 'Tracking plan against actual',
    busyAbove: 0.7,
  },
  demand: {
    reads: ['sales'],
    busy: 'Forecasting next quarter',
    quiet: 'Watching demand signals',
    busyAbove: 0.7,
  },
  risk: {
    reads: ['quality', 'customer', 'operations', 'supply', 'ingest'],
    busy: 'Watching quality and field signals',
    quiet: 'Watching quality and field signals',
    busyAbove: 1,
    isWatcher: true,
  },
  campaign: {
    reads: ['sales', 'customer'],
    busy: 'Refreshing campaign performance',
    quiet: 'Waiting for the day',
    busyAbove: 0.6,
  },
  inbound: {
    reads: ['supply', 'ingest'],
    busy: 'Recalculating inbound risk',
    quiet: 'Monitoring inbound',
    busyAbove: 0.6,
  },
  models: {
    reads: ['operations', 'customer'],
    busy: 'Scoring asset health',
    quiet: 'Training overnight',
    busyAbove: 0.5,
    atShipyard: true,
  },
};

export const DEFAULT_SHIPYARD = { name: 'Engineering studio', utcOffset: 5.5 } as const;

export const FOREIGN_CATALOGS = [
  { id: 'legacy-warehouse', name: 'Legacy warehouse' },
  { id: 'operational-db', name: 'Operational database' },
] as const;

/** UTC offset whose working day drives domain activity and spend (the main office). */
export const CONSUMER_UTC_OFFSET = -4;

/** Minutes of the UTC day when the ingest spoke ships consolidated silver to the hub. */
export const TRANSFERS_BY_TIER: Readonly<Record<string, readonly number[]>> = {
  dev: [9 * 60, 14 * 60],
  stg: [3 * 60, 15 * 60],
  prod: [3 * 60, 11 * 60, 16 * 60, 19 * 60 + 45, 22 * 60 + 30],
};

export const PROMOTES_TO_BY_TIER: Readonly<Record<string, string>> = { dev: 'stg', stg: 'prod' };

type Script = readonly ScriptedIncident[];

/**
 * Default scripted day per tier. Covers the spec's list: nightly batch, transfer hold,
 * predictive maintenance warning, cross-domain quality alert, schema drift reject, failed
 * promotion blocked in stg, and the daily finance refresh.
 */
export const SCRIPTS_BY_TIER: Readonly<Record<string, Script>> = {
  prod: [
    {
      id: 'batch',
      at: '01:00',
      durationMinutes: 120,
      severity: 'info',
      kind: 'nightly-batch',
      title: 'Overnight batch loads',
      text: 'Batch files from every region dock at the ingest spoke, pile up in the bronze ring, then pass the gantry into silver.',
      targets: ['spoke:ingest'],
    },
    {
      id: 'finclose',
      at: '02:00',
      durationMinutes: 45,
      severity: 'info',
      kind: 'finance-refresh',
      title: 'Finance refreshes',
      text: 'Finance has drifted to the outer orbit after a day without a refresh. The nightly close lands and it swings back toward the core.',
      targets: ['spoke:finance'],
    },
    {
      id: 'ship1',
      at: '03:00',
      durationMinutes: 60,
      severity: 'info',
      kind: 'transfer',
      title: 'Nightly transfer to the core',
      text: 'Consolidated silver flies from the ingest spoke to the core platform, where most data products live.',
      targets: ['spoke:ingest'],
    },
    {
      id: 'build',
      at: '03:30',
      durationMinutes: 90,
      severity: 'info',
      kind: 'release',
      title: 'Release ships',
      text: 'Release drones carry new pipeline versions from the engineering studio to the spokes.',
      targets: ['shipyard'],
    },
    {
      id: 'maint',
      at: '08:30',
      durationMinutes: 60,
      severity: 'warning',
      kind: 'predictive-maintenance',
      title: 'Asset health warning',
      text: 'Sensor readings from a Region C site trend out of range. Operations lights up with ML scoring and the asset health models station reads it.',
      targets: ['site:region-c-1', 'useCase:models', 'spoke:operations'],
    },
    {
      id: 'qalert',
      at: '10:30',
      durationMinutes: 120,
      severity: 'incident',
      kind: 'quality-alert',
      title: 'Cross-domain quality alert',
      text: 'A defect pattern traces to sites in three regions. The quality risk station reads Quality, Customer, Operations, Supply, and ingest data.',
      targets: ['useCase:risk', 'site:region-d-1', 'site:region-b-1', 'site:region-e-1'],
    },
    {
      id: 'office1',
      at: '12:30',
      durationMinutes: 150,
      severity: 'info',
      kind: 'office-open',
      title: 'Office 1 opens',
      text: 'The executive overview and demand planning stations start reading fresh products.',
      targets: ['useCase:exec', 'useCase:demand'],
    },
    {
      id: 'fedq',
      at: '16:00',
      durationMinutes: 90,
      severity: 'info',
      kind: 'federated-query',
      title: 'Federated queries',
      text: 'Campaign performance joins a legacy warehouse through a foreign catalog. Data is queried in place and nothing is copied.',
      targets: ['foreign:legacy-warehouse', 'useCase:campaign'],
    },
    {
      id: 'hold',
      at: '19:30',
      durationMinutes: 60,
      severity: 'warning',
      kind: 'transfer-hold',
      title: 'Transfer held at ingest',
      text: 'A policy check flags a batch. The shuttle waits, and Supply, Operations, and Quality drift outward as their source data ages.',
      targets: ['spoke:ingest', 'spoke:supply', 'spoke:operations', 'spoke:quality'],
    },
  ],
  stg: [
    {
      id: 'regress',
      at: '01:00',
      durationMinutes: 120,
      severity: 'info',
      kind: 'nightly-batch',
      title: 'Nightly regression run',
      text: 'A sample of production volume replays through every staging pipeline to validate the next release.',
      targets: ['spoke:ingest'],
    },
    {
      id: 'ship1',
      at: '03:00',
      durationMinutes: 60,
      severity: 'info',
      kind: 'transfer',
      title: 'Staging transfer to the core',
      text: 'Regression output moves to the staging core for contract tests.',
      targets: ['spoke:ingest'],
    },
    {
      id: 'build',
      at: '10:00',
      durationMinutes: 60,
      severity: 'info',
      kind: 'release',
      title: 'Release candidate lands',
      text: 'Release r-128 deploys to staging from the engineering studio.',
      targets: ['shipyard'],
    },
    {
      id: 'contract',
      at: '14:00',
      durationMinutes: 90,
      severity: 'warning',
      kind: 'promotion-blocked',
      title: 'Contract test fails, promotion blocked',
      text: 'Release r-128 breaks a data contract on Sales. Promotion to production is blocked until the fix passes.',
      targets: ['spoke:sales', 'shipyard'],
    },
  ],
  dev: [
    {
      id: 'sample',
      at: '00:00',
      durationMinutes: 360,
      severity: 'info',
      kind: 'synthetic-sample',
      title: 'Synthetic sample data',
      text: 'Development runs on synthetic samples refreshed on demand, so planets sit on far orbits.',
      targets: ['spoke:ingest'],
    },
    {
      id: 'schema',
      at: '10:00',
      durationMinutes: 90,
      severity: 'warning',
      kind: 'schema-drift',
      title: 'Schema change breaks pipelines',
      text: 'A column rename in a shared source breaks three dev pipelines. Rejects spark at the gantry until the fix lands.',
      targets: ['spoke:operations', 'spoke:ingest'],
    },
    {
      id: 'build',
      at: '15:00',
      durationMinutes: 90,
      severity: 'info',
      kind: 'release',
      title: 'Build burst',
      text: 'Engineers ship eight builds in ninety minutes. Release drones swarm the planets.',
      targets: ['shipyard'],
    },
  ],
};
