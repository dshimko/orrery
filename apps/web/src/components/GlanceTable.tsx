// SPDX-License-Identifier: Apache-2.0
import { formatIsoClock, formatPercent } from '../lib/format.js';
import type { GlanceRow } from '../lib/home.js';
import { TierBadge } from './TierBadge.js';

export interface GlanceTableProps {
  rows: readonly GlanceRow[];
  tierColors: Readonly<Record<string, string>>;
  fallbackColor: string;
  onSummary: (envId: string) => void;
}

function Cells({ row }: { row: GlanceRow }) {
  if (row.isLoading) {
    return <td colSpan={4}>Loading...</td>;
  }
  if (row.error !== null) {
    return (
      <td colSpan={4} className="glance-error">
        Unavailable: {row.error}
      </td>
    );
  }
  return (
    <>
      <td className="n">{row.openIncidents}</td>
      <td className="n">
        {row.spokesPastTarget} of {row.spokeCount}
      </td>
      <td className="n">{formatPercent(row.backlog ?? 0)}</td>
      <td>
        {row.next ? `${row.next.title}, ${formatIsoClock(row.next.at)} UTC` : 'Nothing more today'}
      </td>
    </>
  );
}

/** The text equivalent of the faces, one row per environment, each with a summary button. */
export function GlanceTable({ rows, tierColors, fallbackColor, onSummary }: GlanceTableProps) {
  return (
    <div className="table-scroll">
      <table className="glance" data-testid="glance-table">
        <caption className="sr-only">Environments at a glance</caption>
        <thead>
          <tr>
            <th scope="col">Environment</th>
            <th scope="col">Tier</th>
            <th scope="col">Open incidents</th>
            <th scope="col">Spokes past target</th>
            <th scope="col">Backlog</th>
            <th scope="col">Next event</th>
            <th scope="col">Summary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.env.id} data-env={row.env.id}>
              <th scope="row">{row.env.name}</th>
              <td>
                <TierBadge tier={row.env.tier} color={tierColors[row.env.tier] ?? fallbackColor} />
              </td>
              <Cells row={row} />
              <td>
                <button
                  type="button"
                  className="btn sm"
                  data-summary-for={row.env.id}
                  aria-label={`Show summary for ${row.env.name}`}
                  onClick={() => {
                    onSummary(row.env.id);
                  }}
                >
                  Summary
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
