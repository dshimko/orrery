// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent, Snapshot, Topology, Visuals } from '@orrery/core';

/** Scene zones, used by alert focus dimming. */
export type Zone = 'belt' | 'ingest' | 'earth' | 'planets' | 'stations' | 'comets' | 'yard';
/** Tier filter groups (spec: medallion tiers plus consumers). */
export type TierFilter = 'all' | 'bronze' | 'silver' | 'gold' | 'use';
export type CameraViewKey = 'over' | 'belt' | 'ingest' | 'earth' | 'planets' | 'stations' | 'yard';

export interface Filters {
  tier: TierFilter;
  /** Workload id to show alone, or 'all'. Includes 'federated' for comet beams. */
  workload: string;
  /** Dim everything outside the zones of the most severe open alert. */
  focusAlerts: boolean;
  /** Pin focus on one zone regardless of alerts. */
  pinnedZone: Zone | null;
}

export interface TimeState {
  /** Simulated time being shown. */
  at: Date;
  /** Playback multiplier (1, 2, 4). */
  speed: number;
  paused: boolean;
  /**
   * Live mode: `at` follows the wall clock. Orbits then advance at real time, and vehicles
   * travel at their normal (1x) visible pace regardless of `speed`.
   */
  live?: boolean;
}

export interface CameraState {
  target: [number, number, number];
  distance: number;
  /** Quaternion x, y, z, w. */
  rotation: [number, number, number, number];
}

export type PickTarget =
  | { kind: 'hub' }
  | { kind: 'spoke'; id: string }
  | { kind: 'site'; id: string }
  | { kind: 'useCase'; id: string }
  | { kind: 'foreign'; id: string }
  | { kind: 'shipyard' };

export interface SystemViewOptions {
  topology: Topology;
  visuals: Visuals;
  /** Tier color for the scene edge band, e.g. visuals.colors.tiers[env.tier]. */
  tierColor: string;
  /** Per-environment seed (stability rule 5). */
  seed: number;
  /** First snapshot: places orbits before the first frame. */
  snapshot: Snapshot;
  /** Supplies simulated time every frame. */
  time: () => TimeState;
  reducedMotion?: boolean;
  camera?: CameraState;
}

/** The framework-free system view a host page mounts. */
export interface SystemView {
  setSnapshot(snapshot: Snapshot): void;
  /** Queue events; each spawns its vehicle when simulated time passes its ts. */
  pushEvents(events: readonly PlatformEvent[]): void;
  /** Drop queued and in-flight vehicles, e.g. after a time jump. */
  clearTransient(): void;
  setFilters(filters: Partial<Filters>): void;
  goView(key: CameraViewKey): void;
  focus(target: PickTarget): void;
  resetCamera(): void;
  levelHorizon(): void;
  getCamera(): CameraState;
  setCamera(state: CameraState): void;
  onPick(listener: (target: PickTarget | null) => void): () => void;
  dispose(): void;
}
