// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal history-API router. Routes: `/` (home), `/env/:id` (system view), and `/compare`.
 * Query parameters are plain strings.
 */

export type Route =
  { name: 'home' } | { name: 'env'; id: string } | { name: 'compare' } | { name: 'notFound' };
export type Query = Readonly<Record<string, string>>;

export const NAVIGATE_EVENT = 'orrery:navigate';
const ENV_PATH = /^\/env\/([^/]+)\/?$/;

export function matchRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname === '/compare' || pathname === '/compare/') return { name: 'compare' };
  const match = ENV_PATH.exec(pathname);
  if (!match?.[1]) return { name: 'notFound' };
  try {
    return { name: 'env', id: decodeURIComponent(match[1]) };
  } catch {
    return { name: 'notFound' };
  }
}

/** Parses `?a=1&b=2` into a record. The first occurrence of a repeated key wins. */
export function parseQuery(search: string): Query {
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (!(key in result)) result[key] = value;
  }
  return result;
}

/** Builds `path?query`, dropping empty values and sorting keys for stable URLs. */
export function buildUrl(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}

export function envPath(id: string): string {
  return `/env/${encodeURIComponent(id)}`;
}

export const COMPARE_PATH = '/compare';

/** Query key that turns wall display mode on (`wall=1`). */
export const WALL_PARAM = 'wall';

export function isWallQuery(query: Query): boolean {
  return query[WALL_PARAM] === '1';
}

/** Adds or removes `wall=1`, leaving other parameters as they are. */
export function withWall(query: Query, wall: boolean): Query {
  const { [WALL_PARAM]: _removed, ...rest } = query;
  return wall ? { ...rest, [WALL_PARAM]: '1' } : rest;
}

/** Pushes (or replaces) a history entry and notifies subscribers. */
export function navigate(url: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
