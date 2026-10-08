// SPDX-License-Identifier: Apache-2.0
// On-behalf-of-user support. Behind the Databricks Apps proxy, each request carries the
// viewer's access token in `x-forwarded-access-token`; adapters read it through
// `AdapterContext.userToken()` so Unity Catalog permissions apply per viewer. The header is
// trusted only behind that proxy (DATABRICKS_APP_PORT set) or when an operator opts in.
import { AsyncLocalStorage } from 'node:async_hooks';

export const FORWARDED_TOKEN_HEADER = 'x-forwarded-access-token';
const MAX_TOKEN_LENGTH = 8192;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]+$/;

const store = new AsyncLocalStorage<{ token: string | undefined }>();

export function trustsForwardedToken(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.ORRERY_TRUST_FORWARDED_TOKEN === '1' || Boolean(env.DATABRICKS_APP_PORT);
}

/** A well-formed forwarded token, or undefined (absent, repeated, oversized, or malformed). */
export function readForwardedToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const token = header.trim();
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
    return undefined;
  }
  return token;
}

/** Runs `next` with the request's user token available to `currentUserToken`. */
export function runWithUserToken(token: string | undefined, next: () => void): void {
  store.run({ token }, next);
}

/** The current request's viewer token; undefined outside a request or when not trusted. */
export function currentUserToken(): string | undefined {
  return store.getStore()?.token;
}
