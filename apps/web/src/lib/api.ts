// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent, Snapshot, Topology, Visuals } from '@orrery/core';
import type { TierId } from './types.js';

export interface EnvironmentSummary {
  id: string;
  name: string;
  tier: TierId;
}

export interface EnvironmentListing extends EnvironmentSummary {
  health: unknown;
}

export interface PublicConfig {
  product: { title: string; timezone: string };
  visuals: Visuals;
  promotion: unknown;
  /** Absent on older servers; read it with `logoUrlOf`. */
  branding?: { logoUrl?: string | null };
  environments: EnvironmentSummary[];
}

/** The fork's header logo URL, or null when `branding` is missing, malformed, or has no logo. */
export function logoUrlOf(config: Pick<PublicConfig, 'branding'>): string | null {
  const { branding } = config as { branding?: unknown };
  if (typeof branding !== 'object' || branding === null) return null;
  const { logoUrl } = branding as { logoUrl?: unknown };
  return typeof logoUrl === 'string' && logoUrl !== '' ? logoUrl : null;
}

/** A failed API call: server error envelope, transport failure, or malformed body. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface Api {
  config(signal?: AbortSignal): Promise<PublicConfig>;
  environments(signal?: AbortSignal): Promise<EnvironmentListing[]>;
  topology(envId: string, signal?: AbortSignal): Promise<Topology>;
  snapshot(envId: string, at: Date, signal?: AbortSignal): Promise<Snapshot>;
  events(envId: string, since: Date, until: Date, signal?: AbortSignal): Promise<PlatformEvent[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorFrom(status: number, body: unknown): ApiError {
  const detail = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const code = typeof detail?.code === 'string' ? detail.code : 'http_error';
  const message =
    typeof detail?.message === 'string' ? detail.message : `The server answered ${status}.`;
  return new ApiError(message, status, code);
}

async function readData<T>(fetchFn: FetchFn, url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(url, signal ? { signal } : {});
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('Could not reach the server.', 0, 'network_error');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (!response.ok) throw errorFrom(response.status, undefined);
    throw new ApiError('The server sent an unreadable response.', response.status, 'bad_response');
  }
  if (!response.ok) throw errorFrom(response.status, body);
  if (!isRecord(body) || !('data' in body)) {
    throw new ApiError('The server response had no data.', response.status, 'bad_response');
  }
  return body.data as T;
}

/** Live event stream URL (`event: platform` SSE) for an environment, resuming from `since`. */
export function eventStreamUrl(envId: string, since: Date): string {
  return `/api/env/${encodeURIComponent(envId)}/stream?since=${encodeURIComponent(since.toISOString())}`;
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function createApi(fetchFn: FetchFn = (url, init) => fetch(url, init)): Api {
  const env = (id: string): string => `/api/env/${encodeURIComponent(id)}`;
  return {
    config: (signal) => readData(fetchFn, '/api/config', signal),
    environments: (signal) => readData(fetchFn, '/api/environments', signal),
    topology: (id, signal) => readData(fetchFn, `${env(id)}/topology`, signal),
    snapshot: (id, at, signal) =>
      readData(fetchFn, `${env(id)}/snapshot?at=${encodeURIComponent(at.toISOString())}`, signal),
    events: (id, since, until, signal) =>
      readData(
        fetchFn,
        `${env(id)}/events?since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(until.toISOString())}`,
        signal,
      ),
  };
}
