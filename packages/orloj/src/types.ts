// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology, Visuals } from '@orrery/core';

/** One clock face: an environment, its data, or the reason it has none. */
export interface OrlojFace {
  env: { id: string; name: string; tier: string };
  /** Plaque and accent color, e.g. visuals.colors.tiers[env.tier]. */
  tierColor: string;
  /** Per-environment seed for the procession and calendar (stability rule 5). */
  seed: number;
  topology: Topology | null;
  snapshot: Snapshot | null;
  /** When set, the face renders as an error face showing this message; others still render. */
  error?: string;
}

export interface OrlojTime {
  /** Shared simulated time for every face. */
  at: Date;
  paused: boolean;
}

export interface OrlojOptions {
  visuals: Visuals;
  /** Faces in promotion order. */
  faces: readonly OrlojFace[];
  time: () => OrlojTime;
  reducedMotion?: boolean;
}

/** A tooltip region, in CSS pixels relative to the canvas. */
export interface OrlojHit {
  envId: string;
  /** Stable part key, e.g. 'sun-hand', 'arc:qalert', 'spoke:sales', 'moon', 'miser', 'calendar'. */
  part: string;
  title: string;
  text: string;
  x: number;
  y: number;
  r: number;
}

export interface OrlojLayout {
  columns: number;
  /** Face scale (face units to CSS px), capped at visuals.orloj.maxScale. */
  scale: number;
  width: number;
  height: number;
}

export interface OrlojView {
  setFaces(faces: readonly OrlojFace[]): void;
  /** Fires on pointer move with the region under the pointer (null when none). */
  onHover(listener: (hit: OrlojHit | null) => void): () => void;
  /** Fires when a face is clicked. */
  onSelect(listener: (envId: string) => void): () => void;
  layout(): OrlojLayout;
  dispose(): void;
}
