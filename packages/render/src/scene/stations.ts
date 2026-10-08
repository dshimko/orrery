// SPDX-License-Identifier: Apache-2.0
// Use-case stations in low orbit (status-colored) and foreign-catalog comets with tails and
// query beams.
import {
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  type Group,
  type MeshStandardMaterial,
} from 'three';
import { arcControl, ORIGIN } from '../sim/math.js';
import type { CometBody, StationBody } from '../sim/model.js';
import type { Frame, Part, SceneContext } from './context.js';
import type { Label } from './labels.js';
import {
  box,
  dynamicLine,
  glowMaterial,
  group,
  setCurve,
  sphere,
  standard,
  type DynamicLine,
} from './materials.js';
import { COLOR_OK } from './palette.js';

const STATION_LABEL_MAX_CAM = 95;
const STATION_LABEL_LIFT = 2;
const COMET_LABEL_LIFT = 4;
const BEAM_LIFT = 10;
const BEAM_IDLE = 0.12;
const BEAM_ACTIVE = 0.55;
const COMET_HEAD = '#CFEFFF';
const COMET_HEAD_EMISSIVE = '#7FD6FF';
const COMET_TAIL = '#9FE6FF';

interface StationParts {
  body: StationBody;
  g: Group;
  core: MeshStandardMaterial;
  dish: MeshStandardMaterial;
  lamp: MeshBasicMaterial;
  label: Label;
  lastStatus: StationBody['status'] | null;
}

function statusColor(ctx: SceneContext, status: StationBody['status']): string {
  const { colors } = ctx.model.visuals;
  return status === 'incident' ? colors.incident : status === 'warning' ? colors.warning : COLOR_OK;
}

function buildStation(ctx: SceneContext, body: StationBody): StationParts {
  const g = group(ctx.world);
  const core = standard('#1E2E4A', COLOR_OK, 0.4);
  const cylinder = new Mesh(new CylinderGeometry(0.35, 0.35, 1.6, 12), core);
  cylinder.rotation.z = Math.PI / 2;
  g.add(cylinder);
  const panels = standard('#23477E', '#3A7BD5', 0.35);
  box([0.9, 0.05, 2.4], panels, [-0.6, 0, 0], g);
  box([0.9, 0.05, 2.4], panels, [0.6, 0, 0], g);
  const dish = standard('#D5DEEA', COLOR_OK, 0.6);
  const dishMesh = new Mesh(new ConeGeometry(0.4, 0.4, 12, 1, true), dish);
  dishMesh.position.set(0, 0.45, 0);
  dishMesh.rotation.x = Math.PI;
  g.add(dishMesh);
  const lamp = new MeshBasicMaterial({ color: COLOR_OK });
  sphere(0.18, lamp, g, 8).position.set(0, 0.8, 0);
  cylinder.userData['pick'] = { kind: 'useCase', id: body.id };
  ctx.pickables.push(cylinder);
  ctx.fades.add([core, panels, dish], 'use', 'stations');
  const label = ctx.labels.add({
    id: `station:${body.id}`,
    className: 'tower',
    hasSmall: true,
    maxCam: STATION_LABEL_MAX_CAM,
    place: (out) => out.set(body.pos.x, body.pos.y + STATION_LABEL_LIFT, body.pos.z),
  });
  return { body, g, core, dish, lamp, label, lastStatus: null };
}

function syncStation(ctx: SceneContext, s: StationParts): void {
  const { body } = s;
  s.g.position.set(body.pos.x, body.pos.y, body.pos.z);
  s.g.rotation.y = Math.atan2(body.pos.x, body.pos.z);
  s.g.scale.setScalar(1 + body.activity * 0.5 + body.flash * 0.3);
  s.core.emissiveIntensity = 0.25 + 0.6 * body.activity + body.flash;
  if (body.status === s.lastStatus) return;
  s.lastStatus = body.status;
  const color = statusColor(ctx, body.status);
  s.core.emissive.set(color);
  s.dish.emissive.set(color);
  s.lamp.color.set(color);
}

interface CometParts {
  body: CometBody;
  g: Group;
  beam: DynamicLine;
  label: Label;
}

function buildComet(ctx: SceneContext, body: CometBody): CometParts {
  const g = group(ctx.world);
  const head = standard(COMET_HEAD, COMET_HEAD_EMISSIVE, 0.6);
  const headMesh = sphere(1.4, head, g, 16);
  const tail = new Mesh(new ConeGeometry(1.1, 9, 12, 1, true), glowMaterial(COMET_TAIL, 0.25));
  tail.rotation.z = Math.PI / 2;
  tail.position.x = 5;
  g.add(tail);
  headMesh.userData['pick'] = { kind: 'foreign', id: body.id };
  ctx.pickables.push(headMesh);
  ctx.fades.add([head], 'none', 'comets');
  const beam = dynamicLine(ctx, ctx.model.visuals.colors.federated, 20, 'use', 'comets');
  const label = ctx.labels.add({
    id: `comet:${body.id}`,
    className: 'planet',
    color: ctx.model.visuals.colors.federated,
    hasSmall: true,
    place: (out) => out.set(body.pos.x, body.pos.y + COMET_LABEL_LIFT, body.pos.z),
  });
  ctx.labels.setText(label, body.name, 'Foreign catalog, read-only');
  return { body, g, beam, label };
}

function syncComet(c: CometParts, frame: Frame): void {
  const { pos } = c.body;
  c.g.position.set(pos.x, pos.y, pos.z);
  c.g.rotation.y = Math.atan2(-pos.z, pos.x) + Math.PI;
  setCurve(c.beam, pos, arcControl(pos, ORIGIN, BEAM_LIFT), ORIGIN);
  const level = frame.federated ? BEAM_ACTIVE : BEAM_IDLE;
  c.beam.material.opacity = frame.slots.has('beam') ? level * c.beam.fade.k : 0;
}

export function buildStations(ctx: SceneContext): Part {
  const stations = ctx.model.stations.map((body) => buildStation(ctx, body));
  const comets = ctx.model.comets.map((body) => buildComet(ctx, body));
  return {
    sync(frame) {
      for (const s of stations) syncStation(ctx, s);
      for (const c of comets) syncComet(c, frame);
    },
    refresh() {
      for (const s of stations) {
        const { useCase, note } = s.body;
        const small = [useCase.site, note].filter((t): t is string => !!t).join('. ');
        ctx.labels.setText(s.label, useCase.name, small);
      }
    },
  };
}
