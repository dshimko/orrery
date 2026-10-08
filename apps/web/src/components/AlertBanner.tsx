// SPDX-License-Identifier: Apache-2.0
import { formatIsoDual } from '../lib/format.js';
import type { HomeAlert } from '../lib/home.js';
import { Link } from './Link.js';

/** Alerts listed individually; the rest collapse into "+N more". */
export const BANNER_VISIBLE = 3;

export interface AlertBannerProps {
  /** Newest first. */
  items: readonly HomeAlert[];
  onDismiss: () => void;
  /** IANA zone for local times; the browser's by default. */
  timeZone?: string;
}

/** Dismissible banner of alerts that opened since the page loaded (live mode only). */
export function AlertBanner({ items, onDismiss, timeZone }: AlertBannerProps) {
  if (items.length === 0) return null;
  const shown = items.slice(0, BANNER_VISIBLE);
  const hidden = items.length - shown.length;
  return (
    <div className="alert-banner" data-testid="alert-banner" role="status">
      <ul>
        {shown.map(({ key, env, alert, href }) => (
          <li key={key}>
            <span className={`badge sev-${alert.severity}`}>{alert.severity}</span>{' '}
            <b>{env.name}</b>{' '}
            <Link to={href} className="alert-title">
              {alert.title}
            </Link>{' '}
            <span className="lbl">opened {formatIsoDual(alert.openedAt, timeZone)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="lbl">+{hidden} more</p>}
      <button type="button" className="btn sm" aria-label="Dismiss new alerts" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
