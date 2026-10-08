// SPDX-License-Identifier: Apache-2.0
import type { Clock, Logger, OrreryConfig } from '@orrery/core';
import {
  FORWARDED_TOKEN_HEADER,
  currentUserToken,
  readForwardedToken,
  runWithUserToken,
  trustsForwardedToken,
} from './user-token.js';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from 'fastify';
import { systemClock } from './clock.js';
import { ApiError, errorBody } from './errors.js';
import { createJsonLogger, errorMessage } from './logger.js';
import { loadLogo } from './branding.js';
import { RateLimiter, type RateLimiterOptions } from './rate-limit.js';
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
  /** Per-client and global limits for each environment; see `RateLimiter`. */
  rateLimit?: Omit<RateLimiterOptions, 'nowMs'>;
  /** Working directory for fork assets (`public/private/`); defaults to `process.cwd()`. */
  cwd?: string;
  /** Per-adapter init timeout; defaults to 10 s. */
  initTimeoutMs?: number;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** Whether X-Forwarded-For can be believed for `request.ip`: behind a trusted proxy only. */
function trustsProxy(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.ORRERY_TRUST_PROXY === '1' || Boolean(env.DATABRICKS_APP_PORT);
}

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
  const env = options.env ?? process.env;
  const trustsToken = trustsForwardedToken(env);
  const runtimes = await startEnvironments(config, {
    clock,
    logger,
    env,
    signal: shutdown.signal,
    peers: config.environments,
    userToken: currentUserToken,
    ...(options.initTimeoutMs === undefined ? {} : { initTimeoutMs: options.initTimeoutMs }),
  });
  const limiter = new RateLimiter(
    runtimes.map(({ env }) => env.id),
    options.rateLimit,
  );
  const logo = await loadLogo(env, options.cwd ?? process.cwd());
  const context: RouteContext = {
    config,
    runtimes,
    clock,
    logger,
    signal: shutdown.signal,
    limiter,
    ...(logo ? { logo } : {}),
  };

  const serverOptions: FastifyServerOptions = {
    logger: false,
    // Trust exactly one proxy hop: the client address is the entry that proxy appended
    // (rightmost), never a value the client wrote into X-Forwarded-For itself.
    trustProxy: trustsProxy(env) ? (_address: string, hop: number) => hop === 0 : false,
    frameworkErrors: (error, _request, frameworkReply) => {
      // The callback's reply is typed with the route generics; this handler needs none.
      const reply = frameworkReply as unknown as FastifyReply;
      const status = (error as { statusCode?: number }).statusCode;
      const isClientError = typeof status === 'number' && status >= 400 && status < 500;
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
      return reply
        .code(isClientError ? status : 500)
        .send(
          isClientError
            ? errorBody('bad_request', 'The request is not valid.')
            : errorBody('internal_error', 'Something went wrong.'),
        );
    },
  };
  const app = Fastify(serverOptions);
  app.addHook('onRequest', async (_request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });
  // Callback style so the rest of the request runs inside the token's async context.
  app.addHook('onRequest', (request, _reply, done) => {
    const token = trustsToken
      ? readForwardedToken(request.headers[FORWARDED_TOKEN_HEADER])
      : undefined;
    runWithUserToken(token, done);
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
