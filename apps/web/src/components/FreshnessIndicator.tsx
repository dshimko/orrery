// SPDX-License-Identifier: Apache-2.0
import { formatElapsed } from '../lib/format.js';
import type { FreshnessSummary } from '../lib/freshness.js';

export interface FreshnessIndicatorProps {
  /** Hidden in replay. */
  isLive: boolean;
  summary: FreshnessSummary;
  /** Wall-clock ms; the page re-renders at 4 Hz so the text stays current. */
  nowMs: number;
}

/** "Live · updated 12 s ago", or an amber warning after repeated failed polls. */
export function FreshnessIndicator({ isLive, summary, nowMs }: FreshnessIndicatorProps) {
  if (!isLive) return null;
  if (summary.isStale) {
    return (
      <p className="freshness stale" data-testid="freshness" data-stale="true" role="status">
        Data may be stale
      </p>
    );
  }
  const updated =
    summary.lastOkMs === null
      ? 'waiting for data'
      : `updated ${formatElapsed(nowMs - summary.lastOkMs)}`;
  return (
    <p className="freshness" data-testid="freshness" data-stale="false">
      Live · {updated}
    </p>
  );
}
