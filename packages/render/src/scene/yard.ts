// SPDX-License-Identifier: Apache-2.0
// The shipyard and the three transfer shuttles (dock beside ingest, then fly an arc to the hub).
import {
  Mesh,
  MeshBasicMaterial,
  TorusGeometry,
  type Group,
  type MeshStandardMaterial,
} from 'three';
import { arcControl, bezier, heading, ORIGIN, toward } from '../sim/math.js';
import { CAPS } from '../sim/particles.js';
import { isOn, type Frame, type Part, type SceneContext } from './context.js';
import { box, glowMaterial, group, sphere, standard } from './materials.js';
import { COLOR_YARD } from './palette.js';

const YARD_LABEL_MAX_CAM = 260;
const YARD_LABEL_LIFT = 4;
const DOCK_OFFSET = 1.6;
const DOCK_LIFT = 1.2;
const FLIGHT_LIFT = 6;
const LOOK_AHEAD = 0.02;
const BEACON_BLINK_RATE = 8;

function buildShipyard(ctx: SceneContext): { material: MeshStandardMaterial; ring: Mesh } {
  const { model } = ctx;
  const g = group(ctx.world);
  g.position.set(model.yard.x, model.yard.y, model.yard.z);
  const material = standard(COLOR_YARD, model.visuals.colors.build, 0.35);
  const ring = new Mesh(new TorusGeometry(1.8, 0.25, 10, 32), material);
  g.add(ring);
  box([0.8, 0.8, 3.6], material, [0, 0, 0], g);
  box([3.6, 0.8, 0.8], material, [0, 0, 0], g);
  ring.userData['pick'] = { kind: 'shipyard' };
  ctx.pickables.push(ring);
  ctx.fades.add([material], 'bronze', 'yard');
  const label = ctx.labels.add({
    id: 'shipyard',
    className: 'zone',
    color: '#B7ADFF',
    hasSmall: true,
    maxCam: YARD_LABEL_MAX_CAM,
    place: (out) => out.set(model.yard.x, model.yard.y + YARD_LABEL_LIFT, model.yard.z),
  });
  ctx.labels.setText(label, 'Shipyard', model.topology.shipyard?.name ?? '');
  return { material, ring };
}

interface ShuttleParts {
  g: Group;
  beacon: MeshBasicMaterial;
}

function buildShuttle(ctx: SceneContext): ShuttleParts {
  const g = group(ctx.world);
  const hull = standard('#E8EDF5', '#8FA6C8', 0.3);
  box([1.8, 0.5, 0.7], hull, [0, 0, 0], g);
  box([0.6, 0.1, 1.8], hull, [-0.3, 0, 0], g);
  sphere(0.25, glowMaterial('#9FD2FF', 0.9), g, 8).position.set(-1.05, 0, 0);
  const beacon = new MeshBasicMaterial({
    color: ctx.model.visuals.colors.incident,
    transparent: true,
    opacity: 0,
  });
  sphere(0.35, beacon, g, 8).position.set(0, 0.6, 0);
  g.visible = false;
  ctx.fades.add([hull], 'silver', 'ingest');
  return { g, beacon };
}

function syncShuttle(ctx: SceneContext, s: ShuttleParts, index: number, frame: Frame): void {
  const state = frame.pools.shuttles[index];
  const ingest = ctx.model.ingest;
  if (!state || state.state === 'idle' || !ingest) {
    s.g.visible = false;
    return;
  }
  s.g.visible = isOn(frame, 'shuttle', 'ingest');
  const dock = toward(ORIGIN, ingest.pos, ingest.radius + DOCK_OFFSET);
  if (state.state === 'dock') {
    s.g.position.set(dock.x, dock.y + DOCK_LIFT, dock.z);
    s.g.rotation.y = Math.atan2(dock.z, -dock.x);
    const blink = frame.reduced ? 1 : 0.5 + 0.5 * Math.sin(frame.anim * BEACON_BLINK_RATE);
    s.beacon.opacity = frame.held ? blink * (frame.reduced ? 0.75 : 1) : 0;
    return;
  }
  s.beacon.opacity = 0;
  const control = arcControl(dock, ORIGIN, FLIGHT_LIFT);
  const p = bezier(dock, control, ORIGIN, Math.min(1, state.t));
  const ahead = bezier(dock, control, ORIGIN, Math.min(1, state.t + LOOK_AHEAD));
  s.g.position.set(p.x, p.y, p.z);
  s.g.rotation.y = heading(p, ahead);
}

export function buildYard(ctx: SceneContext): Part {
  const { material, ring } = buildShipyard(ctx);
  const shuttles = Array.from({ length: CAPS.shuttle }, () => buildShuttle(ctx));
  return {
    sync(frame) {
      ring.rotation.y = frame.spin * 0.4;
      material.emissiveIntensity = 0.25 + 0.6 * (ctx.model.snapshot.workloads['build'] ?? 0);
      shuttles.forEach((s, i) => syncShuttle(ctx, s, i, frame));
    },
  };
}
