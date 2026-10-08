// SPDX-License-Identifier: Apache-2.0
import type { Clock } from '@orrery/core';

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/** Wall-clock time with an abortable `sleep`. */
export const systemClock: Clock = {
  now: () => new Date(),
  sleep(ms, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
};
