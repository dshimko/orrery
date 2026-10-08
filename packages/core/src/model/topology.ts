// SPDX-License-Identifier: Apache-2.0

export type SpokeRole = 'ingest' | 'domain';
export type MetricKey = 'pipelines' | 'products' | 'complexity' | 'volume';

export interface SpokeMetrics {
  pipelines: number;
  products: number;
  /** Relative complexity on a 0 to 5 scale. */
  complexity: number;
  /** Stored volume in terabytes. */
  volume: number;
}

export interface Spoke {
  id: string;
  name: string;
  role: SpokeRole;
  /** Metastore holding the spoke; differs from the hub's in multi-metastore deployments. */
  metastore: string;
  freshness: { cadenceMinutes: number; targetMinutes: number; offsetMinutes: number };
  metrics: SpokeMetrics;
  /** Runs ML training or scoring (drawn as auroras). */
  hasMl: boolean;
  /** Shares data with other metastores (drawn as tethers when in another metastore). */
  isShared: boolean;
}

export interface Site {
  id: string;
  name: string;
}

export interface SourceGroup {
  id: string;
  name: string;
  utcOffset: number;
  sites: Site[];
}

export interface UseCase {
  id: string;
  name: string;
  /** Office or team location shown on the Orloj view as a small sun. */
  site?: string;
  utcOffset?: number;
  /** Spoke ids this use case reads from. */
  reads: string[];
}

export interface Metastore {
  id: string;
  name: string;
  status: 'ok' | 'unavailable';
}

export interface ForeignCatalog {
  id: string;
  name: string;
}

/** The structure of one environment, as an adapter discovers it. */
export interface Topology {
  envId: string;
  hub: { id: string; name: string; metastore: string };
  spokes: Spoke[];
  sourceGroups: SourceGroup[];
  useCases: UseCase[];
  shipyard?: { name: string; utcOffset: number };
  metastores: Metastore[];
  foreignCatalogs: ForeignCatalog[];
}
