// SPDX-License-Identifier: Apache-2.0
// Writes instance matrices straight into an InstancedMesh's Float32Array (column-major).

export const MATRIX_SIZE = 16;

/** Writes translate x rotateY x scale into slot `index`. Scale defaults to uniform `sx`. */
export function putMatrix(
  out: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  ry = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const o = index * MATRIX_SIZE;
  out[o] = c * sx;
  out[o + 1] = 0;
  out[o + 2] = -s * sx;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = sy;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = s * sz;
  out[o + 9] = 0;
  out[o + 10] = c * sz;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** How many instances an array can hold. */
export const capacityOf = (out: Float32Array): number => Math.floor(out.length / MATRIX_SIZE);
