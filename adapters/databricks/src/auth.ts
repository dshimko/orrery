// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import type { AdapterContext, ResolvedEnvironment } from '@orrery/core';
import { SqlError, type Target, type TokenProvider } from './contracts.js';
import { resolveRef, type EnvMap } from './env-refs.js';

/** Refresh this long before the token expires. */
const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_EXPIRES_IN_S = 3600;
const TOKEN_PATH = '/oidc/v1/token';

const patWarned = new WeakSet<ResolvedEnvironment>();

interface Credentials {
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function aborted(signal: AbortSignal | undefined): SqlError | undefined {
  return signal?.aborted ? new SqlError('canceled', 'Token request was canceled.') : undefined;
}

function readCredentials(environment: ResolvedEnvironment, env: EnvMap): Credentials {
  const connection = environment.connection;
  const usesEnvDefaults = (connection?.auth ?? 'app-service-principal') === 'app-service-principal';
  const clientId =
    resolveRef(connection?.clientId, env) ??
    (usesEnvDefaults ? resolveRef(env['DATABRICKS_CLIENT_ID'], env) : undefined);
  const clientSecret =
    resolveRef(connection?.clientSecret, env) ??
    (usesEnvDefaults ? resolveRef(env['DATABRICKS_CLIENT_SECRET'], env) : undefined);
  if (clientId === undefined || clientSecret === undefined) {
    throw new SqlError(
      'auth',
      `Environment "${environment.id}": OAuth client id and secret are not configured.`,
    );
  }
  return { clientId, clientSecret };
}

async function requestClientCredentialsToken(
  target: Target,
  credentials: Credentials,
  fetchImpl: typeof fetch,
  now: number,
  signal: AbortSignal | undefined,
): Promise<CachedToken> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
    'base64',
  );
  let response: Response;
  try {
    response = await fetchImpl(`${target.host}${TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'orrery',
      },
      body: 'grant_type=client_credentials&scope=all-apis',
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw (
      aborted(signal) ??
      new SqlError('auth', `Token request to metastore "${target.metastore}" failed to connect.`)
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new SqlError(
      'auth',
      `Token endpoint rejected the client credentials (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new SqlError('auth', `Token endpoint returned HTTP ${response.status}.`);
  }
  const body = (await response.json().catch(() => undefined)) as
    { access_token?: unknown; expires_in?: unknown } | undefined;
  const accessToken = body?.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new SqlError('auth', 'Token endpoint response had no access token.');
  }
  const expiresIn =
    typeof body?.expires_in === 'number' && body.expires_in > 0
      ? body.expires_in
      : DEFAULT_EXPIRES_IN_S;
  return { value: accessToken, expiresAt: now + expiresIn * 1000 };
}

function createClientCredentialsProvider(
  environment: ResolvedEnvironment,
  target: Target,
  ctx: AdapterContext,
  fetchImpl: typeof fetch,
): TokenProvider {
  let cached: CachedToken | undefined;
  let inflight: Promise<CachedToken> | undefined;
  const key = `sp:${target.metastore}`;

  const refresh = (): Promise<CachedToken> => {
    if (inflight) return inflight;
    // Real wall-clock time on purpose: token expiry must not follow the replay clock.
    // The shared request is tied to the adapter signal; callers race it individually.
    const request = requestClientCredentialsToken(
      target,
      readCredentials(environment, ctx.env),
      fetchImpl,
      Date.now(),
      ctx.signal,
    )
      .then((token) => {
        cached = token;
        return token;
      })
      .finally(() => {
        inflight = undefined;
      });
    inflight = request;
    return request;
  };

  return {
    cacheKey: () => key,
    async token(signal?: AbortSignal): Promise<string> {
      const early = aborted(signal);
      if (early) throw early;
      const now = Date.now();
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now) return cached.value;
      const request = refresh();
      if (!signal) return (await request).value;
      return (await raceAbort(request, signal)).value;
    },
  };
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new SqlError('canceled', 'Token request was canceled.'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function createPatProvider(
  environment: ResolvedEnvironment,
  target: Target,
  ctx: AdapterContext,
): TokenProvider {
  const key = `sp:${target.metastore}`;
  return {
    cacheKey: () => key,
    token(): Promise<string> {
      const pat = resolveRef(environment.connection?.token, ctx.env);
      if (pat === undefined) {
        return Promise.reject(
          new SqlError('auth', `Environment "${environment.id}": PAT token is not configured.`),
        );
      }
      if (!patWarned.has(environment)) {
        patWarned.add(environment);
        ctx.logger.warn(
          `Environment "${environment.id}" uses a personal access token. Use it for development only.`,
        );
      }
      return Promise.resolve(pat);
    },
  };
}

function createOboProvider(ctx: AdapterContext): TokenProvider {
  const current = (): string => {
    const token = ctx.userToken?.();
    if (token === undefined || token.length === 0) {
      throw new SqlError('auth', 'No user token: on-behalf-of-user needs a signed-in viewer.');
    }
    return token;
  };
  return {
    cacheKey: () => {
      const token = ctx.userToken?.();
      return `obo:${token ? sha256Hex(token) : 'anonymous'}`;
    },
    token(): Promise<string> {
      try {
        return Promise.resolve(current());
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

/** Builds the token source for one target according to `connection.auth`. */
export function createTokenProvider(
  environment: ResolvedEnvironment,
  target: Target,
  ctx: AdapterContext,
  fetchImpl: typeof fetch = fetch,
): TokenProvider {
  const auth = environment.connection?.auth ?? 'app-service-principal';
  switch (auth) {
    case 'on-behalf-of-user':
      return createOboProvider(ctx);
    case 'pat':
      return createPatProvider(environment, target, ctx);
    case 'app-service-principal':
    case 'oauth-m2m':
      return createClientCredentialsProvider(environment, target, ctx, fetchImpl);
  }
}
