// SPDX-License-Identifier: Apache-2.0
import { formatIsoClock } from '../lib/format.js';
import type { HomeAlert } from '../lib/home.js';
import { Link } from './Link.js';

export interface HomeAlertsProps {
  alerts: readonly HomeAlert[];
  tierColors: Readonly<Record<string, string>>;
  fallbackColor: string;
}

/** Open alerts across all environments, already sorted by severity then time. */
export function HomeAlerts({ alerts, tierColors, fallbackColor }: HomeAlertsProps) {
  if (alerts.length === 0) {
    return (
      <p className="lbl" data-testid="home-alerts">
        No open alerts. All environments are on schedule.
      </p>
    );
  }
  return (
    <ul className="alerts home-alerts" data-testid="home-alerts">
      {alerts.map(({ key, env, alert, href }) => (
        <li key={key} className={`sev-${alert.severity}`}>
          <div className="alert-head">
            <span className={`badge sev-${alert.severity}`}>{alert.severity}</span>
            <Link to={href} className="alert-title">
              {alert.title}
            </Link>
          </div>
          <p className="lbl">
            <b style={{ color: tierColors[env.tier] ?? fallbackColor }}>{env.name}</b>
            {' · '}
            {formatIsoClock(alert.openedAt)} UTC
          </p>
        </li>
      ))}
    </ul>
  );
}
