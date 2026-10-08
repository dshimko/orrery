// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatementClient, mapError } from '../src/client.js';
import type {
  AllowedQuery,
  QueryOptions,
  SqlError,
  Target,
  TokenProvider,
} from '../src/contracts.js';
import { TOKEN, fakeFetch, jsonResponse, type RecordedCall } from './helpers.js';

const target: Target = { metastore: 'primary', host: 'https://h.example.com', warehouseId: 'wh-1' };
const SQL_TEXT = 'SELECT secret_column FROM hidden_table WHERE x = :p';
const query: AllowedQuery = { name: 'my_query', sql: SQL_TEXT, source: 'test' };
const tokens: TokenProvider = { token: () => Promise.resolve(TOKEN), cacheKey: () => 'sp:primary' };
const options: QueryOptions = { rowLimit: 100, timeoutMs: 60_000 };
const columns = { schema: { columns: [{ name: 'a' }, { name: 'b' }] } };

function succeeded(rows: (string | null)[][], next?: string): unknown {
  return {
    statement_id: 's1',
    status: { state: 'SUCCEEDED' },
    manifest: columns,
    result: { data_array: rows, ...(next ? { next_chunk_internal_link: next } : {}) },
  };
}

async function failure(promise: Promise<unknown>): Promise<SqlError> {
  return (await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  )) as SqlError;
}

function expectClean(error: SqlError): void {
  for (const secret of [TOKEN, SQL_TEXT, 'hidden_table', 'secret-param']) {
    expect(error.message).not.toContain(secret);
  }
  expect(error.message).toContain('my_query');
}

function run(f: { fetch: typeof fetch }, opts = options): Promise<unknown> {
  return createStatementClient(target, tokens, f.fetch).execute(query, [], opts);
}

