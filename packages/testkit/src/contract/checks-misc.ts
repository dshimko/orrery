// SPDX-License-Identifier: Apache-2.0
import { isDeepStrictEqual } from 'node:util';
import type { AdapterHealth } from '@orrery/core';
import { ensure } from './assert.js';

const HEALTH_STATUSES: readonly string[] = ['ok', 'degraded', 'error'];

export function checkHealth(health: AdapterHealth): void {
  ensure(HEALTH_STATUSES.includes(health.status), `health.status "${health.status}" is invalid`);
  const checkedAt = new Date(health.checkedAt);
  ensure(
    !Number.isNaN(checkedAt.getTime()) && checkedAt.toISOString() === health.checkedAt,
    `health.checkedAt "${health.checkedAt}" must be an ISO timestamp`,
  );
}

export function checkDeepEqual(actual: unknown, expected: unknown, what: string): void {
  ensure(isDeepStrictEqual(actual, expected), `${what} differ`);
}

/** Values travel to the browser as JSON, so they must survive a round trip unchanged. */
export function checkJsonRoundTrip(value: unknown, what: string): void {
  const roundTripped: unknown = JSON.parse(JSON.stringify(value));
  ensure(isDeepStrictEqual(roundTripped, value), `${what} changes after a JSON round trip`);
}
