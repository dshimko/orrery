// SPDX-License-Identifier: Apache-2.0
// The asteroid belt: seeded belt points, one rig per source site (rock, rig, beacon lamp, crate),
// a faint stream laser line per site, and the region labels.
import {
  BufferAttribute,
  BufferGeometry,
  IcosahedronGeometry,
  Mesh,
  Points,
  PointsMaterial,
  type MeshStandardMaterial,
} from 'three';
import { ORIGIN, toward } from '../sim/math.js';
import type { SiteBody } from '../sim/model.js';
import type { Frame, Part, SceneContext } from './context.js';
import { beltPositions } from './layout.js';
import {
  box,
  dynamicLine,
  group,
  setSegment,
  sphere,
  standard,
  type DynamicLine,
} from './materials.js';
import { COLOR_BELT, COLOR_OK } from './palette.js';

const BELT_POINTS = 2800;
const ROCK_RADIUS = 2.6;
const LAMP_HEIGHT = 4.8;
const LASER_STOP = 2.6;

interface SiteParts {
  site: SiteBody;
  rock: Mesh;
  index: number;
  lamp: MeshStandardMaterial;
  crateMaterial: MeshStandardMaterial;
  crate: Mesh;
  laser: DynamicLine | null;
}

function buildBelt(ctx: SceneContext): void {
  const { world } = ctx.model.visuals;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      beltPositions(ctx.model.seed, BELT_POINTS, world.beltRadius, world.beltSpread),
      3,
    ),
  );
  const material = new PointsMaterial({
    color: COLOR_BELT,
    size: 1.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.6,
  });
  ctx.world.add(new Points(geometry, material));
  ctx.fades.add([material], 'bronze', 'belt');
}

function buildSite(
  ctx: SceneContext,
  site: SiteBody,
  index: number,
  rockGeo: IcosahedronGeometry,
): SiteParts {
  const { colors } = ctx.model.visuals;
  const g = group(ctx.world);
  g.position.set(site.pos.x, site.pos.y, site.pos.z);
  const rockMaterial = standard('#6A5644');
  const rock = new Mesh(rockGeo, rockMaterial);
  rock.scale.set(1 + (index % 3) * 0.15, 0.8, 1.1);
  g.add(rock);
  const rigMaterial = standard('#2A3B58');
  box([1.4, 1.2, 1.4], rigMaterial, [0, 2.4, 0], g);
  box([0.15, 2.2, 0.15], rigMaterial, [0.5, 3.6, 0], g);
  const lamp = standard('#2B3A52', COLOR_OK, 0);
  sphere(0.35, lamp, g, 10).position.set(0.5, LAMP_HEIGHT, 0);
  const crateMaterial = standard(colors.bronze, colors.bronze, 0.4);
  const crate = box([1, 1, 1], crateMaterial, [-1.3, 2.3, 0.6], g);
  rock.userData['pick'] = { kind: 'site', id: site.id };
  ctx.pickables.push(rock);
  ctx.fades.add([rockMaterial, rigMaterial, lamp, crateMaterial], 'bronze', 'belt');
  const laser = ctx.model.ingest ? dynamicLine(ctx, colors.streaming, 1, 'bronze', 'belt') : null;
  return { site, rock, index, lamp, crateMaterial, crate, laser };
}

function syncSite(ctx: SceneContext, s: SiteParts, frame: Frame): void {
  const { site } = s;
  s.rock.rotation.set(s.index, s.index * 0.7 + frame.spin * 0.05, s.index * 0.3);
  s.lamp.emissiveIntensity = site.activity * 1.6;
  s.crateMaterial.emissiveIntensity = 0.15 + 0.8 * site.activity;
  s.crate.scale.set(1, 0.4 + Math.min(1, site.pile) * 1.6, 1);
  if (!s.laser) return;
  const ingest = ctx.model.ingest;
  const from = { x: site.pos.x, y: site.pos.y + LAMP_HEIGHT, z: site.pos.z };
  const to = ingest ? toward(site.pos, ingest.pos, ingest.radius + LASER_STOP) : ORIGIN;
  setSegment(s.laser, from, to);
  s.laser.material.opacity = frame.slots.has('laser')
    ? (0.06 + 0.25 * site.activity) * s.laser.fade.k
    : 0;
}

export function buildSites(ctx: SceneContext): Part {
  const { model } = ctx;
  buildBelt(ctx);
  const rockGeo = new IcosahedronGeometry(ROCK_RADIUS, 0);
  const sites = model.groups.flatMap((g) =>
    g.sites.map((site, i) => buildSite(ctx, site, i, rockGeo)),
  );
  for (const g of model.groups) {
    const label = ctx.labels.add({
      id: `group:${g.id}`,
      className: 'pad',
      place: (out) => out.set(g.pos.x, g.pos.y, g.pos.z),
    });
    ctx.labels.setText(label, g.name);
  }
  const beltLabel = ctx.labels.add({
    id: 'belt',
    className: 'zone',
    color: '#D7B08C',
    hasSmall: true,
    place: (out) => out.set(-model.visuals.world.beltRadius - 28, 12, 0),
  });
  ctx.labels.setText(beltLabel, 'Asteroid belt', `${model.siteById.size} source sites`);
  return {
    sync(frame) {
      for (const s of sites) syncSite(ctx, s, frame);
    },
  };
}
