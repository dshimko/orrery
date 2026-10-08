// SPDX-License-Identifier: Apache-2.0
import type { CameraState } from '@orrery/render';

const KEY_PREFIX = 'orrery.camera.';
const VECTOR_LENGTHS = { target: 3, rotation: 4 } as const;

function isNumbers(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function isCamera(value: unknown): value is CameraState {
  if (typeof value !== 'object' || value === null) return false;
  const camera = value as Record<string, unknown>;
  return (
    isNumbers(camera.target, VECTOR_LENGTHS.target) &&
    isNumbers(camera.rotation, VECTOR_LENGTHS.rotation) &&
    typeof camera.distance === 'number' &&
    Number.isFinite(camera.distance)
  );
}

/** Saves the camera for an environment in sessionStorage; storage failures are ignored. */
export function saveCamera(envId: string, camera: CameraState): void {
  try {
    window.sessionStorage.setItem(KEY_PREFIX + envId, JSON.stringify(camera));
  } catch {
    // Storage can be unavailable (private mode, quota); camera memory is best effort.
  }
}

export function loadCamera(envId: string): CameraState | undefined {
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + envId);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isCamera(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
