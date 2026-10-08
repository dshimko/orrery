// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal history-API router. Routes: `/` (home) and `/env/:id` (system view).
 * Query parameters are plain strings; navigation, compare, and wall mode come later.
 */

export type Route = { name: 'home' } | { name: 'env'; id: string } | { name: 'notFound' };
export type Query = Readonly<Record<string, string>>;

export const NAVIGATE_EVENT = 'orrery:navigate';
const ENV_PATH = /^\/env\/([^/]+)\/?$/;

export function matchRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
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

/** Pushes (or replaces) a history entry and notifies subscribers. */
export function navigate(url: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
