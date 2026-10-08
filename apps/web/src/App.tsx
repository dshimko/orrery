// SPDX-License-Identifier: Apache-2.0
import { useMemo } from 'react';
import { ErrorState } from './components/ErrorState.js';
import { useRoute } from './hooks/useRoute.js';
import { createApi } from './lib/api.js';
import { HomePage } from './pages/HomePage.js';
import { SystemPage } from './pages/SystemPage.js';

/** Routes `/` to the environment list and `/env/:id` to the system view. */
export function App() {
  const api = useMemo(() => createApi(), []);
  const { route, query } = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage api={api} />;
    case 'env':
      return <SystemPage api={api} envId={route.id} query={query} />;
    case 'notFound':
      return <ErrorState title="Page not found" message="There is nothing at this address." />;
  }
}
