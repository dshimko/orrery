// SPDX-License-Identifier: Apache-2.0
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { formatCount, formatIsoClock, formatPercent } from '../lib/format.js';
import type { GlanceRow, HomeAlert } from '../lib/home.js';
import { envPath } from '../lib/router.js';
import { Link } from './Link.js';
import { TierBadge } from './TierBadge.js';

export interface SummaryDialogProps {
  row: GlanceRow;
  alerts: readonly HomeAlert[];
  tierColor: string;
  onClose: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])';

/** Where focus returns when the opener is gone (a canvas click): the env's table button. */
function fallbackOpener(envId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-summary-for="${CSS.escape(envId)}"]`);
}

/**
 * Environment summary dialog. Focus moves into it on open, Tab wraps inside it, Escape closes
 * it, and focus returns to the opener on close, so it never traps focus once closed.
 */
export function SummaryDialog({ row, alerts, tierColor, onClose }: SummaryDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const envId = row.env.id;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      const target =
        opener && opener !== document.body && document.contains(opener)
          ? opener
          : fallbackOpener(envId);
      target?.focus();
    };
  }, [envId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      className="summary"
      data-testid="summary"
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-h"
      tabIndex={-1}
      style={{ borderTopColor: tierColor }}
      onKeyDown={onKeyDown}
    >
      <button type="button" className="x" aria-label="Close summary" onClick={onClose}>
        &times;
      </button>
      <h2 id="summary-h">{row.env.name}</h2>
      <p>
        <TierBadge tier={row.env.tier} color={tierColor} />
      </p>
      {row.error !== null ? (
        <p role="alert" className="glance-error">
          Unavailable: {row.error}
        </p>
      ) : row.isLoading ? (
        <p>Loading...</p>
      ) : (
        <dl className="summary-counts">
          <div>
            <dt>Open incidents</dt>
            <dd>{formatCount(row.openIncidents ?? 0)}</dd>
          </div>
          <div>
            <dt>Spokes past target</dt>
            <dd>
              {formatCount(row.spokesPastTarget ?? 0)} of {formatCount(row.spokeCount ?? 0)}
            </dd>
          </div>
          <div>
            <dt>Backlog</dt>
            <dd>{formatPercent(row.backlog ?? 0)}</dd>
          </div>
          <div>
            <dt>Next event</dt>
            <dd>
              {row.next
                ? `${row.next.title}, ${formatIsoClock(row.next.at)} UTC`
                : 'Nothing more today'}
            </dd>
          </div>
        </dl>
      )}
      <h3>Open alerts ({alerts.length})</h3>
      {alerts.length === 0 ? (
        <p className="lbl">No open alerts.</p>
      ) : (
        <ul className="alerts">
          {alerts.map(({ key, alert }) => (
            <li key={key} className={`sev-${alert.severity}`}>
              <span className={`badge sev-${alert.severity}`}>{alert.severity}</span>{' '}
              <b>{alert.title}</b>
              <span className="lbl"> {formatIsoClock(alert.openedAt)} UTC</span>
            </li>
          ))}
        </ul>
      )}
      <Link to={envPath(envId)} className="btn solid">
        Open system view
      </Link>
    </div>
  );
}
