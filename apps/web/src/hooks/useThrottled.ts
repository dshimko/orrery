// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { createThrottle, type Throttled } from '../lib/throttle.js';

/** The latest `value`, updated at most once per `intervalMs`. The first value is immediate. */
export function useThrottled<T>(value: T, intervalMs: number): T {
  const [shown, setShown] = useState(value);
  const throttle = useRef<Throttled<T> | null>(null);
  useEffect(() => {
    const instance = createThrottle<T>(setShown, intervalMs);
    throttle.current = instance;
    return () => {
      instance.cancel();
      throttle.current = null;
    };
  }, [intervalMs]);
  useEffect(() => {
    throttle.current?.push(value);
  }, [value]);
  return shown;
}
