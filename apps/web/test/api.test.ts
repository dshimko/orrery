// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test, vi } from 'vitest';
import { ApiError, createApi, type FetchFn } from '../src/lib/api.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('api client', () => {
  test('unwraps data and encodes the query', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(json({ data: [1] }));
    const api = createApi(fetchFn);
    const events = await api.events(
      'a b',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-01T00:15:00Z'),
    );
    expect(events).toEqual([1]);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      '/api/env/a%20b/events?since=2026-01-01T00%3A00%3A00.000Z&until=2026-01-01T00%3A15%3A00.000Z',
    );
  });

  test('turns an error envelope into an ApiError', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(json({ error: { code: 'adapter_unavailable', message: 'Down.' } }, 503));
    const failure = await createApi(fetchFn)
      .topology('prod')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 503, code: 'adapter_unavailable', message: 'Down.' });
  });

  test('wraps transport failures and unreadable bodies', async () => {
    const down = vi.fn<FetchFn>().mockRejectedValue(new TypeError('failed'));
    await expect(createApi(down).config()).rejects.toMatchObject({ code: 'network_error' });
    const garbage = vi.fn<FetchFn>().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(createApi(garbage).config()).rejects.toMatchObject({ code: 'bad_response' });
    const noData = vi.fn<FetchFn>().mockResolvedValue(json({ nope: 1 }));
    await expect(createApi(noData).config()).rejects.toMatchObject({ code: 'bad_response' });
  });

  test('rethrows aborts untouched', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException('aborted', 'AbortError');
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(aborted);
    await expect(createApi(fetchFn).config(controller.signal)).rejects.toBe(aborted);
  });
});
