// SPDX-License-Identifier: Apache-2.0
import { useMemo } from 'react';
import { ErrorState } from '../components/ErrorState.js';
import { useEnvLoad } from '../hooks/useEnvLoad.js';
import type { Api, ApiError } from '../lib/api.js';
import { DEFAULT_START_MINUTE, parseDate, parseDeepLink, startOfDayAt } from '../lib/params.js';
import type { Query } from '../lib/router.js';
import { SystemReady } from './SystemReady.js';

export interface SystemPageProps {
  api: Api;
  envId: string;
  query: Query;
}

function friendlyMessage(error: ApiError): string {
  if (error.status === 404) return 'This environment does not exist.';
  if (error.status === 503 || error.code === 'network_error') {
    return `This environment is unavailable right now. ${error.message}`;
  }
  return error.message;
}

/** Loads one environment, then hands off to the interactive view. */
export function SystemPage({ api, envId, query }: SystemPageProps) {
  // The deep link is read once per environment; later URL updates must not reload the page.
  const link = useMemo(() => parseDeepLink(query), [envId]);
  const startAt = useMemo(
    () =>
      startOfDayAt(
        (link.date !== null ? parseDate(link.date) : null) ?? new Date(),
        link.minuteOfDay ?? DEFAULT_START_MINUTE,
      ),
    [link],
  );
  const load = useEnvLoad(api, envId, startAt);

  if (load.status === 'loading') {
    return (
      <main className="message-page" aria-busy="true">
        <p role="status">Loading environment...</p>
      </main>
    );
  }
  if (load.status === 'error') {
    return <ErrorState title="Environment unavailable" message={friendlyMessage(load.error)} />;
  }
  return <SystemReady key={envId} api={api} envId={envId} data={load.data} link={link} />;
}
