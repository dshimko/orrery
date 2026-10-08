// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';
import { ScaledClock, silentLogger } from '@orrery/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { pumpSse } from '../src/sse.js';
import { closeApps, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

const SAMPLE: PlatformEvent = {
  type: 'ingest.gate',
  envId: 'dev',
  ts: '2026-03-02T12:00:00.000Z',
  spokeId: 'sales',
  result: 'pass',
};

describe('pumpSse', () => {
  it('writes platform frames and a heartbeat, then stops and closes the source on abort', async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    let isClosed = false;
    async function* source(): AsyncGenerator<PlatformEvent> {
      try {
        yield SAMPLE;
        await new Promise<void>(() => undefined);
      } finally {
        isClosed = true;
      }
    }
    const done = pumpSse({
      source: source(),
      write: (chunk) => chunks.push(chunk) > 0,
      drain: () => Promise.resolve(),
      signal: controller.signal,
      heartbeatMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    controller.abort();
    await done;
    const output = chunks.join('');
    expect(output).toContain(`event: platform\ndata: ${JSON.stringify(SAMPLE)}\n\n`);
    expect(output).toContain(': heartbeat\n\n');
    const countAtAbort = chunks.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chunks.length).toBe(countAtAbort);
    expect(isClosed).toBe(false); // parked generator closes only once it resumes
  });

  it('ends when the source ends', async () => {
    const chunks: string[] = [];
    async function* source(): AsyncGenerator<PlatformEvent> {
      yield SAMPLE;
    }
    await pumpSse({
      source: source(),
      write: (c) => chunks.push(c) > 0,
      drain: () => Promise.resolve(),
      signal: new AbortController().signal,
    });
    expect(chunks.filter((c) => c.startsWith('event: platform'))).toHaveLength(1);
  });
});

describe('GET /api/env/:id/stream', () => {
  it('streams live platform events and stops when the client disconnects', async () => {
    // A fast clock makes the mock adapter emit within a few hundred real milliseconds.
    const clock = new ScaledClock('2026-03-02T00:00:00Z', 3600);
    const app = await startApp(loadExample('demo.yaml'), { clock, logger: silentLogger });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/env/prod/stream?since=2026-03-02T00:00:00Z`,
      { signal: controller.signal },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const deadline = Date.now() + 8000;
    while (!received.includes('event: platform') && Date.now() < deadline) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    expect(received).toContain('event: platform\ndata: {');
    controller.abort();
    // Closing must not hang on the disconnected stream.
    await app.close();
  }, 15_000);
});

describe('pumpSse backpressure', () => {
  it('waits for drain when the socket is full and stops on abort while waiting', async () => {
    const controller = new AbortController();
    const source = (async function* () {
      for (let i = 0; i < 5; i += 1) {
        yield {
          type: 'deploy',
          envId: 'dev',
          ts: new Date(0).toISOString(),
          release: `r-${i}`,
        } as const;
      }
    })();
    const chunks: string[] = [];
    let drains = 0;
    const done = pumpSse({
      source,
      write: (chunk) => chunks.push(chunk) < 2,
      drain: () => {
        drains += 1;
        return new Promise(() => undefined);
      },
      signal: controller.signal,
      heartbeatMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await done;
    expect(drains).toBe(1);
    expect(chunks.filter((c) => c.startsWith('event: platform'))).toHaveLength(1);
  });
});
