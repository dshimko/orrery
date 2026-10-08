// SPDX-License-Identifier: Apache-2.0
export interface Throttled<T> {
  push(value: T): void;
  cancel(): void;
}

/** Delivers the latest pushed value at most once per `intervalMs` (leading and trailing). */
export function createThrottle<T>(deliver: (value: T) => void, intervalMs: number): Throttled<T> {
  let lastAt = Number.NEGATIVE_INFINITY;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    timer = undefined;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    lastAt = Date.now();
    deliver(value);
  };

  return {
    push(value) {
      pending = { value };
      if (timer !== undefined) return;
      const wait = Math.max(0, lastAt + intervalMs - Date.now());
      timer = setTimeout(flush, wait);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}