describe('statement client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('posts the statement with the documented body and maps rows', async () => {
    const f = fakeFetch(() =>
      jsonResponse(
        succeeded([
          ['1', null],
          ['2', 'x'],
        ]),
      ),
    );
    const client = createStatementClient(target, tokens, f.fetch);
    const rows = await client.execute(
      query,
      [{ name: 'p', value: 'secret-param', type: 'STRING' }],
      {
        rowLimit: 10,
        timeoutMs: 30_000,
      },
    );
    expect(rows).toEqual([
      { a: '1', b: null },
      { a: '2', b: 'x' },
    ]);
    const call = f.calls[0] as RecordedCall;
    expect(call.url).toBe('https://h.example.com/api/2.0/sql/statements');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(headers['User-Agent']).toBe('orrery');
    expect(JSON.parse(call.init.body as string)).toEqual({
      warehouse_id: 'wh-1',
      statement: SQL_TEXT,
      parameters: [{ name: 'p', value: 'secret-param', type: 'STRING' }],
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
      row_limit: 10,
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    });
  });

  it.each([
    [1_000, '0s'],
    [5_000, '5s'],
    [120_000, '50s'],
  ])('clamps wait_timeout for %i ms to %s', async (timeoutMs, expected) => {
    const f = fakeFetch(() => jsonResponse(succeeded([])));
    await run(f, { rowLimit: 1, timeoutMs });
    const body = JSON.parse((f.calls[0] as RecordedCall).init.body as string) as {
      wait_timeout: string;
    };
    expect(body.wait_timeout).toBe(expected);
  });

  it('polls pending statements until they succeed', async () => {
    const f = fakeFetch((_call, i) => {
      if (i === 0) return jsonResponse({ statement_id: 's1', status: { state: 'PENDING' } });
      if (i < 3) return jsonResponse({ status: { state: 'RUNNING' } });
      return jsonResponse(succeeded([['1', '2']]));
    });
    const pending = run(f);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual([{ a: '1', b: '2' }]);
    expect(f.calls).toHaveLength(4);
    expect(
      f.calls.slice(1).every((c) => c.url.endsWith('/statements/s1') && c.init.method === 'GET'),
    ).toBe(true);
  });

  it('follows chunks and stops at the row limit', async () => {
    const f = fakeFetch((call) =>
      call.url.endsWith('/chunks/1')
        ? jsonResponse({
            data_array: [
              ['3', 'c'],
              ['4', 'd'],
              ['5', 'e'],
            ],
            next_chunk_internal_link: '/api/2.0/sql/statements/s1/result/chunks/2',
          })
        : jsonResponse(
            succeeded(
              [
                ['1', 'a'],
                ['2', 'b'],
              ],
              '/api/2.0/sql/statements/s1/result/chunks/1',
            ),
          ),
    );
    const rows = (await run(f, { rowLimit: 4, timeoutMs: 60_000 })) as { a: string }[];
    expect(rows.map((r) => r.a)).toEqual(['1', '2', '3', '4']);
    expect(f.calls).toHaveLength(2);
  });

  it('refuses chunk links outside the statements API', async () => {
    const f = fakeFetch(() => jsonResponse(succeeded([['1', 'a']], 'https://evil.example.com/x')));
    const error = await failure(run(f));
    expect(error.code).toBe('failed');
    expect(f.calls).toHaveLength(1);
  });

  it('cancels the statement and throws timeout when the deadline passes', async () => {
    const f = fakeFetch((call) =>
      call.url.endsWith('/cancel')
        ? jsonResponse({})
        : jsonResponse({ statement_id: 's1', status: { state: 'RUNNING' } }),
    );
    const result = failure(run(f, { rowLimit: 1, timeoutMs: 3_000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await result;
    expect(error.code).toBe('timeout');
    expectClean(error);
    const cancel = f.calls.at(-1) as RecordedCall;
    expect(cancel.url).toBe('https://h.example.com/api/2.0/sql/statements/s1/cancel');
    expect(cancel.init.method).toBe('POST');
  });

  it('cancels the statement and throws canceled when aborted', async () => {
    const controller = new AbortController();
    const f = fakeFetch((call) =>
      call.url.endsWith('/cancel')
        ? jsonResponse({})
        : jsonResponse({ statement_id: 's1', status: { state: 'RUNNING' } }),
    );
    const result = failure(run(f, { ...options, signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(150);
    controller.abort();
    const error = await result;
    expect(error.code).toBe('canceled');
    expectClean(error);
    expect((f.calls.at(-1) as RecordedCall).url).toMatch(/s1\/cancel$/);
  });

  it('cancels a statement that is still running when a later poll fails', async () => {
    let polls = 0;
    const f = fakeFetch((call) => {
      if (call.url.endsWith('/cancel')) return jsonResponse({});
      polls += 1;
      return polls === 1
        ? jsonResponse({ statement_id: 's1', status: { state: 'RUNNING' } })
        : jsonResponse({ error_code: 'INTERNAL_ERROR' }, 500);
    });
    const result = failure(run(f));
    await vi.advanceTimersByTimeAsync(500);
    const error = await result;
    expect(error.code).toBe('failed');
    expect((f.calls.at(-1) as RecordedCall).url).toMatch(/s1\/cancel$/);
  });

  it('does not cancel a statement that already reached a terminal state', async () => {
    const f = fakeFetch(() =>
      jsonResponse({ statement_id: 's1', status: { state: 'FAILED', error: { error_code: 'X' } } }),
    );
    const error = await failure(run(f));
    expect(error.code).toBe('failed');
    expect(f.calls.some((call) => call.url.endsWith('/cancel'))).toBe(false);
  });

  it('survives a failing cancel call', async () => {
    const controller = new AbortController();
    const f = fakeFetch((call) => {
      if (call.url.endsWith('/cancel')) throw new Error('network down');
      return jsonResponse({ statement_id: 's1', status: { state: 'RUNNING' } });
    });
    const result = failure(run(f, { ...options, signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(150);
    controller.abort();
    expect((await result).code).toBe('canceled');
  });

  it.each([
    [404, { error_code: 'RESOURCE_DOES_NOT_EXIST' }, 'not_found'],
    [403, { error_code: 'PERMISSION_DENIED' }, 'permission_denied'],
    [500, { error_code: 'INTERNAL_ERROR', message: SQL_TEXT }, 'failed'],
    [400, 'not json', 'failed'],
  ])('maps HTTP %i to %s without leaking details', async (status, body, code) => {
    const f = fakeFetch(() =>
      typeof body === 'string' ? new Response(body, { status }) : jsonResponse(body, status),
    );
    const error = await failure(run(f));
    expect(error.code).toBe(code);
    expect(error.query).toBe('my_query');
    expectClean(error);
  });

  it.each([
    ['TABLE_OR_VIEW_NOT_FOUND', 'not_found'],
    ['INSUFFICIENT_PERMISSIONS', 'permission_denied'],
    ['RESULT_TOO_LARGE', 'too_large'],
    ['SYNTAX_ERROR', 'failed'],
  ])('maps statement error %s to %s', async (errorCode, code) => {
    const f = fakeFetch(() =>
      jsonResponse({
        statement_id: 's1',
        status: { state: 'FAILED', error: { error_code: errorCode, message: SQL_TEXT } },
      }),
    );
    const error = await failure(run(f));
    expect(error.code).toBe(code);
    expect(error.message).toContain(errorCode);
    expectClean(error);
  });

  it('fails canceled statements and sanitises odd error codes', async () => {
    const f = fakeFetch(() => jsonResponse({ statement_id: 's1', status: { state: 'CANCELED' } }));
    expect((await failure(run(f))).code).toBe('failed');
    const g = fakeFetch(() =>
      jsonResponse({ status: { state: 'FAILED', error: { error_code: 'bad code with spaces' } } }),
    );
    expect((await failure(run(g))).message).toContain('UNKNOWN');
  });

  it('fails when a pending response has no statement id', async () => {
    const f = fakeFetch(() => jsonResponse({ status: { state: 'PENDING' } }));
    expect((await failure(run(f))).code).toBe('failed');
  });

  it('maps connection errors to failed without leaking', async () => {
    const f = fakeFetch(() => Promise.reject(new Error(`down ${TOKEN}`)) as never);
    const error = await failure(run(f));
    expect(error.code).toBe('failed');
    expectClean(error);
  });

  it('retries once after Retry-After on 429', async () => {
    const f = fakeFetch((_c, i) =>
      i === 0
        ? jsonResponse({}, 429, { 'retry-after': '2' })
        : jsonResponse(succeeded([['1', 'a']])),
    );
    const pending = run(f);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await pending).toHaveLength(1);
    expect(f.calls).toHaveLength(2);
  });

  it('gives up with rate_limited on a second 429 or a missing Retry-After', async () => {
    const twice = fakeFetch(() => jsonResponse({}, 429, { 'retry-after': '1' }));
    const pending = failure(run(twice));
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await pending).code).toBe('rate_limited');
    expect(twice.calls).toHaveLength(2);
    const none = fakeFetch(() => jsonResponse({}, 429));
    expect((await failure(run(none))).code).toBe('rate_limited');
    expect(none.calls).toHaveLength(1);
  });

  it('propagates token provider failures without calling the API', async () => {
    const broken: TokenProvider = {
      token: () => Promise.reject(Object.assign(new Error('no token'), { code: 'auth' })),
      cacheKey: () => 'x',
    };
    const f = fakeFetch(() => jsonResponse({}));
    await expect(
      createStatementClient(target, broken, f.fetch).execute(query, [], options),
    ).rejects.toThrow('no token');
    expect(f.calls).toHaveLength(0);
  });
});

describe('mapError', () => {
  it('maps statuses and codes', () => {
    expect(mapError(404, undefined)).toBe('not_found');
    expect(mapError(undefined, 'TABLE_OR_VIEW_NOT_FOUND')).toBe('not_found');
    expect(mapError(403, undefined)).toBe('permission_denied');
    expect(mapError(429, undefined)).toBe('rate_limited');
    expect(mapError(500, undefined)).toBe('failed');
  });
});
