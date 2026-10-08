// SPDX-License-Identifier: Apache-2.0
import type { Clock, Logger, OrreryAdapter, OrreryConfig } from '@orrery/core';
import { z } from 'zod';
import { ApiError, parseInput } from '../errors.js';
import { errorMessage } from '../logger.js';
import type { TokenBucket } from '../rate-limit.js';
import type { EnvRuntime } from '../registry.js';

export interface RouteContext {
  config: OrreryConfig;
  /** In API order: promotion order, then config order. */
  runtimes: readonly EnvRuntime[];
  clock: Clock;
  logger: Logger;
  /** Aborts on server shutdown. */
  signal: AbortSignal;
  buckets: ReadonlyMap<string, TokenBucket>;
}

const MAX_ID_LENGTH = 64;
const EnvParams = z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) });

/** An ISO 8601 timestamp such as 2026-01-01T00:00:00Z, converted to a Date. */
export const IsoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** Finds the environment, takes `cost` rate-limit tokens, and returns its live adapter. */
export function requireAdapter(
  context: RouteContext,
  params: unknown,
  cost = 1,
): { adapter: OrreryAdapter; envId: string } {
  const { id } = parseInput(EnvParams, params, 'params');
  const runtime = context.runtimes.find((candidate) => candidate.env.id === id);
  if (!runtime) throw new ApiError(404, 'not_found', `Unknown environment "${id}".`);
  if (!context.buckets.get(id)?.tryTake(cost)) {
    throw new ApiError(429, 'rate_limited', 'Too many requests for this environment.');
  }
  if (!runtime.adapter) {
    throw new ApiError(
      503,
      'adapter_unavailable',
      runtime.unavailableMessage ?? 'The environment is unavailable.',
    );
  }
  return { adapter: runtime.adapter, envId: id };
}

/** Runs an adapter read, hiding adapter internals from the client. */
export async function readFromAdapter<T>(
  context: RouteContext,
  envId: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    context.logger.error('adapter read failed', { envId, error: errorMessage(error) });
    throw new ApiError(502, 'adapter_error', 'The adapter failed to read data.');
  }
}
