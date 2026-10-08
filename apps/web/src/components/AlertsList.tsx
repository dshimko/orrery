// SPDX-License-Identifier: Apache-2.0
import type { Alert } from '@orrery/core';
import { firstFocusTarget, sortAlerts } from '../lib/alerts.js';
import { formatIsoClock } from '../lib/format.js';
import type { PickTarget } from '@orrery/render';

export interface AlertsListProps {
  alerts: readonly Alert[];
  onFocus: (target: PickTarget) => void;
}

/** Open alerts, most severe first. Clicking one focuses its first target in the scene. */
export function AlertsList({ alerts, onFocus }: AlertsListProps) {
  const sorted = sortAlerts(alerts);
  return (
    <section aria-labelledby="alerts-h">
      <h2 id="alerts-h">Open alerts ({sorted.length})</h2>
      {sorted.length === 0 ? (
        <p className="lbl">No open alerts.</p>
      ) : (
        <ul className="alerts" data-testid="alerts">
          {sorted.map((alert) => {
            const target = firstFocusTarget(alert);
            return (
              <li key={alert.id} className={`sev-${alert.severity}`}>
                <div className="alert-head">
                  <span className={`badge sev-${alert.severity}`}>{alert.severity}</span>
                  {target ? (
                    <button
                      type="button"
                      className="alert-title"
                      onClick={() => {
                        onFocus(target);
                      }}
                    >
                      {alert.title}
                    </button>
                  ) : (
                    <b>{alert.title}</b>
                  )}
                </div>
                <p>{alert.text}</p>
                <p className="lbl">
                  Opened {formatIsoClock(alert.openedAt)} UTC
                  {alert.targets.length > 0 ? `. Affects ${alert.targets.join(', ')}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
