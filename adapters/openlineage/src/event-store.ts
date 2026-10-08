// SPDX-License-Identifier: Apache-2.0
// The RunEvents a live stream has read so far, merged by identity, so each poll reads only the
// part of the window it has not seen. Bounded by age (`prune`) and by count (`add` evicts the
// oldest events), so a very busy server cannot grow it without limit.
import { eventIdentity, type RunEvent } from './types.js';

/** Most events one store keeps. */
export const MAX_STORED_EVENTS = 100_000;

export class EventStore {
  private readonly events = new Map<string, RunEvent>();

  constructor(private readonly maxEvents: number = MAX_STORED_EVENTS) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) {
      throw new RangeError('The event store needs a positive whole-number capacity.');
    }
  }

  /**
   * Adds events, ignoring ones already held. When the store outgrows its capacity the oldest
   * events (by event time) are dropped; returns how many were dropped.
   */
  add(events: readonly RunEvent[]): number {
    for (const event of events) this.events.set(eventIdentity(event), event);
    const excess = this.events.size - this.maxEvents;
    if (excess <= 0) return 0;
    const oldest = [...this.events.entries()]
      .sort(([ia, a], [ib, b]) => a.timeMs - b.timeMs || ia.localeCompare(ib))
      .slice(0, excess);
    for (const [id] of oldest) this.events.delete(id);
    return excess;
  }

  /** Drops events older than `sinceMs`. */
  prune(sinceMs: number): void {
    for (const [id, event] of this.events) if (event.timeMs < sinceMs) this.events.delete(id);
  }

  get size(): number {
    return this.events.size;
  }

  all(): RunEvent[] {
    return [...this.events.values()];
  }
}
