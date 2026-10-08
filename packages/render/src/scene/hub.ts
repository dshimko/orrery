// SPDX-License-Identifier: Apache-2.0
// The hub planet (land masses, clouds, atmosphere), its ring of product satellites, and the
// station orbit ring.
import {
  BackSide,
  Color,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  type Group,
} from 'three';
import { rad } from '../sim/math.js';
import { type Frame, type Part, type SceneContext } from './context.js';
import { landMasses } from './layout.js';
import { glowMaterial, group, sphere, standard, unitCircle } from './materials.js';
import { COLOR_OK } from './palette.js';
import { putMatrix } from './matrix.js';

const OCEAN = '#2A6FBF';
const OCEAN_EMISSIVE = '#0D3466';
const LAND = '#3E8D5A';
const LAND_EMISSIVE = '#123A22';
const ATMOSPHERE = '#4FA3FF';
const CLOUD_SCALE = 1.05;
const ATMOSPHERE_SCALE = 1.24;
const SATELLITE_SIZE = 0.26;
const SATELLITE_TINT = 0.55;
const POP_FROM = 0.3;
const POP_OVERSHOOT = 0.5;
const STATION_RING_OPACITY = 0.18;

/** Satellite scale: small at pop 0, a little over-size mid-pop, exactly 1 once settled. */
export function popScale(pop: number): number {
  if (pop >= 1) return 1;
  return POP_FROM + (1 - POP_FROM) * pop + POP_OVERSHOOT * Math.sin(Math.PI * pop);
}

function buildPlanet(ctx: SceneContext, earthG: Group): { cloud: Mesh } {
  const { world } = ctx.model.visuals;
  const ocean = standard(OCEAN, OCEAN_EMISSIVE, 0.45);
  const land = standard(LAND, LAND_EMISSIVE, 0.3);
  const planet = sphere(world.hubRadius, ocean, earthG, 36);
  planet.userData['pick'] = { kind: 'hub' };
  ctx.pickables.push(planet);
  for (const mass of landMasses(ctx.model.seed, world.hubRadius)) {
    sphere(mass.radius, land, earthG, 12).position.set(...mass.position);
  }
  const cloudMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.14,
    roughness: 1,
  });
  const cloud = sphere(world.hubRadius * CLOUD_SCALE, cloudMaterial, earthG, 36);
  sphere(world.hubRadius * ATMOSPHERE_SCALE, glowMaterial(ATMOSPHERE, 0.12, BackSide), earthG, 36);
  ctx.fades.add([ocean, land], 'none', 'earth');
  return { cloud };
}

function buildSatellites(ctx: SceneContext): InstancedMesh {
  const { ringSatellites } = ctx.model;
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: ctx.model.visuals.colors.gold,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 1,
  });
  const mesh = new InstancedMesh(
    new OctahedronGeometry(SATELLITE_SIZE, 0),
    material,
    Math.max(1, ringSatellites.length),
  );
  mesh.frustumCulled = false;
  mesh.count = ringSatellites.length;
  const color = new Color();
  const gold = new Color(ctx.model.visuals.colors.gold);
  ringSatellites.forEach((p, i) => {
    color.set(ctx.spokeColors.get(p.spokeId) ?? '#FFFFFF').lerp(gold, SATELLITE_TINT);
    mesh.setColorAt(i, color);
  });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  ctx.world.add(mesh);
  ctx.fades.add([material], 'gold', 'earth');
  return mesh;
}

function hubText(ctx: SceneContext): { name: string; small: string } {
  const { topology, ringSatellites } = ctx.model;
  const stores = topology.metastores.length;
  const federation = stores > 1 ? `${stores} metastores` : '1 metastore';
  return {
    name: topology.hub.name,
    small: `${ringSatellites.length} products in orbit. ${federation}`,
  };
}

export function buildHub(ctx: SceneContext): Part {
  const { visuals, ringSatellites } = ctx.model;
  const earthG = group(ctx.world);
  const { cloud } = buildPlanet(ctx, earthG);
  const satellites = buildSatellites(ctx);
  const satelliteMaterial = satellites.material as MeshStandardMaterial;
  const stationRing = unitCircle(ctx, COLOR_OK, STATION_RING_OPACITY, 'use', 'stations');
  stationRing.scale.set(visuals.world.stationOrbit, 1, visuals.world.stationOrbit);
  const label = ctx.labels.add({
    id: 'hub',
    className: 'zone',
    color: '#7FB8FF',
    hasSmall: true,
    place: (out) => out.set(0, visuals.world.hubRadius + 4, 0),
  });
  const tilt = rad(visuals.world.productRingTiltDeg);
  const radius = visuals.world.productRingRadius;
  const array = satellites.instanceMatrix.array as Float32Array;

  return {
    sync(frame: Frame) {
      earthG.rotation.y = frame.spin * 0.15;
      cloud.rotation.y = frame.spin * 0.05;
      const turn = frame.spin * 0.03;
      ringSatellites.forEach((p, i) => {
        const a = p.angle + turn;
        const z = radius * Math.sin(a);
        putMatrix(
          array,
          i,
          radius * Math.cos(a),
          z * Math.sin(tilt),
          z * Math.cos(tilt),
          0,
          popScale(p.pop),
        );
      });
      satellites.instanceMatrix.needsUpdate = true;
      satelliteMaterial.emissiveIntensity = 0.45 + 0.25 * Math.sin(frame.spin * 2);
    },
    refresh() {
      const text = hubText(ctx);
      ctx.labels.setText(label, text.name, text.small);
    },
  };
}
