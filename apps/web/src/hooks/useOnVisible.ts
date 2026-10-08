// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from 'react';

/** Calls `callback` whenever the tab returns from hidden to visible. */
export function useOnVisible(callback: () => void): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const onChange = (): void => {
      if (document.visibilityState === 'visible') latest.current();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
    };
  }, []);
}
