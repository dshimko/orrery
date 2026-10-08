// SPDX-License-Identifier: Apache-2.0
import type { Visuals } from '@orrery/core';
import { formatPercent } from '../lib/format.js';

export interface WorkloadMixProps {
  workloads: Visuals['workloads'];
  activity: Readonly<Record<string, number>>;
  selected: string;
  onSelect: (workloadId: string) => void;
}

/** Activity bars per workload; pressing one filters the scene to it (press again to clear). */
export function WorkloadMix({ workloads, activity, selected, onSelect }: WorkloadMixProps) {
  return (
    <section aria-labelledby="workloads-h">
      <h2 id="workloads-h">Workloads</h2>
      <ul className="wls">
        {workloads.map((workload) => {
          const value = activity[workload.id] ?? 0;
          const isSelected = selected === workload.id;
          return (
            <li key={workload.id}>
              <button
                type="button"
                className="wl"
                aria-pressed={isSelected}
                onClick={() => {
                  onSelect(isSelected ? 'all' : workload.id);
                }}
              >
                <i style={{ background: workload.color }} aria-hidden="true" />
                <b>{workload.name}</b>
                <span className="pc">{formatPercent(value)}</span>
                <span className="bar" aria-hidden="true">
                  <u style={{ width: formatPercent(value), background: workload.color }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
