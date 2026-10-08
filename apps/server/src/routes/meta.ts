// SPDX-License-Identifier: Apache-2.0
import type { FastifyInstance } from 'fastify';
import { LOGO_URL, SVG_CONTENT_SECURITY_POLICY } from '../branding.js';
import { errorBody } from '../errors.js';
import { cachedHealthOf } from '../registry.js';
import type { RouteContext } from './context.js';

/** Health, public config, and the environment list. Nothing here exposes connection settings. */
export function registerMetaRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/health', async () => ({ data: { status: 'ok' } }));

  app.get('/api/config', async () => {
    const { config } = context;
    return {
      data: {
        product: config.product,
        visuals: config.visuals,
        promotion: config.promotion ?? null,
        branding: { logoUrl: context.logo ? LOGO_URL : null },
        environments: context.runtimes.map(({ env }) => ({
          id: env.id,
          name: env.name,
          tier: env.tier,
        })),
      },
    };
  });

  app.get(LOGO_URL, async (_request, reply) => {
    const { logo } = context;
    if (!logo) return reply.code(404).send(errorBody('not_found', 'Not found.'));
    reply
      .header('Content-Type', logo.contentType)
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff');
    if (logo.isSvg) reply.header('Content-Security-Policy', SVG_CONTENT_SECURITY_POLICY);
    return reply.send(logo.body);
  });

  app.get('/api/environments', async () => {
    const data = await Promise.all(
      context.runtimes.map(async (runtime) => ({
        id: runtime.env.id,
        name: runtime.env.name,
        tier: runtime.env.tier,
        health: await cachedHealthOf(runtime, context.clock, context.logger),
      })),
    );
    return { data };
  });
}
