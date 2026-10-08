// SPDX-License-Identifier: Apache-2.0
import type { Snapshot } from '@orrery/core';
import { formatCount } from '../lib/format.js';

export interface MetricsPanelProps {
  counts: Snapshot['counts'];
}

const METRICS: readonly { key: keyof Snapshot['counts']; label: string }[] = [
  { key: 'runningPipelines', label: 'Running pipelines' },
  { key: 'failedRuns', label: 'Failed runs' },
  { key: 'spokesPastTarget', label: 'Spokes past target' },
  { key: 'deploysToday', label: 'Deploys today' },
  { key: 'products', label: 'Data products' },
  { key: 'openIncidents', label: 'Open incidents' },
];

export function MetricsPanel({ counts }: MetricsPanelProps) {
  return (
    <section aria-labelledby="metrics-h">
      <h2 id="metrics-h">Environment</h2>
      <dl className="metrics">
        {METRICS.map((metric) => (
          <div key={metric.key}>
            <dt>{metric.label}</dt>
            <dd>{formatCount(counts[metric.key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
