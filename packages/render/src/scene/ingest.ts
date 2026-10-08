// SPDX-License-Identifier: Apache-2.0
// The ingest spoke's extras: bronze debris ring (height follows the backlog), gantry torus,
// and one silver satellite per ingest product.
import {
  BoxGeometry,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  TorusGeometry,
} from 'three';
import { TAU } from '../sim/math.js';
import type { SpokeBody } from '../sim/model.js';
import type { Frame, Part, SceneContext } from './context.js';
import { glowMaterial, group, standard } from './materials.js';
import { putMatrix } from './matrix.js';
import { COLOR_GATE } from './palette.js';

const DEBRIS_COUNT = 40;
const DEBRIS_SIZE = 0.45;
const SATELLITE_SIZE = 0.2;
const YARD_INNER = 1;
const YARD_OUTER = 1.3;
const GANTRY_RADIUS = 1;
const GANTRY_TUBE = 0.035;
const DEBRIS_MAX_FILL = 1;

function buildDebris(ctx: SceneContext): InstancedMesh {
  const material = standard(ctx.model.visuals.colors.bronze, ctx.model.visuals.colors.bronze, 0.35);
  const debris = new InstancedMesh(
    new BoxGeometry(DEBRIS_SIZE, DEBRIS_SIZE, DEBRIS_SIZE),
    material,
    DEBRIS_COUNT,
  );
  debris.frustumCulled = false;
  ctx.world.add(debris);
  ctx.fades.add([material], 'silver', 'ingest');
  return debris;
}

function packDebris(out: Float32Array, ingest: SpokeBody, fill: number, spin: number): void {
  const gr = ingest.radius;
  for (let i = 0; i < DEBRIS_COUNT; i += 1) {
    const a = (i / DEBRIS_COUNT) * TAU + spin * 0.08;
    const r = gr + 1.8 + ((i * 7) % 5) * 0.2;
    const h = 0.5 + Math.min(1, fill) * 1.4 * (((i * 13) % 7) / 7);
    putMatrix(
      out,
      i,
      ingest.pos.x + r * Math.cos(a),
      ingest.pos.y + h * 0.3,
      ingest.pos.z + r * Math.sin(a),
      a,
      1,
      h,
      1,
    );
  }
}

export function buildIngest(ctx: SceneContext): Part | null {
  const ingest = ctx.model.ingest;
  if (!ingest) return null;
  const { silver, bronze } = ctx.model.visuals.colors;
  const g = group(ctx.world);
  const yardMaterial = new MeshStandardMaterial({
    color: bronze,
    emissive: bronze,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.75,
    side: DoubleSide,
  });
  const yardRing = new Mesh(new RingGeometry(YARD_INNER, YARD_OUTER, 48), yardMaterial);
  yardRing.rotation.x = -Math.PI / 2;
  g.add(yardRing);
  const gantryMaterial = glowMaterial(COLOR_GATE, 0.55);
  const gantry = new Mesh(new TorusGeometry(GANTRY_RADIUS, GANTRY_TUBE, 8, 48), gantryMaterial);
  g.add(gantry);
  const debris = buildDebris(ctx);
  const productCount = ingest.spoke.metrics.products;
  const satMaterial = new MeshStandardMaterial({
    color: silver,
    emissive: silver,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 1,
  });
  const satellites = new InstancedMesh(
    new OctahedronGeometry(SATELLITE_SIZE, 0),
    satMaterial,
    Math.max(1, productCount),
  );
  satellites.frustumCulled = false;
  satellites.count = productCount;
  ctx.world.add(satellites);
  ctx.fades.add([yardMaterial, satMaterial], 'silver', 'ingest');
  ctx.fades.add([gantryMaterial], 'silver', 'ingest');
  const debrisArray = debris.instanceMatrix.array as Float32Array;
  const satArray = satellites.instanceMatrix.array as Float32Array;

  return {
    sync(frame: Frame) {
      const gr = ingest.radius;
      g.position.set(ingest.pos.x, ingest.pos.y, ingest.pos.z);
      yardRing.scale.set(gr + 1.6, gr + 1.6, 1);
      yardMaterial.emissiveIntensity = 0.2 + 0.6 * Math.min(DEBRIS_MAX_FILL, ctx.model.yardPile);
      gantry.scale.setScalar(gr + 0.9);
      gantry.rotation.set(Math.PI / 2 + Math.sin(frame.spin * 0.8) * 0.4, frame.spin * 0.9, 0);
      packDebris(debrisArray, ingest, ctx.model.yardPile, frame.spin);
      debris.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < productCount; i += 1) {
        const a = (i / productCount) * TAU - frame.spin * 0.12;
        putMatrix(
          satArray,
          i,
          ingest.pos.x + (gr + 3.6) * Math.cos(a),
          ingest.pos.y + Math.sin(a * 3) * 0.4,
          ingest.pos.z + (gr + 3.6) * Math.sin(a),
        );
      }
      satellites.instanceMatrix.needsUpdate = true;
    },
  };
}
