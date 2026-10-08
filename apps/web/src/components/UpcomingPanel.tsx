// SPDX-License-Identifier: Apache-2.0
import { formatCountdown, formatDualClock } from '../lib/format.js';
import type { UpcomingItem } from '../lib/upcoming.js';
import { TierBadge } from './TierBadge.js';

export interface UpcomingPanelProps {
  items: readonly UpcomingItem[];
  /** The shown time; the page re-renders at 4 Hz so countdowns stay current. */
  now: Date;
  tierColors: Readonly<Record<string, string>>;
  fallbackColor: string;
  /** Show the environment name on each row (home); the system view omits it. */
  showEnv: boolean;
  /** IANA zone for local times; the browser's by default. */
  timeZone?: string;
}

/** Planned windows in the next 24 hours with start times in UTC and local time. */
export function UpcomingPanel({
  items,
  now,
  tierColors,
  fallbackColor,
  showEnv,
  timeZone,
}: UpcomingPanelProps) {
  return (
    <section className="panel" aria-labelledby="upcoming-h" data-testid="upcoming">
      <h2 id="upcoming-h">Upcoming (next 24 h)</h2>
      {items.length === 0 ? (
        <p className="lbl">Nothing planned in the next 24 hours.</p>
      ) : (
        <ul className="upcoming">
          {items.map(({ key, env, window, startMs }) => (
            <li key={key} data-testid="upcoming-row">
              <div className="alert-head">
                <TierBadge tier={env.tier} color={tierColors[env.tier] ?? fallbackColor} />
                {showEnv && <b>{env.name}</b>}
                <span className="alert-title">{window.title}</span>
              </div>
              <p className="lbl">
                {window.kind} · {formatDualClock(new Date(startMs), timeZone)} ·{' '}
                <span data-testid="upcoming-countdown">
                  {formatCountdown(startMs, now.getTime())}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
