// SPDX-License-Identifier: Apache-2.0
// Pure logic for the Orloj "How to read" guidance: first-visit memory, the `?` key, and the
// legend view-model. All visible text comes from ORLOJ_STRINGS, never from this file.
import type { LegendEntry } from '@orrery/orloj';
import type { Query } from './router.js';

export const HOWTO_STORAGE_KEY = 'orrery.orloj.howToRead.dismissed';
export const HOWTO_PARAM = 'howto';
/** The legend follows data updates at most this often (4 per second). */
export const LEGEND_THROTTLE_MS = 250;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or null when even touching it throws (blocked storage). */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when the viewer has dismissed the guidance before. Unreadable storage counts as not. */
export function isDismissed(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(HOWTO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remembers the dismissal. Returns false when storage refused, so the caller may ignore it. */
export function rememberDismissed(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(HOWTO_STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether annotation starts on. Wall mode never shows it; `howto=1` / `howto=0` force it;
 * otherwise it shows until the viewer has dismissed it once.
 */
export function initialAnnotation(
  query: Query,
  isWall: boolean,
  storage: StorageLike | null,
): boolean {
  if (isWall) return false;
  const forced = query[HOWTO_PARAM];
  if (forced === '1') return true;
  if (forced === '0') return false;
  return !isDismissed(storage);
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** The event target's tag name and editability, when it is an element. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

const TEXT_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

/** True while typing or choosing in a form control, where shortcuts must stay out of the way. */
export function isEditableTarget(target: KeyLike['target']): boolean {
  if (!target) return false;
  return target.isContentEditable === true || TEXT_TAGS.has((target.tagName ?? '').toUpperCase());
}

/** `?` toggles the guidance, except in form controls or with Ctrl, Meta, or Alt held. */
export function isHowToKey(event: KeyLike): boolean {
  if (event.key !== '?') return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return !isEditableTarget(event.target);
}

/** Escape closes the guidance only when it is on, and never in a form control. */
export function isCloseKey(event: KeyLike, isOn: boolean): boolean {
  return isOn && event.key === 'Escape' && !isEditableTarget(event.target);
}

export interface LegendRow {
  part: string;
  number: number;
  name: string;
  /** The definition, or null when the part is unavailable. */
  definition: string | null;
  /** Why the part is unavailable here, or null when it is available. */
  reason: string | null;
}

/** One row per legend entry; an entry with an unavailable reason shows it, muted, in the list. */
export function legendRows(entries: readonly LegendEntry[]): LegendRow[] {
  return entries.map((entry) => {
    const reason = entry.unavailableReason ?? null;
    return {
      part: entry.part,
      number: entry.number,
      name: entry.name,
      definition: reason === null ? entry.definition : null,
      reason,
    };
  });
}
