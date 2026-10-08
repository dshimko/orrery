// SPDX-License-Identifier: Apache-2.0
// Mesh and line helpers shared by the scene parts.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type ColorRepresentation,
  type Object3D,
  type Side,
} from 'three';
import { bezier, TAU, type Vec3 } from '../sim/math.js';
import type { Zone } from '../types.js';
import type { SceneContext } from './context.js';
import type { Fadable, FadeTier } from './fade.js';

const CIRCLE_SEGMENTS = 128;
const SPHERE_ASPECT = 0.7;
const SPHERE_SEGMENTS = 24;

export function standard(
  color: ColorRepresentation,
  emissive: ColorRepresentation = 0,
  intensity = 0,
  opacity = 1,
  side: Side = FrontSide,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.1,
    roughness: 0.75,
    transparent: true,
    opacity,
    side,
  });
}

export function glowMaterial(
  color: ColorRepresentation,
  opacity: number,
  side: Side = FrontSide,
): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side,
  });
}

export function ringMaterial(color: ColorRepresentation, opacity: number): MeshStandardMaterial {
  return standard(color, color, 0.3, opacity, DoubleSide);
}

export function box(
  size: readonly [number, number, number],
  material: MeshStandardMaterial,
  at: readonly [number, number, number],
  parent: Object3D,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.position.set(...at);
  parent.add(mesh);
  return mesh;
}

export function sphere(
  radius: number,
  material: MeshStandardMaterial | MeshBasicMaterial,
  parent: Object3D,
  segments = SPHERE_SEGMENTS,
): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(radius, segments, Math.round(segments * SPHERE_ASPECT)),
    material,
  );
  parent.add(mesh);
  return mesh;
}

export function group(parent: Object3D): Group {
  const g = new Group();
  parent.add(g);
  return g;
}

/** A unit circle in the XZ plane; scale it to the orbit radius. */
export function unitCircle(
  ctx: SceneContext,
  color: ColorRepresentation,
  opacity: number,
  tier: FadeTier,
  zone: Zone,
  dashed = false,
): Line {
  const points = Array.from({ length: CIRCLE_SEGMENTS + 1 }, (_, i) => {
    const a = (i / CIRCLE_SEGMENTS) * TAU;
    return new Vector3(Math.cos(a), 0, Math.sin(a));
  });
  const material = dashed
    ? new LineDashedMaterial({
        color,
        transparent: true,
        opacity,
        dashSize: 0.03,
        gapSize: 0.03,
      })
    : new LineBasicMaterial({ color, transparent: true, opacity });
  const line = new Line(new BufferGeometry().setFromPoints(points), material);
  if (dashed) line.computeLineDistances();
  ctx.world.add(line);
  ctx.fades.add([material], tier, zone);
  return line;
}

export interface DynamicLine {
  readonly line: Line;
  readonly material: LineBasicMaterial;
  readonly segments: number;
  /** Multiply the line's opacity by `fade.k` each frame. */
  readonly fade: Fadable;
}

/** A line whose points are rewritten every frame (tethers, beams, laser tracks). */
export function dynamicLine(
  ctx: SceneContext,
  color: ColorRepresentation,
  segments: number,
  tier: FadeTier,
  zone: Zone,
): DynamicLine {
  const points = Array.from({ length: segments + 1 }, () => new Vector3());
  const material = new LineBasicMaterial({ color, transparent: true, opacity: 0 });
  const line = new Line(new BufferGeometry().setFromPoints(points), material);
  line.frustumCulled = false;
  ctx.world.add(line);
  return { line, material, segments, fade: ctx.fades.add([], tier, zone) };
}

export function setCurve(target: DynamicLine, a: Vec3, c: Vec3, b: Vec3): void {
  const position = target.line.geometry.attributes['position'];
  if (!position) return;
  for (let j = 0; j <= target.segments; j += 1) {
    const p = bezier(a, c, b, j / target.segments);
    position.setXYZ(j, p.x, p.y, p.z);
  }
  position.needsUpdate = true;
}

export function setSegment(target: DynamicLine, a: Vec3, b: Vec3): void {
  const position = target.line.geometry.attributes['position'];
  if (!position) return;
  position.setXYZ(0, a.x, a.y, a.z);
  position.setXYZ(1, b.x, b.y, b.z);
  position.needsUpdate = true;
}
