// SPDX-License-Identifier: Apache-2.0
// Alerts: light pillars (max 8, non-info only), expanding ring pulses from the ring pool, and a
// floating flag label per open alert.
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import type { Alert } from '@orrery/core';
import { refPosition } from '../sim/step.js';
import { CAPS } from '../sim/particles.js';
import type { Frame, Part, SceneContext } from './context.js';
import type { Label } from './labels.js';
import { glowMaterial } from './materials.js';

const PILLAR_LENGTH = 40;
const PILLAR_RISE = 20;
const PILLAR_BASE_OPACITY = 0.2;
const PILLAR_PULSE = 0.14;
const PILLAR_PULSE_RATE = 5;
const RING_OPACITY = 0.85;
const FLAG_LIFT = { incident: 13, warning: 13, info: 8 } as const;
const FLAG_CLASS = { incident: 'flag', warning: 'flag warn', info: 'flag info' } as const;

interface Pillar {
  mesh: Mesh;
  material: MeshBasicMaterial;
}

function buildPillars(ctx: SceneContext): Pillar[] {
  return Array.from({ length: CAPS.beacon }, () => {
    const material = glowMaterial(ctx.model.visuals.colors.incident, 0);
    const mesh = new Mesh(new CylinderGeometry(0.3, 0.3, PILLAR_LENGTH, 10, 1, true), material);
    mesh.visible = false;
    ctx.world.add(mesh);
    return { mesh, material };
  });
}

interface RingMesh extends Pillar {
  lastColor: string;
}

function buildRings(ctx: SceneContext): RingMesh[] {
  return Array.from({ length: CAPS.ring }, () => {
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(new RingGeometry(0.92, 1, 40), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    ctx.world.add(mesh);
    return { mesh, material, lastColor: '' };
  });
}

function syncPillars(ctx: SceneContext, pillars: Pillar[], frame: Frame): void {
  const { colors } = ctx.model.visuals;
  let used = 0;
  for (const alert of ctx.model.snapshot.alerts) {
    if (alert.severity === 'info') continue;
    for (const target of alert.targets) {
      const pillar = pillars[used];
      if (!pillar) break;
      const p = refPosition(ctx.model, target);
      pillar.mesh.visible = true;
      pillar.mesh.position.set(p.x, p.y + PILLAR_RISE, p.z);
      pillar.material.color.set(colors[alert.severity]);
      pillar.material.opacity =
        PILLAR_BASE_OPACITY +
        PILLAR_PULSE * (frame.reduced ? 0 : Math.sin(frame.anim * PILLAR_PULSE_RATE));
      used += 1;
    }
  }
  for (let i = used; i < pillars.length; i += 1) {
    const pillar = pillars[i];
    if (pillar) pillar.mesh.visible = false;
  }
}

function syncRings(rings: RingMesh[], frame: Frame): void {
  frame.pools.rings.forEach((ring, i) => {
    const mesh = rings[i];
    if (!mesh) return;
    mesh.mesh.visible = ring.active;
    if (!ring.active) return;
    mesh.mesh.position.set(ring.x, ring.y, ring.z);
    mesh.mesh.scale.setScalar(ring.r);
    mesh.material.opacity = Math.max(0, ring.life) * RING_OPACITY;
    if (ring.color !== mesh.lastColor) {
      mesh.lastColor = ring.color;
      mesh.material.color.set(ring.color);
    }
  });
}

export function buildAlerts(ctx: SceneContext): Part {
  const pillars = buildPillars(ctx);
  const rings = buildRings(ctx);
  const flags = new Map<string, Label>();

  const addFlag = (alert: Alert): Label => {
    const [first] = alert.targets;
    return ctx.labels.add({
      id: `flag:${alert.id}`,
      className: FLAG_CLASS[alert.severity],
      place: (out) => {
        const p = first ? refPosition(ctx.model, first) : { x: 0, y: 0, z: 0 };
        out.set(p.x, p.y + FLAG_LIFT[alert.severity], p.z);
      },
    });
  };

  return {
    sync(frame) {
      syncPillars(ctx, pillars, frame);
      syncRings(rings, frame);
    },
    refresh() {
      const open = new Map(ctx.model.snapshot.alerts.map((a) => [a.id, a]));
      for (const [id, label] of flags) {
        if (open.has(id)) continue;
        ctx.labels.remove(label);
        flags.delete(id);
      }
      for (const alert of open.values()) {
        let label = flags.get(alert.id);
        if (!label) {
          label = addFlag(alert);
          flags.set(alert.id, label);
        }
        ctx.labels.setText(label, alert.title);
      }
    },
  };
}
