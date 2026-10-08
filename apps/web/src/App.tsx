// SPDX-License-Identifier: Apache-2.0
import { useMemo } from 'react';
import { ErrorState } from './components/ErrorState.js';
import { useRoute } from './hooks/useRoute.js';
import { type Api, createApi } from './lib/api.js';
import type { Query, Route } from './lib/router.js';
import { WallDriver } from './components/WallDriver.js';
import { ComparePage } from './pages/ComparePage.js';
import { HomePage } from './pages/HomePage.js';
import { SystemPage } from './pages/SystemPage.js';

/** Routes `/` to the Orloj home, `/env/:id` to the system view, and `/compare` to compare mode. */
export function App() {
  const api = useMemo(() => createApi(), []);
  const { route, query } = useRoute();
  return (
    <>
      <Page api={api} route={route} query={query} />
      <WallDriver api={api} />
    </>
  );
}

function Page({ api, route, query }: { api: Api; route: Route; query: Query }) {
  switch (route.name) {
    case 'home':
      return <HomePage api={api} query={query} />;
    case 'env':
      return <SystemPage api={api} envId={route.id} query={query} />;
    case 'compare':
      return <ComparePage api={api} query={query} />;
    case 'notFound':
      return <ErrorState title="Page not found" message="There is nothing at this address." />;
  }
}
