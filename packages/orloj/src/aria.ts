// SPDX-License-Identifier: Apache-2.0
import type { FaceModel } from './model/index.js';
import { ORLOJ_STRINGS, fill } from './strings.js';
import type { OrlojStrings } from './types.js';

function countOf(n: number, one: string, many: string): string {
  return fill(n === 1 ? one : many, { n });
}

/** Summary for assistive tech: environment name, open incidents, spokes past target. */
export function describeFaces(
  models: readonly FaceModel[],
  strings: OrlojStrings = ORLOJ_STRINGS,
): string {
  const t = strings.aria;
  if (models.length === 0) return `${t.prefix} ${t.noEnvironments}`;
  const faces = models.map((m) => {
    if (m.errorMessage !== null) return fill(t.faceNoData, { name: m.name });
    const f = m.figures;
    return fill(t.face, {
      name: m.name,
      incidents: countOf(f.openIncidents, t.incidentOne, t.incidentMany),
      spokes: countOf(f.spokesPastTarget, t.spokeOne, t.spokeMany),
    });
  });
  return fill(t.summary, { prefix: t.prefix, faces: faces.join(t.faceSeparator) });
}
