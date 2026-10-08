// SPDX-License-Identifier: Apache-2.0
// Time-ordered queue of platform events waiting for simulated time to reach them.
import type { PlatformEvent } from '@orrery/core';

/** Simulated minutes of forward jump after which queued events are stale. */
export const JUMP_MINUTES = 10;
const MS_PER_MINUTE = 60_000;
/** Bound on waiting events: the furthest-future ones are dropped beyond it. */
export const MAX_QUEUED = 5000;

export interface QueuedEvent {
  event: PlatformEvent;
  atMs: number;
  /** Disambiguates same-timestamp events of one type so each gets its own randomness. */
  index: number;
}

/** True when time moved backward, or forward by more than JUMP_MINUTES (a scrub or resume). */
export function isTimeJump(previousMs: number, nextMs: number): boolean {
  return nextMs < previousMs || nextMs - previousMs > JUMP_MINUTES * MS_PER_MINUTE;
}

export class EventQueue {
  private items: QueuedEvent[] = [];

  get size(): number {
    return this.items.length;
  }

  /** Adds events in timestamp order (stable for equal timestamps). Invalid timestamps are skipped. */
  push(events: readonly PlatformEvent[]): void {
    const seen = new Map<string, number>();
    const added: QueuedEvent[] = [];
    for (const event of events) {
      const atMs = Date.parse(event.ts);
      if (Number.isNaN(atMs)) continue;
      const key = `${event.ts}|${event.type}`;
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      added.push({ event, atMs, index });
    }
    this.items = [...this.items, ...added].sort((a, b) => a.atMs - b.atMs).slice(0, MAX_QUEUED);
  }

  /** Removes and returns every event due at or before `untilMs`, in order. */
  drain(untilMs: number): QueuedEvent[] {
    let count = 0;
    while (count < this.items.length && (this.items[count]?.atMs ?? Infinity) <= untilMs)
      count += 1;
    const due = this.items.slice(0, count);
    this.items = this.items.slice(count);
    return due;
  }

  clear(): void {
    this.items = [];
  }
}
