// SPDX-License-Identifier: Apache-2.0
import type { RunEvent } from './types.js';
import type { TimeWindow } from './time.js';

export interface LoadResult {
  events: RunEvent[];
  /** The source returned less than the window holds (the page budget or a size limit was hit). */
  truncated: boolean;
}

export interface LoadOptions {
  /** Length of the time slices a remote source pages separately; ignored by file sources. */
  sliceMs?: number;
}

/** Where RunEvents come from. Read-only. */
export interface EventSource {
  readonly kind: 'file' | 'marquez';
  /**
   * Events of every run that has an event in `[since, until)`. File sources return whole runs;
   * remote sources return the events in the window.
   */
  load(window: TimeWindow, signal?: AbortSignal, options?: LoadOptions): Promise<LoadResult>;
  /** Throws an error with a safe message when the source cannot be read. */
  check(signal?: AbortSignal): Promise<void>;
  /** Releases timers and aborts in-flight reads. Safe to call twice. */
  dispose?(): void;
}
