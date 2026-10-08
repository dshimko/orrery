// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from 'react';
import { announcementForNew, diffAlerts, type SeenAlerts } from '../lib/alerts.js';
import type { HomeAlert } from '../lib/home.js';

export interface AlertWatch {
  /** New warning and incident alerts still open, newest first. Empty in replay. */
  items: readonly HomeAlert[];
  /** Polite screen reader text for the newest arrivals. */
  announcement: string;
  dismiss: () => void;
}

const NONE: SeenAlerts = new Map();

/**
 * Reports warning and incident alerts that open after the page loaded. Alerts present when an
 * environment first loads are not reported, and nothing is reported or kept in replay.
 */
export function useAlertWatch(
  loadedEnvIds: readonly string[],
  open: readonly HomeAlert[],
  isLive: boolean,
): AlertWatch {
  const loadedKey = loadedEnvIds.join(',');
  const seen = useRef<SeenAlerts>(NONE);
  const [pending, setPending] = useState<readonly HomeAlert[]>([]);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!isLive) {
      seen.current = NONE;
      setPending((current) => (current.length === 0 ? current : []));
      return;
    }
    const diff = diffAlerts(
      seen.current,
      loadedEnvIds,
      open.map((item) => ({ envId: item.env.id, alert: item.alert })),
    );
    seen.current = diff.seen;
    if (diff.fresh.length === 0) return;
    const freshItems = diff.fresh
      .map((entry) => open.find((item) => item.key === `${entry.envId}:${entry.alert.id}`))
      .filter((item): item is HomeAlert => item !== undefined);
    const freshKeys = new Set(freshItems.map((item) => item.key));
    setPending((current) => [...freshItems, ...current.filter((item) => !freshKeys.has(item.key))]);
    setAnnouncement(
      announcementForNew(freshItems.map((item) => ({ envName: item.env.name, alert: item.alert }))),
    );
    // `loadedEnvIds` is identified by `loadedKey`.
  }, [open, loadedKey, isLive]);

  const openKeys = useMemo(() => new Set(open.map((item) => item.key)), [open]);
  const items = useMemo(
    () => (isLive ? pending.filter((item) => openKeys.has(item.key)) : []),
    [pending, openKeys, isLive],
  );
  return {
    items,
    announcement: isLive ? announcement : '',
    dismiss: () => {
      setPending([]);
    },
  };
}
