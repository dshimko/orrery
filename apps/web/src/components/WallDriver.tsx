// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo } from 'react';
import { useBootstrap } from '../hooks/useBootstrap.js';
import { useRoute } from '../hooks/useRoute.js';
import { useWallAttention, useWallCycle } from '../hooks/useWall.js';
import type { Api } from '../lib/api.js';
import {
  buildUrl,
  isWallQuery,
  navigate,
  parseQuery,
  type Route,
  withWall,
} from '../lib/router.js';
import { type WallStop, wallStops, wallUrl } from '../lib/wall.js';

function shownStop(route: Route): WallStop | null {
  if (route.name === 'home') return { kind: 'home' };
  if (route.name === 'env') return { kind: 'env', id: route.id };
  return null;
}

function exitWall(): void {
  const query = parseQuery(window.location.search);
  navigate(buildUrl(window.location.pathname, withWall(query, false)), { replace: true });
}

function WallCycle({ api, envIds, route }: { api: Api; envIds: readonly string[]; route: Route }) {
  const stops = useMemo(() => wallStops(envIds), [envIds]);
  const hasAttention = useWallAttention(api, envIds);
  useWallCycle({
    stops,
    shown: shownStop(route),
    hasAttention,
    onGo: (stop) => {
      navigate(wallUrl(stop), { replace: true });
    },
    onExit: exitWall,
  });
  return null;
}

/**
 * Wall display mode (`wall=1`): cycles home and each environment's system view, holding on
 * environments with an open warning or incident. Renders nothing; it only drives navigation.
 */
export function WallDriver({ api }: { api: Api }) {
  const { route, query } = useRoute();
  const isActive = isWallQuery(query) && (route.name === 'home' || route.name === 'env');
  return isActive ? <WallDriverActive api={api} route={route} /> : null;
}

/** Escape leaves wall mode at once, even before the environment list has loaded. */
function useEscapeExitsWall(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') exitWall();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function WallDriverActive({ api, route }: { api: Api; route: Route }) {
  useEscapeExitsWall();
  const boot = useBootstrap(api);
  const envIds = useMemo(
    () => (boot.status === 'ready' ? boot.data.environments.map((env) => env.id) : []),
    [boot],
  );
  if (boot.status !== 'ready') return null;
  return <WallCycle api={api} envIds={envIds} route={route} />;
}
