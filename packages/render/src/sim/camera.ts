// SPDX-License-Identifier: Apache-2.0
// Six-axis camera: a quaternion orbit around a target with yaw, pitch, roll, pan, and dolly.
// Pure math on three's Quaternion/Vector3 (no WebGL), so it runs in Node tests.
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { approachFactor, decay, type Visuals } from '@orrery/core';
import type { CameraState, CameraViewKey } from '../types.js';
import { clamp, rad, type Vec3 } from './math.js';

const MIN_DISTANCE = 6;
const MAX_DISTANCE = 1100;
const INERTIA_EPSILON = 0.002;
const SPIN_RATE = 0.12;
const NEAR_VERTICAL = 0.98;
const BASE_FIT_DISTANCE = 380;
const WIDE_ASPECT = 1.78;

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

interface Pose {
  target: Vector3;
  distance: number;
  rotation: Quaternion;
}

export function presetRotation(pitchDeg: number, yawDeg = 0): Quaternion {
  return new Quaternion().setFromEuler(new Euler(-rad(pitchDeg), rad(yawDeg), 0, 'YXZ'));
}

export interface ViewContext {
  aspect: number;
  ingest: Vec3 | null;
  yard: Vec3;
}

interface ViewPreset {
  target: Vec3;
  distance: number;
  pitch: number;
  yaw: number;
  /** Keep following the ingest spoke as it orbits. */
  followIngest?: boolean;
}

/** Overview distance that fits the system for the viewport's aspect ratio. */
export function fitDistance(aspect: number): number {
  return clamp(BASE_FIT_DISTANCE * Math.max(1, WIDE_ASPECT / Math.max(0.1, aspect)), 200, 900);
}

export function viewPreset(key: CameraViewKey, ctx: ViewContext): ViewPreset {
  const origin = { x: 0, y: 0, z: 0 };
  switch (key) {
    case 'belt':
      return { target: { x: -118, y: 0, z: -2 }, distance: 110, pitch: 42, yaw: -20 };
    case 'ingest':
      return { target: ctx.ingest ?? origin, distance: 44, pitch: 35, yaw: 0, followIngest: true };
    case 'earth':
      return { target: origin, distance: 48, pitch: 28, yaw: 0 };
    case 'planets':
      return { target: origin, distance: 250, pitch: 62, yaw: 0 };
    case 'stations':
      return { target: origin, distance: 34, pitch: 22, yaw: 30 };
    case 'yard':
      return { target: ctx.yard, distance: 34, pitch: 30, yaw: -30 };
    case 'over':
    default:
      return {
        target: { x: -14, y: 0, z: 0 },
        distance: fitDistance(ctx.aspect),
        pitch: 50,
        yaw: 0,
      };
  }
}

export class CameraRig {
  /** Current pose, tweened toward `goal` every frame. */
  readonly pose: Pose;
  readonly goal: Pose;
  private readonly inertia = { x: 0, y: 0 };
  private follow: (() => Vec3) | null = null;
  spin = false;
  dragging = false;
  /** True once the user moved the camera; resize then keeps their view. */
  userMoved = false;

  constructor(
    private readonly visuals: Visuals['camera'],
    initial?: CameraState,
  ) {
    const start = initial
      ? fromState(initial)
      : fromPreset(
          viewPreset('over', { aspect: WIDE_ASPECT, ingest: null, yard: { x: 0, y: 0, z: 0 } }),
        );
    this.pose = clonePose(start);
    this.goal = clonePose(start);
  }

  /** Rotate about a camera-local axis immediately (drag, keys). */
  rotateLocal(axis: 'x' | 'y' | 'z', angle: number): void {
    const q = new Quaternion().setFromAxisAngle(axis === 'x' ? X : axis === 'y' ? Y : Z, angle);
    this.pose.rotation.multiply(q).normalize();
    this.goal.rotation.copy(this.pose.rotation);
    this.userMoved = true;
  }

  /** Records drag velocity so the view coasts after release (inertia). */
  setInertia(yawPerSecond: number, pitchPerSecond: number): void {
    this.inertia.y = yawPerSecond;
    this.inertia.x = pitchPerSecond;
  }

  rotateWorldY(angle: number): void {
    const q = new Quaternion().setFromAxisAngle(Y, angle);
    this.pose.rotation.premultiply(q).normalize();
    this.goal.rotation.copy(this.pose.rotation);
  }

