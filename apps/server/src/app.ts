// SPDX-License-Identifier: Apache-2.0
import type { Clock, Logger, OrreryConfig } from '@orrery/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { systemClock } from './clock.js';
import { ApiError, errorBody } from './errors.js';
import { createJsonLogger, errorMessage } from './logger.js';
import { DEFAULT_RATE_LIMIT, TokenBucket, type RateLimitOptions } from './rate-limit.js';
import { startEnvironments, withTimeout, DISPOSE_TIMEOUT_MS } from './registry.js';
import type { RouteContext } from './routes/context.js';
import { registerEnvRoutes } from './routes/env.js';
import { registerMetaRoutes } from './routes/meta.js';
import { DEFAULT_WEB_DIR, resolveStatic } from './static.js';

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'";

export interface BuildServerOptions {
  config: OrreryConfig;
  env?: Record<string, string | undefined>;
  clock?: Clock;
  webDir?: string;
  logger?: Logger;
  rateLimit?: RateLimitOptions;
  /** Per-adapter init timeout; defaults to 10 s. */
  initTimeoutMs?: number;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function isApiPath(url: string): boolean {
  const pathname = url.split('?')[0] ?? '';
  return pathname === '/api' || pathname.startsWith('/api/');
}

function installErrorHandling(app: FastifyInstance, logger: Logger, webDir: string): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send(errorBody('bad_request', 'The request is not valid.'));
    }
    logger.error('request failed', { error: errorMessage(error) });
    return reply.code(500).send(errorBody('internal_error', 'Something went wrong.'));
  });

  app.setNotFoundHandler(async (request, reply) => {
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (!isRead || isApiPath(request.url)) {
      return reply.code(404).send(errorBody('not_found', 'Not found.'));
    }
    const file = await resolveStatic(webDir, request.url);
    if (!file) return reply.code(404).send(errorBody('not_found', 'Not found.'));
    return reply
      .header('Content-Type', file.contentType)
      .header('Cache-Control', file.cacheControl)
      .send(file.body);
  });
}

/** Builds the API and static server. Adapters start before it returns; none can block it. */
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const { config } = options;
  const logger = options.logger ?? createJsonLogger();
  const clock = options.clock ?? systemClock;
  const shutdown = new AbortController();
  const runtimes = await startEnvironments(config, {
    clock,
    logger,
    env: options.env ?? process.env,
    signal: shutdown.signal,
    ...(options.initTimeoutMs === undefined ? {} : { initTimeoutMs: options.initTimeoutMs }),
  });
  const limit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  const buckets = new Map(runtimes.map(({ env }) => [env.id, new TokenBucket(limit)]));
  const context: RouteContext = {
    config,
    runtimes,
    clock,
    logger,
    signal: shutdown.signal,
    buckets,
  };

  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (_request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });
  // Ends live streams first, so closing the server is not held open by them.
  app.addHook('preClose', async () => {
    shutdown.abort();
  });
  app.addHook('onClose', async () => {
    shutdown.abort();
    await Promise.all(
      runtimes.map(({ env, adapter }) =>
        (adapter ? withTimeout(adapter.dispose(), DISPOSE_TIMEOUT_MS) : Promise.resolve()).catch(
          (error: unknown) => {
            logger.error('adapter dispose failed', { envId: env.id, error: errorMessage(error) });
          },
        ),
      ),
    );
  });
  installErrorHandling(app, logger, options.webDir ?? DEFAULT_WEB_DIR);
  registerMetaRoutes(app, context);
  registerEnvRoutes(app, context);
  return app;
}
