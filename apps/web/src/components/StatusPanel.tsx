// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology, Visuals } from '@orrery/core';
import type { PickTarget } from '@orrery/render';
import { describePick } from '../lib/selection.js';
import { AlertsList } from './AlertsList.js';
import { MetricsPanel } from './MetricsPanel.js';
import { SelectionCard } from './SelectionCard.js';
import { WorkloadMix } from './WorkloadMix.js';

export interface StatusPanelProps {
  topology: Topology;
  snapshot: Snapshot;
  workloads: Visuals['workloads'];
  workload: string;
  selected: PickTarget | null;
  onWorkload: (workloadId: string) => void;
  onFocus: (target: PickTarget) => void;
  onCloseSelection: () => void;
}

/** Environment metrics, workload mix, open alerts, and the selection card. */
export function StatusPanel(props: StatusPanelProps) {
  const { topology, snapshot, selected } = props;
  const info = selected ? describePick(selected, topology, snapshot) : null;
  return (
    <aside className="panel" aria-label="Status">
      {info && <SelectionCard info={info} onClose={props.onCloseSelection} />}
      <MetricsPanel counts={snapshot.counts} />
      <WorkloadMix
        workloads={props.workloads}
        activity={snapshot.workloads}
        selected={props.workload}
        onSelect={props.onWorkload}
      />
      <AlertsList alerts={snapshot.alerts} onFocus={props.onFocus} />
    </aside>
  );
}
