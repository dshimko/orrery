// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'react';

/** Sets the tab title to `(N) <title>` while `count` is positive; restores it on unmount. */
export function useTabTitle(count: number): void {
  useEffect(() => {
    const base = document.title;
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [count]);
}
