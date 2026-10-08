// SPDX-License-Identifier: Apache-2.0
import type { Alert } from '@orrery/core';
import { useEffect, useRef, useState } from 'react';
import { announcementFor, newIncidents } from '../lib/alerts.js';

/** At most one announcement per interval keeps screen readers from being flooded. */
export const ANNOUNCE_INTERVAL_MS = 5000;

/** Text for an aria-live region announcing incidents that appear after the page loaded. */
export function useIncidentAnnouncer(alerts: readonly Alert[]): string {
  const seen = useRef<Set<string> | null>(null);
  const lastAt = useRef(Number.NEGATIVE_INFINITY);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(alerts.map((alert) => alert.id));
      return;
    }
    const fresh = newIncidents(seen.current, alerts);
    if (fresh.length === 0 || Date.now() - lastAt.current < ANNOUNCE_INTERVAL_MS) return;
    for (const alert of fresh) seen.current.add(alert.id);
    lastAt.current = Date.now();
    setMessage(announcementFor(fresh));
  }, [alerts]);

  return message;
}
