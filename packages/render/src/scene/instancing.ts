// SPDX-License-Identifier: Apache-2.0
// Vehicle InstancedMeshes, one per kind, capped by CAPS (stability rule 7).
import {
  BoxGeometry,
  InstancedMesh,
  SphereGeometry,
  type BufferGeometry,
  type ColorRepresentation,
} from 'three';
import { CAPS } from '../sim/particles.js';
import type { Frame, Part, SceneContext } from './context.js';
import { isOn } from './context.js';
import { standard } from './materials.js';
import {
  packCopies,
  packCrates,
  packDrones,
  packGolds,
  packLasers,
  packOrbs,
  packPods,
  packQueries,
  packServes,
  packSparks,
} from './pack.js';

const COLOR_SPARK_EMISSIVE = '#8A1F20';

function instanced(
  ctx: SceneContext,
  geometry: BufferGeometry,
  color: ColorRepresentation,
  cap: number,
  emissive: ColorRepresentation,
): InstancedMesh {
  const material = standard(color, emissive, 1);
  material.transparent = false;
  material.roughness = 0.5;
  const mesh = new InstancedMesh(geometry, material, cap);
  mesh.count = 0;
  mesh.frustumCulled = false;
  ctx.world.add(mesh);
  return mesh;
}

const sphereOf = (r: number) => new SphereGeometry(r, 8, 6);
const matrices = (mesh: InstancedMesh): Float32Array => mesh.instanceMatrix.array as Float32Array;

function commit(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

export function buildVehicles(ctx: SceneContext): Part {
  const { colors } = ctx.model.visuals;
  const pod = instanced(ctx, new BoxGeometry(1.1, 0.55, 0.6), colors.bronze, CAPS.pod, '#3A2410');
  const laser = instanced(ctx, sphereOf(0.3), colors.streaming, CAPS.laser, '#1A90A8');
  const crateBronze = instanced(
    ctx,
    new BoxGeometry(0.4, 0.4, 0.4),
    colors.bronze,
    CAPS.crate,
    '#3A2410',
  );
  const crateSilver = instanced(
    ctx,
    new BoxGeometry(0.4, 0.4, 0.4),
    colors.silver,
    CAPS.crate,
    '#5C6B80',
  );
  const copy = instanced(
    ctx,
    new BoxGeometry(0.7, 0.35, 0.35),
    colors.silver,
    CAPS.copy,
    '#5C6B80',
  );
  const gold = instanced(ctx, new SphereGeometry(0.32, 10, 8), colors.gold, CAPS.gold, '#8A7420');
  const orb = instanced(ctx, sphereOf(0.3), colors.ml, CAPS.orb, '#7A2C8A');
  const serve = instanced(ctx, sphereOf(0.18), colors.gold, CAPS.serve, '#8A7420');
  const query = instanced(ctx, sphereOf(0.24), colors.federated, CAPS.query, '#3A8AA8');
  const drone = instanced(ctx, new BoxGeometry(0.6, 0.2, 0.6), colors.build, CAPS.drone, '#3B2F88');
  const spark = instanced(
    ctx,
    new BoxGeometry(0.22, 0.22, 0.22),
    colors.incident,
    CAPS.spark,
    COLOR_SPARK_EMISSIVE,
  );

  return {
    sync(frame: Frame) {
      const { model, pools } = frame;
      commit(pod, isOn(frame, 'pod', 'belt') ? packPods(model, pools, matrices(pod)) : 0);
      commit(laser, isOn(frame, 'laser', 'belt') ? packLasers(model, pools, matrices(laser)) : 0);
      const crates = isOn(frame, 'crate', 'ingest')
        ? packCrates(model, pools, matrices(crateBronze), matrices(crateSilver))
        : { bronze: 0, silver: 0 };
      commit(crateBronze, crates.bronze);
      commit(crateSilver, crates.silver);
      commit(copy, isOn(frame, 'copy', 'planets') ? packCopies(model, pools, matrices(copy)) : 0);
      commit(gold, isOn(frame, 'gold', 'planets') ? packGolds(model, pools, matrices(gold)) : 0);
      commit(orb, isOn(frame, 'orb', 'planets') ? packOrbs(model, pools, matrices(orb)) : 0);
      commit(
        serve,
        isOn(frame, 'serve', 'stations') ? packServes(model, pools, matrices(serve)) : 0,
      );
      commit(
        query,
        isOn(frame, 'query', 'comets') ? packQueries(model, pools, matrices(query)) : 0,
      );
      commit(
        drone,
        isOn(frame, 'drone', 'yard') ? packDrones(model, pools, matrices(drone), frame.spin) : 0,
      );
      commit(spark, packSparks(pools, matrices(spark)));
    },
  };
}
