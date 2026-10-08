// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, parseInput } from '../errors.js';
import { errorMessage } from '../logger.js';
import { pumpSse } from '../sse.js';
import { IsoDate, readFromAdapter, requireAdapter, type RouteContext } from './context.js';

export const MAX_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Requests that would return more events than this fail with 400 instead of truncating. */
export const MAX_EVENTS = 50_000;

/** Live streams may start at most this far in the past, so replay work stays small. */
export const MAX_STREAM_LOOKBACK_MS = 15 * 60 * 1000;
/** Concurrent live streams per environment. */
export const MAX_STREAMS_PER_ENV = 32;
const MS_PER_HOUR = 60 * 60 * 1000;
const COLLECT_YIELD_EVERY = 2000;

/** Rate-limit cost of an events request: one token plus one per hour of window. */
export function eventsCost(since: Date, until: Date): number {
  return 1 + Math.ceil((until.getTime() - since.getTime()) / MS_PER_HOUR);
}

const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const SnapshotQuery = z.object({ at: IsoDate.optional() });
const EventsQuery = z.object({ since: IsoDate, until: IsoDate });
const StreamQuery = z.object({ since: IsoDate.optional() });

async function collectBounded(source: AsyncIterable<PlatformEvent>): Promise<PlatformEvent[]> {
  const events: PlatformEvent[] = [];
  for await (const event of source) {
    if (events.length % COLLECT_YIELD_EVERY === COLLECT_YIELD_EVERY - 1) await nextTick();
    if (events.length >= MAX_EVENTS) {
      throw new ApiError(
        400,
        'too_many_events',
        `The window has more than ${MAX_EVENTS} events. Request a shorter window.`,
      );
    }
    events.push(event);
  }
  return events;
}

function checkWindow(since: Date, until: Date): void {
  if (since.getTime() >= until.getTime()) {
    throw new ApiError(400, 'bad_request', 'since must be earlier than until.');
  }
  if (until.getTime() - since.getTime() > MAX_EVENT_WINDOW_MS) {
    throw new ApiError(
      400,
      'window_too_large',
      'The window between since and until is over 24 hours.',
    );
  }
}

/** Per-environment data routes. All are GET and read-only. */
export function registerEnvRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/env/:id/topology', async (request) => {
    const { adapter, envId } = requireAdapter(context, request);
    return { data: await readFromAdapter(context, envId, () => adapter.topology()) };
  });

  app.get('/api/env/:id/snapshot', async (request) => {
    const { adapter, envId } = requireAdapter(context, request);
    const query = parseInput(SnapshotQuery, request.query, 'query');
    const at = query.at ?? context.clock.now();
    return { data: await readFromAdapter(context, envId, () => adapter.snapshot(at)) };
  });

  app.get('/api/env/:id/events', async (request) => {
    const { since, until } = parseInput(EventsQuery, request.query, 'query');
    checkWindow(since, until);
    const { adapter, envId } = requireAdapter(context, request, eventsCost(since, until));
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    request.raw.once('close', abort);
    try {
      const events = await readFromAdapter(context, envId, () =>
        collectBounded(adapter.events(since, until, controller.signal)),
      );
      return { data: events };
    } finally {
      request.raw.removeListener('close', abort);
    }
  });

  const openStreams = new Map<string, number>();

  app.get('/api/env/:id/stream', { exposeHeadRoute: false }, async (request, reply) => {
    const query = parseInput(StreamQuery, request.query, 'query');
    const now = context.clock.now();
    const since = query.since ?? now;
    if (now.getTime() - since.getTime() > MAX_STREAM_LOOKBACK_MS) {
      throw new ApiError(
        400,
        'since_too_old',
        'A live stream can start at most 15 minutes ago. Use /events for older data.',
      );
    }
    const { adapter, envId } = requireAdapter(context, request);
    const open = openStreams.get(envId) ?? 0;
    if (open >= MAX_STREAMS_PER_ENV) {
      throw new ApiError(503, 'too_many_streams', 'Too many live streams for this environment.');
    }
    openStreams.set(envId, open + 1);
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    request.raw.once('close', abort);
    context.signal.addEventListener('abort', abort, { once: true });
    reply.hijack();
    const { raw } = reply;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(reply.getHeaders() as Record<string, string>),
    });
    try {
      await pumpSse({
        source: adapter.events(since, undefined, controller.signal),
        write: (chunk) => raw.write(chunk),
        drain: () => new Promise((resolve) => raw.once('drain', () => resolve())),
        signal: controller.signal,
      });
    } catch (error) {
      context.logger.error('event stream failed', {
        envId,
        error: errorMessage(error),
      });
    } finally {
      openStreams.set(envId, (openStreams.get(envId) ?? 1) - 1);
      controller.abort();
      context.signal.removeEventListener('abort', abort);
      request.raw.removeListener('close', abort);
      raw.end();
    }
  });
}
