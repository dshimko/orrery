// SPDX-License-Identifier: Apache-2.0
// Spoke planets: body, atmosphere, optional ring, ML aurora, orbit line (amber past target,
// dashed in another metastore), sharing tether, and the age label.
import {
  BackSide,
  DoubleSide,
  Mesh,
  RingGeometry,
  TorusGeometry,
  type Group,
  type Line,
  type LineBasicMaterial,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from 'three';
import { arcControl, ORIGIN } from '../sim/math.js';
import type { SpokeBody } from '../sim/model.js';
import { type Frame, type Part, type SceneContext } from './context.js';
import type { Label } from './labels.js';
import {
  dynamicLine,
  glowMaterial,
  group,
  setCurve,
  sphere,
  standard,
  unitCircle,
  type DynamicLine,
} from './materials.js';
import { ringedSpokeId } from './palette.js';

const ATMOSPHERE_SCALE = 1.18;
const AURORA_OPACITY = 0.55;
const TETHER_LIFT = 4;
const TETHER_SEGMENTS = 16;
const LABEL_LIFT = 2.4;

export function formatAge(minutes: number): string {
  if (minutes < 90) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}

interface SpokeParts {
  body: SpokeBody;
  group: Group;
  planet: Mesh;
  material: MeshStandardMaterial;
  atmosphere: Mesh;
  ring: Mesh | null;
  aurora: Mesh | null;
  auroraMaterial: MeshBasicMaterial | null;
  orbit: Line;
  orbitMaterial: LineBasicMaterial;
  color: string;
  isSecondary: boolean;
  tether: DynamicLine | null;
  label: Label;
  lastPast: boolean;
}

function buildRing(g: Group): Mesh {
  const material = standard('#D8C690', '#6B5A2A', 0.3, 0.6, DoubleSide);
  const ring = new Mesh(new RingGeometry(1.5, 2.3, 48), material);
  ring.rotation.x = -Math.PI / 2 + 0.35;
  g.add(ring);
  return ring;
}

function buildSpoke(ctx: SceneContext, body: SpokeBody, ringedId: string | null): SpokeParts {
  const { model } = ctx;
  const color = ctx.spokeColors.get(body.id) ?? '#FFFFFF';
  const g = group(ctx.world);
  const material = standard(color, color, 0.18);
  const planet = sphere(1, material, g, 28);
  planet.userData['pick'] = { kind: 'spoke', id: body.id };
  ctx.pickables.push(planet);
  const atmosphere = sphere(ATMOSPHERE_SCALE, glowMaterial(color, 0.14, BackSide), g, 24);
  const mats = [material];
  const ring = body.id === ringedId ? buildRing(g) : null;
  if (ring) mats.push(ring.material as typeof material);
  let aurora: Mesh | null = null;
  let auroraMaterial: MeshBasicMaterial | null = null;
  if (body.spoke.hasMl) {
    auroraMaterial = glowMaterial(model.visuals.colors.ml, 0);
    aurora = new Mesh(new TorusGeometry(1.25, 0.12, 8, 40), auroraMaterial);
    aurora.rotation.x = Math.PI / 2;
    g.add(aurora);
  }
  const tier = body.isIngest ? 'silver' : 'gold';
  ctx.fades.add(mats, tier, body.zone);
  const isSecondary = body.spoke.metastore !== model.topology.hub.metastore;
  const orbit = unitCircle(ctx, color, 0.2, tier, body.zone, isSecondary);
  const hasTether = isSecondary || body.spoke.isShared;
  const label = ctx.labels.add({
    id: `spoke:${body.id}`,
    className: 'planet',
    color,
    hasSmall: true,
    place: (out) => out.set(body.pos.x, body.pos.y + body.radius + LABEL_LIFT, body.pos.z),
  });
  return {
    body,
    group: g,
    planet,
    material,
    atmosphere,
    ring,
    aurora,
    auroraMaterial,
    orbit,
    orbitMaterial: orbit.material as LineBasicMaterial,
    color,
    isSecondary,
    tether: hasTether
      ? dynamicLine(ctx, model.visuals.colors.sharing, TETHER_SEGMENTS, 'silver', 'planets')
      : null,
    label,
    lastPast: false,
  };
}

function syncSpoke(ctx: SceneContext, s: SpokeParts, frame: Frame): void {
  const { body } = s;
  const r = body.radius;
  s.group.position.set(body.pos.x, body.pos.y, body.pos.z);
  s.planet.scale.setScalar(r);
  s.atmosphere.scale.setScalar(r);
  s.planet.rotation.y = frame.spin * 0.2;
  s.material.emissiveIntensity = 0.12 + 0.35 * body.activity + 0.6 * body.glow;
  s.orbit.scale.set(body.orbit, 1, body.orbit);
  if (body.pastTarget !== s.lastPast) {
    s.lastPast = body.pastTarget;
    s.orbitMaterial.color.set(body.pastTarget ? ctx.model.visuals.colors.warning : s.color);
  }
  s.ring?.scale.setScalar(r);
  if (s.aurora && s.auroraMaterial) {
    const ml = ctx.model.snapshot.workloads['ml'] ?? 0;
    s.aurora.scale.setScalar(r);
    s.aurora.rotation.z = frame.spin;
    s.auroraMaterial.opacity = frame.slots.has('aurora') ? ml * AURORA_OPACITY : 0;
  }
  if (s.tether) {
    setCurve(s.tether, ORIGIN, arcControl(ORIGIN, body.pos, TETHER_LIFT), body.pos);
    const base = s.isSecondary ? 0.35 : 0.12;
    s.tether.material.opacity = frame.slots.has('tether')
      ? (base + 0.3 * body.activity) * s.tether.fade.k
      : 0;
  }
}

export function buildSpokes(ctx: SceneContext): Part {
  const ringedId = ringedSpokeId(ctx.model.topology);
  const parts = ctx.model.spokes.map((body) => buildSpoke(ctx, body, ringedId));
  return {
    sync(frame) {
      for (const s of parts) syncSpoke(ctx, s, frame);
    },
    refresh() {
      for (const s of parts) {
        const { body } = s;
        const notes = [`${formatAge(body.age)} old`];
        if (body.pastTarget) notes.push('past target');
        if (s.isSecondary) notes.push('secondary metastore');
        ctx.labels.setText(s.label, body.spoke.name, notes.join(', '), body.pastTarget);
      }
    },
  };
}
