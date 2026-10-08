// SPDX-License-Identifier: Apache-2.0

/**
 * FNV-1a hash of the environment id: a stable per-environment seed (stability rule 5). The
 * system view and the Orloj faces share it so one environment looks the same on every page.
 */
export function seedFor(envId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < envId.length; index += 1) {
    hash = Math.imul(hash ^ envId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}
