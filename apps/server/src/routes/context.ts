// SPDX-License-Identifier: Apache-2.0
import type { Clock, Logger, OrreryAdapter, OrreryConfig } from '@orrery/core';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError, parseInput } from '../errors.js';
import { errorMessage } from '../logger.js';
import type { Logo } from '../branding.js';
import type { RateLimiter } from '../rate-limit.js';
import type { EnvRuntime } from '../registry.js';
import { currentUserToken } from '../user-token.js';

export interface RouteContext {
  config: OrreryConfig;
  /** In API order: promotion order, then config order. */
  runtimes: readonly EnvRuntime[];
  clock: Clock;
  logger: Logger;
  /** Aborts on server shutdown. */
  signal: AbortSignal;
  limiter: RateLimiter;
  /** The fork logo, when one is configured. */
  logo?: Logo;
}

const MAX_ID_LENGTH = 64;
const EnvParams = z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) });

/** An ISO 8601 timestamp such as 2026-01-01T00:00:00Z, converted to a Date. */
export const IsoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/**
 * Who a request counts as for rate limiting: the forwarded viewer token (hashed) when the server
 * trusts it, else the request IP (`request.ip` honors X-Forwarded-For only when trustProxy is on).
 */
export function clientKeyOf(request: FastifyRequest): string {
  const token = currentUserToken();
  return token ? `user:${createHash('sha256').update(token).digest('hex')}` : `ip:${request.ip}`;
}

/** Finds the environment, takes `cost` rate-limit tokens, and returns its live adapter. */
export function requireAdapter(
  context: RouteContext,
  request: FastifyRequest,
  cost = 1,
): { adapter: OrreryAdapter; envId: string } {
  const { id } = parseInput(EnvParams, request.params, 'params');
  const runtime = context.runtimes.find((candidate) => candidate.env.id === id);
  if (!runtime) throw new ApiError(404, 'not_found', `Unknown environment "${id}".`);
  if (!context.limiter.tryTake(id, clientKeyOf(request), cost)) {
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
