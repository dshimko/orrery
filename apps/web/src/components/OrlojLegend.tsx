// SPDX-License-Identifier: Apache-2.0
import { legendEntries, type OrlojFace } from '@orrery/orloj';
import { useMemo } from 'react';
import { useThrottled } from '../hooks/useThrottled.js';
import { LEGEND_THROTTLE_MS, legendRows } from '../lib/guidance.js';
import { GUIDANCE_TEXT } from '../lib/orloj-text.js';

/**
 * Collapsible "How to read the clock" legend under the faces: what the clock is for, how to use
 * it, then every part with its number, name, and definition. Parts a face cannot show say why,
 * muted. It follows data updates at most four times a second.
 */
export function OrlojLegend({ faces }: { faces: readonly OrlojFace[] }) {
  const shown = useThrottled(faces, LEGEND_THROTTLE_MS);
  const rows = useMemo(() => legendRows(legendEntries(shown)), [shown]);
  return (
    <details className="orloj-legend" data-testid="orloj-legend">
      <summary>{GUIDANCE_TEXT.legendTitle}</summary>
      <p className="orloj-legend-purpose">{GUIDANCE_TEXT.legendPurpose}</p>
      <p className="orloj-legend-use">{GUIDANCE_TEXT.legendHowToUse}</p>
      <ul className="orloj-legend-list">
        {rows.map((row) => (
          <li
            key={row.part}
            className={row.reason === null ? undefined : 'is-unavailable'}
            data-part={row.part}
          >
            <span className="orloj-legend-num" aria-hidden="true">
              {row.number}
            </span>
            <span>
              <b className="orloj-legend-name">{row.name}</b>{' '}
              <span className="orloj-legend-text">{row.definition ?? row.reason}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