  /** World units per screen pixel at the target distance. */
  unitsPerPixel(viewportHeight: number): number {
    return (
      (2 * this.pose.distance * Math.tan(rad(this.visuals.fovDeg / 2))) /
      Math.max(1, viewportHeight)
    );
  }

  pan(dxPx: number, dyPx: number, viewportHeight: number): void {
    const k = this.unitsPerPixel(viewportHeight);
    const right = X.clone().applyQuaternion(this.pose.rotation);
    const up = Y.clone().applyQuaternion(this.pose.rotation);
    this.pose.target.addScaledVector(right, -dxPx * k).addScaledVector(up, dyPx * k);
    this.goal.target.copy(this.pose.target);
    this.follow = null;
    this.userMoved = true;
  }

  dolly(factor: number): void {
    this.pose.distance = clamp(this.pose.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    this.goal.distance = this.pose.distance;
    this.userMoved = true;
  }

  /** Tween to a level horizon: keep where we look from and at, drop any roll. */
  levelHorizon(): void {
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.pose.rotation);
    const eye = this.pose.target.clone().addScaledVector(forward, -this.pose.distance);
    const up = Math.abs(forward.y) > NEAR_VERTICAL ? new Vector3(0, 0, -1) : Y;
    this.goal.rotation.setFromRotationMatrix(new Matrix4().lookAt(eye, this.pose.target, up));
  }

  goView(key: CameraViewKey, ctx: ViewContext, ingestPosition?: () => Vec3): void {
    const preset = viewPreset(key, ctx);
    Object.assign(this.goal, fromPreset(preset));
    this.follow = preset.followIngest && ingestPosition ? ingestPosition : null;
    this.inertia.x = 0;
    this.inertia.y = 0;
  }

  followTarget(position: () => Vec3, distance: number): void {
    this.follow = position;
    this.goal.distance = distance;
    this.inertia.x = 0;
    this.inertia.y = 0;
  }

  reset(ctx: ViewContext): void {
    this.userMoved = false;
    this.goView('over', ctx);
  }

  /** Advances inertia, spin, follow, and the tween (factor 1 − e^(−rate·dt)). */
  step(dt: number): void {
    const coasting =
      Math.abs(this.inertia.x) > INERTIA_EPSILON || Math.abs(this.inertia.y) > INERTIA_EPSILON;
    if (!this.dragging && coasting) {
      this.rotateLocal('y', this.inertia.y * dt);
      this.rotateLocal('x', this.inertia.x * dt);
      this.inertia.x = decay(this.inertia.x, this.visuals.inertiaDecay, dt);
      this.inertia.y = decay(this.inertia.y, this.visuals.inertiaDecay, dt);
    } else if (!coasting) {
      this.inertia.x = 0;
      this.inertia.y = 0;
    }
    if (this.spin && !this.dragging) this.rotateWorldY(dt * SPIN_RATE);
    if (this.follow) {
      const p = this.follow();
      this.goal.target.set(p.x, p.y, p.z);
    }
    const k = approachFactor(this.visuals.tweenRate, dt);
    this.pose.target.lerp(this.goal.target, k);
    this.pose.distance += (this.goal.distance - this.pose.distance) * k;
    this.pose.rotation.slerp(this.goal.rotation, k);
  }

  /** Camera world position: target + rotation applied to (0, 0, distance). */
  position(): Vector3 {
    return Z.clone()
      .multiplyScalar(this.pose.distance)
      .applyQuaternion(this.pose.rotation)
      .add(this.pose.target);
  }

  getState(): CameraState {
    const { target, distance, rotation } = this.goal;
    return {
      target: [target.x, target.y, target.z],
      distance,
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    };
  }

  setState(state: CameraState): void {
    const pose = fromState(state);
    Object.assign(this.pose, clonePose(pose));
    Object.assign(this.goal, clonePose(pose));
    this.follow = null;
  }
}

function fromPreset(preset: ViewPreset): Pose {
  return {
    target: new Vector3(preset.target.x, preset.target.y, preset.target.z),
    distance: preset.distance,
    rotation: presetRotation(preset.pitch, preset.yaw),
  };
}

function fromState(state: CameraState): Pose {
  return {
    target: new Vector3(...state.target),
    distance: clamp(state.distance, MIN_DISTANCE, MAX_DISTANCE),
    rotation: new Quaternion(...state.rotation).normalize(),
  };
}

function clonePose(pose: Pose): Pose {
  return { target: pose.target.clone(), distance: pose.distance, rotation: pose.rotation.clone() };
}
