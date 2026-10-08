// SPDX-License-Identifier: Apache-2.0
import type { FaceModel } from './model/index.js';

const PREFIX = 'Orloj clock view, one clock face per environment.';

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Summary for assistive tech: environment name, open incidents, spokes past target. */
export function describeFaces(models: readonly FaceModel[]): string {
  if (models.length === 0) return `${PREFIX} No environments.`;
  const parts = models.map((m) => {
    if (m.errorMessage !== null) return `${m.name}: no data`;
    const f = m.figures;
    return `${m.name}: ${plural(f.openIncidents, 'open incident')}, ${plural(f.spokesPastTarget, 'spoke')} past target`;
  });
  return `${PREFIX} ${parts.join('. ')}.`;
}
