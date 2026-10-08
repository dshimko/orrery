// SPDX-License-Identifier: Apache-2.0
import type { MouseEvent, ReactNode } from 'react';
import { navigate } from '../lib/router.js';

export interface LinkProps {
  to: string;
  className?: string;
  children: ReactNode;
}

/** An anchor that navigates in-app with the history API; modified clicks fall through. */
export function Link({ to, className, children }: LinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    const isModified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button !== 0 || isModified) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
