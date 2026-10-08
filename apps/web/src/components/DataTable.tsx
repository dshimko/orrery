// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology } from '@orrery/core';
import { sortAlerts } from '../lib/alerts.js';
import { formatAge, formatPercent } from '../lib/format.js';

export interface DataTableProps {
  topology: Topology;
  snapshot: Snapshot;
}

/** Text equivalent of the 3D scene: every spoke, station, source group, and open alert. */
export function DataTable({ topology, snapshot }: DataTableProps) {
  const spokeState = new Map(snapshot.spokes.map((spoke) => [spoke.id, spoke]));
  const useCaseState = new Map(snapshot.useCases.map((item) => [item.id, item]));
  const groupState = new Map(snapshot.sourceGroups.map((group) => [group.id, group]));
  return (
    <details className="data-table" data-testid="data-table" open>
      <summary>Data table (text equivalent of the scene)</summary>
      <table>
        <caption>Spokes</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Data age</th>
            <th scope="col">Target</th>
            <th scope="col">Past target</th>
            <th scope="col">Activity</th>
          </tr>
        </thead>
        <tbody>
          {topology.spokes.map((spoke) => {
            const state = spokeState.get(spoke.id);
            return (
              <tr key={spoke.id}>
                <th scope="row">{spoke.name}</th>
                <td>{spoke.role}</td>
                <td>{state ? formatAge(state.ageMinutes) : 'n/a'}</td>
                <td>{formatAge(state?.targetMinutes ?? spoke.freshness.targetMinutes)}</td>
                <td>{state ? (state.pastTarget ? 'yes' : 'no') : 'n/a'}</td>
                <td>{state ? formatPercent(state.activity) : 'n/a'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table>
        <caption>Stations</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Status</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {topology.useCases.map((useCase) => {
            const state = useCaseState.get(useCase.id);
            return (
              <tr key={useCase.id}>
                <th scope="row">{useCase.name}</th>
                <td>{state?.status ?? 'n/a'}</td>
                <td>{state?.note ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table>
        <caption>Source groups</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Activity</th>
          </tr>
        </thead>
        <tbody>
          {topology.sourceGroups.map((group) => {
            const state = groupState.get(group.id);
            return (
              <tr key={group.id}>
                <th scope="row">{group.name}</th>
                <td>{state ? formatPercent(state.activity) : 'n/a'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table>
        <caption>Open alerts</caption>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Title</th>
            <th scope="col">Targets</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.alerts.length === 0 ? (
            <tr>
              <td colSpan={3}>No open alerts.</td>
            </tr>
          ) : (
            sortAlerts(snapshot.alerts).map((alert) => (
              <tr key={alert.id}>
                <td>{alert.severity}</td>
                <th scope="row">{alert.title}</th>
                <td>{alert.targets.join(', ')}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </details>
  );
}
