// SPDX-License-Identifier: Apache-2.0
// Assembles every scene part into one Three.js scene and owns its disposal.
import { Group, Scene, type Material, type Object3D } from 'three';
import type { SceneModel } from '../sim/model.js';
import { buildAlerts } from './alerts.js';
import type { Frame, Part, SceneContext } from './context.js';
import { FadeRegistry } from './fade.js';
import { buildHub } from './hub.js';
import { buildIngest } from './ingest.js';
import { buildVehicles } from './instancing.js';
import type { LabelLayer } from './labels.js';
import { spokeColors } from './palette.js';
import { buildSites } from './sites.js';
import { buildSpokes } from './spokes.js';
import { buildStatic } from './static.js';
import { buildStations } from './stations.js';
import { buildYard } from './yard.js';

export interface BuiltScene {
  readonly scene: Scene;
  readonly pickables: readonly Object3D[];
  sync(frame: Frame): void;
  /** Text and DOM structure updates; call a few times a second. */
  refresh(frame: Frame): void;
  dispose(): void;
}

export function buildScene(model: SceneModel, labels: LabelLayer): BuiltScene {
  const scene = new Scene();
  buildStatic(scene, model);
  const world = new Group();
  scene.add(world);
  const ctx: SceneContext = {
    model,
    world,
    fades: new FadeRegistry(),
    labels,
    pickables: [],
    spokeColors: spokeColors(model.topology),
  };
  const parts: Part[] = [buildSites(ctx), buildHub(ctx), buildSpokes(ctx)];
  const ingest = buildIngest(ctx);
  if (ingest) parts.push(ingest);
  parts.push(buildStations(ctx), buildYard(ctx), buildVehicles(ctx), buildAlerts(ctx));

  return {
    scene,
    pickables: ctx.pickables,
    sync(frame) {
      ctx.fades.update(model.filters.tier, model.focusZones, frame.dt);
      for (const part of parts) part.sync(frame);
    },
    refresh(frame) {
      for (const part of parts) part.refresh?.(frame);
    },
    dispose() {
      scene.traverse((object) => {
        const disposable = object as Object3D & {
          geometry?: { dispose(): void };
          material?: Material | Material[];
          dispose?: () => void;
        };
        disposable.geometry?.dispose();
        const { material } = disposable;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
        if ('isInstancedMesh' in object) disposable.dispose?.();
      });
      scene.clear();
    },
  };
}
