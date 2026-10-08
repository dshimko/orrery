// SPDX-License-Identifier: Apache-2.0
import type { Clock } from '@orrery/core';

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function toDate(at: Date | string): Date {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(at)}`);
  return date;
}

/** A clock that only moves when told to. `sleep` advances it without real waiting. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(at: Date | string) {
    this.current = toDate(at);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date | string): void {
    this.current = toDate(at);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    this.advance(ms);
    return new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        if (signal?.aborted) reject(abortError());
        else resolve();
      });
    });
  }
}

/** A clock that runs `speed` times faster than real time, starting at `start`. */
export class ScaledClock implements Clock {
  private readonly startMs: number;
  private readonly realStart: number;

  constructor(
    start: Date | string,
    private readonly speed: number,
    private readonly realNow: () => number = Date.now,
  ) {
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new RangeError(`Clock speed must be a positive number, got ${String(speed)}`);
    }
    this.startMs = toDate(start).getTime();
    this.realStart = realNow();
  }

  now(): Date {
    return new Date(this.startMs + (this.realNow() - this.realStart) * this.speed);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms / this.speed);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
