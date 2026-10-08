// SPDX-License-Identifier: Apache-2.0
// The RunEvents a live stream has read so far, merged by identity, so each poll reads only the
// part of the window it has not seen.
import { eventIdentity, type RunEvent } from './types.js';

export class EventStore {
  private readonly events = new Map<string, RunEvent>();

  /** Adds events, ignoring ones already held. */
  add(events: readonly RunEvent[]): void {
    for (const event of events) this.events.set(eventIdentity(event), event);
  }

  /** Drops events older than `sinceMs`. */
  prune(sinceMs: number): void {
    for (const [id, event] of this.events) if (event.timeMs < sinceMs) this.events.delete(id);
  }

  all(): RunEvent[] {
    return [...this.events.values()];
  }
}
