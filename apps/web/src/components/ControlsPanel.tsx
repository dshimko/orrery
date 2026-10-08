// SPDX-License-Identifier: Apache-2.0
import type { Visuals } from '@orrery/core';
import type { CameraViewKey, TierFilter } from '@orrery/render';

export interface ControlsPanelProps {
  tier: TierFilter;
  workload: string;
  focusAlerts: boolean;
  reducedMotion: boolean;
  workloads: Visuals['workloads'];
  hasFederation: boolean;
  onTier: (tier: TierFilter) => void;
  onWorkload: (workload: string) => void;
  onFocusAlerts: (value: boolean) => void;
  onReducedMotion: (value: boolean) => void;
  onView: (key: CameraViewKey) => void;
  onResetCamera: () => void;
  onLevelHorizon: () => void;
}

const TIER_OPTIONS: readonly { value: TierFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bronze', label: 'Bronze' },
  { value: 'silver', label: 'Silver' },
  { value: 'gold', label: 'Gold' },
  { value: 'use', label: 'Use case' },
];

const VIEW_OPTIONS: readonly { key: CameraViewKey; label: string }[] = [
  { key: 'over', label: 'Overview' },
  { key: 'belt', label: 'Sources' },
  { key: 'ingest', label: 'Ingest spoke' },
  { key: 'earth', label: 'Core' },
  { key: 'planets', label: 'Planets' },
  { key: 'stations', label: 'Stations' },
  { key: 'yard', label: 'Shipyard' },
];

/** Filters, focus toggle, motion toggle, and camera buttons. */
export function ControlsPanel(props: ControlsPanelProps) {
  const { workloads } = props;
  return (
    <aside className="panel" aria-label="Controls">
      <h2>Tier focus</h2>
      <div className="row" role="group" aria-label="Tier filter">
        {TIER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="btn sm"
            aria-pressed={props.tier === option.value}
            onClick={() => {
              props.onTier(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="lbl">Workload</span>
        <select
          value={props.workload}
          onChange={(event) => {
            props.onWorkload(event.target.value);
          }}
        >
          <option value="all">All workloads</option>
          {workloads.map((workload) => (
            <option key={workload.id} value={workload.id}>
              {workload.name}
            </option>
          ))}
          {props.hasFederation && <option value="federated">Federated queries</option>}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={props.focusAlerts}
          onChange={(event) => {
            props.onFocusAlerts(event.target.checked);
          }}
        />
        Focus on alerts (dim unrelated areas)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={props.reducedMotion}
          onChange={(event) => {
            props.onReducedMotion(event.target.checked);
          }}
        />
        Reduce motion
      </label>
      <h2>Camera</h2>
      <div className="row" role="group" aria-label="Fly to">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className="btn sm"
            onClick={() => {
              props.onView(option.key);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn sm" onClick={props.onResetCamera}>
          Reset camera
        </button>
        <button type="button" className="btn sm" onClick={props.onLevelHorizon}>
          Level horizon
        </button>
      </div>
    </aside>
  );
}
