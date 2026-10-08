// SPDX-License-Identifier: Apache-2.0
import { useMemo, useSyncExternalStore } from 'react';
import { matchRoute, NAVIGATE_EVENT, parseQuery, type Query, type Route } from '../lib/router.js';

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

const getPathname = (): string => window.location.pathname;
const getSearch = (): string => window.location.search;

/** The current route and query. Re-renders on back/forward and in-app navigation. */
export function useRoute(): { route: Route; query: Query } {
  const pathname = useSyncExternalStore(subscribe, getPathname);
  const search = useSyncExternalStore(subscribe, getSearch);
  const route = useMemo(() => matchRoute(pathname), [pathname]);
  const query = useMemo(() => parseQuery(search), [search]);
  return { route, query };
}
