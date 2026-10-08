// SPDX-License-Identifier: Apache-2.0
import type { AdapterContext, ResolvedEnvironment } from '@orrery/core';

export const SECRET = 'fake-secret-value-123';
export const CLIENT_ID = 'fake-client-id-456';
export const TOKEN = 'fake-access-token-789';

export function makeEnvironment(partial: Record<string, unknown> = {}): ResolvedEnvironment {
  return {
    id: 'prod',
    name: 'Prod',
    tier: 'prod',
    topology: 't',
    adapter: 'databricks',
    ...partial,
  } as unknown as ResolvedEnvironment;
}

export interface TestContext extends AdapterContext {
  warnings: string[];
}

export function makeContext(
  env: Record<string, string | undefined> = {},
  userToken?: () => string | undefined,
): TestContext {
  const warnings: string[] = [];
  const noop = (): void => undefined;
  return {
    warnings,
    env,
    clock: { now: () => new Date(), sleep: () => Promise.resolve() },
    logger: { debug: noop, info: noop, warn: (m: string) => void warnings.push(m), error: noop },
    ...(userToken ? { userToken } : {}),
  };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** A fake fetch that serves queued handlers in order and records calls. */
export function fakeFetch(
  handler: (call: RecordedCall, index: number) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return Promise.resolve(handler(call, calls.length - 1));
  };
  return { fetch: impl as typeof fetch, calls };
}
