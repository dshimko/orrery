// SPDX-License-Identifier: Apache-2.0
import { useMemo } from 'react';
import { useIncidentAnnouncer } from '../hooks/useIncidentAnnouncer.js';
import type { HomeAlert } from '../lib/home.js';

/**
 * An aria-live region announcing incidents that open on any environment after the first load.
 * Mount it only once every environment has loaded, so the starting incidents are not announced.
 */
export function HomeAnnouncer({ alerts }: { alerts: readonly HomeAlert[] }) {
  const named = useMemo(
    () =>
      alerts.map(({ key, env, alert }) => ({
        ...alert,
        id: key,
        title: `${env.name}: ${alert.title}`,
      })),
    [alerts],
  );
  const announcement = useIncidentAnnouncer(named);
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {announcement}
    </div>
  );
}
