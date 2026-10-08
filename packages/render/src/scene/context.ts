// SPDX-License-Identifier: Apache-2.0
// Shared types between the scene parts and the view loop.
import type { Group, Object3D } from 'three';
import type { Pools } from '../sim/particles.js';
import type { SceneModel } from '../sim/model.js';
import type { Zone } from '../types.js';
import { zoneVisible, type FadeRegistry, type Slot } from './fade.js';
import type { LabelLayer } from './labels.js';

export interface SceneContext {
  readonly model: SceneModel;
  readonly world: Group;
  readonly fades: FadeRegistry;
  readonly labels: LabelLayer;
  readonly pickables: Object3D[];
  /** CSS color per spoke id. */
  readonly spokeColors: ReadonlyMap<string, string>;
}

/** Per-frame inputs shared by every part. Created once and updated in place by the view. */
export interface Frame {
  model: SceneModel;
  pools: Pools;
  dt: number;
  /** Decorative clock: advances while playing, frozen under reduced motion. */
  spin: number;
  /** Data-driven clock: advances while playing. */
  anim: number;
  reduced: boolean;
  slots: ReadonlySet<Slot>;
  /** A transfer-hold alert is open. */
  held: boolean;
  /** A federated-query alert is open. */
  federated: boolean;
}

export interface Part {
  /** Per-frame transforms, opacities, and instance matrices. No DOM text. */
  sync(frame: Frame): void;
  /** Text and DOM structure; called at most a few times a second. */
  refresh?(frame: Frame): void;
}

/** True when a vehicle or decoration of this slot and zone should draw. */
export function isOn(frame: Frame, slot: Slot, zone: Zone): boolean {
  return frame.slots.has(slot) && zoneVisible(frame.model.focusZones, zone);
}
