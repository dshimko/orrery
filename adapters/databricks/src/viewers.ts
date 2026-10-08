// SPDX-License-Identifier: Apache-2.0
// Per-viewer state with a hard cap. In on-behalf-of-user mode the viewer key is derived from the
// forwarded token, so the map must stay bounded however many viewers come and go.

/** Most viewers whose state is kept at once; the least recently used viewer is dropped first. */
export const MAX_VIEWERS = 1_000;

/** A least-recently-used map from viewer key to that viewer's state. */
export class ViewerMap<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly limit: number = MAX_VIEWERS) {}

  /** The viewer's state, marking the viewer as recently used. */
  get(viewer: string): V | undefined {
    const value = this.entries.get(viewer);
    if (value === undefined) return undefined;
    this.entries.delete(viewer);
    this.entries.set(viewer, value);
    return value;
  }

  /** The viewer's state, created with `create` when absent (evicting the oldest viewer if full). */
  getOrCreate(viewer: string, create: () => V): V {
    const existing = this.get(viewer);
    if (existing !== undefined) return existing;
    const created = create();
    this.entries.set(viewer, created);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return created;
  }

  delete(viewer: string): void {
    this.entries.delete(viewer);
  }

  get size(): number {
    return this.entries.size;
  }
}
