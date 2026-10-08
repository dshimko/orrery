// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest';
import { closeApps, getJson, loadExample, startApp } from './helpers.js';

afterEach(closeApps);

interface Envelope<T> {
  data: T;
}

describe('openlineage environment', () => {
  it('starts from the public sample and serves topology, snapshot, and events', async () => {
    const app = await startApp(loadExample('openlineage.yaml'));
    const list = (await getJson(app, '/api/environments')).body as Envelope<
      { id: string; health: { status: string; message?: string } }[]
    >;
    expect(list.data.map((env) => [env.id, env.health.status])).toEqual([['sample', 'ok']]);
    const topology = await getJson(app, '/api/env/sample/topology');
    expect(topology.status).toBe(200);
    const snapshot = await getJson(app, '/api/env/sample/snapshot?at=2026-03-02T10:07:00Z');
    expect(snapshot.status).toBe(200);
    const events = await getJson(
      app,
      '/api/env/sample/events?since=2026-03-02T10:00:00Z&until=2026-03-02T11:00:00Z',
    );
    expect(events.status).toBe(200);
    expect((events.body as Envelope<unknown[]>).data.length).toBeGreaterThan(20);
  });
});
