// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserStorage,
  initialAnnotation,
  isCloseKey,
  isHowToKey,
  rememberDismissed,
} from '../lib/guidance.js';
import type { Query } from '../lib/router.js';

export interface HowToRead {
  isOn: boolean;
  toggle: () => void;
}

/**
 * The Orloj "How to read" annotation state. Starts on until dismissed once (remembered in
 * localStorage), is forced by `howto=1|0`, and never shows in wall mode. `?` toggles it and
 * Escape closes it. The URL flag is read once, so later URL rewrites do not flip it.
 */
export function useHowToRead(query: Query, isWall: boolean): HowToRead {
  const [isOn, setIsOn] = useState(() => initialAnnotation(query, isWall, browserStorage()));
  const isOnRef = useRef(isOn);
  isOnRef.current = isOn;

  const set = useCallback((next: boolean) => {
    setIsOn(next);
    if (!next) rememberDismissed(browserStorage());
  }, []);
  const toggle = useCallback(() => {
    set(!isOnRef.current);
  }, [set]);

  useEffect(() => {
    if (isWall) {
      setIsOn(false);
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      const key = {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: event.target instanceof HTMLElement ? event.target : null,
      };
      if (isHowToKey(key)) {
        toggle();
      } else if (!event.defaultPrevented && isCloseKey(key, isOnRef.current)) {
        set(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isWall, set, toggle]);

  return { isOn: isOn && !isWall, toggle };
}
