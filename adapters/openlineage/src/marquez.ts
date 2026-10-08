// SPDX-License-Identifier: Apache-2.0
// Read-only client for the Marquez HTTP API. Only GET /api/v1/events/lineage is used
// (https://github.com/MarquezProject/marquez/blob/main/spec/openapi.yml: getLineageEvents with
// sortDirection, before, after, limit, offset; response { events, totalCount }). A load splits its
// window into time slices, newest first, and pages each one, so a busy server cannot push the
// oldest events out of a single capped read. Requests time out, never follow redirects, are
// bounded in pages per load, and never put the API key in a message.
import { normalizeEvent } from './parse.js';
import type { EventSource, LoadOptions, LoadResult } from './source.js';
import { MS_PER_HOUR, MS_PER_MINUTE, type TimeWindow } from './time.js';
import type { RunEvent } from './types.js';

export const REQUEST_TIMEOUT_MS = 15_000;
export const PAGE_LIMIT = 200;
/** Pages one load may read in total, across all its slices. */
export const MAX_PAGES_PER_LOAD = 200;
/** Default slice of a window; each slice is paged on its own. */
export const EVENT_SLICE_MS = MS_PER_HOUR;
/** Largest response body read, in characters. */
export const MAX_BODY_CHARS = 20 * 1024 * 1024;
/** Cached loads are reused for this long, so polling clients share one upstream read. */
export const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 32;
const EVENTS_PATH = '/api/v1/events/lineage';

export type MarquezErrorCode = 'auth' | 'http' | 'timeout' | 'network' | 'format';

export class MarquezError extends Error {
  constructor(
    readonly code: MarquezErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MarquezError';
  }
}

export interface MarquezConfig {
  /** Validated base URL (https, or http on loopback), without credentials or query. */
  url: string;
  namespace?: string | undefined;
  /** Bearer token, already resolved from its environment reference. */
  token?: string | undefined;
}

export interface MarquezDeps {
  fetch: typeof fetch;
  nowMs: () => number;
  /** Per-request timeout; defaults to 15 s. */
  timeoutMs?: number;
  /** Page budget per load; defaults to 200. */
  maxPages?: number;
}

type CacheEntry = { atMs: number; value: Promise<LoadResult> };

/** Windows split newest first into slices of `sliceMs`; the oldest slice is clipped to the window. */
export function sliceWindow(window: TimeWindow, sliceMs: number): TimeWindow[] {
  const since = window.since.getTime();
  const slices: TimeWindow[] = [];
  for (let end = window.until.getTime(); end > since; end -= sliceMs) {
    slices.push({ since: new Date(Math.max(since, end - sliceMs)), until: new Date(end) });
  }
  return slices;
}

const floorMinute = (ms: number): number => Math.floor(ms / MS_PER_MINUTE) * MS_PER_MINUTE;
const ceilMinute = (ms: number): number => Math.ceil(ms / MS_PER_MINUTE) * MS_PER_MINUTE;

/**
 * Reads a response body as text, stopping as soon as it exceeds `maxChars` characters, so a
 * chunked response without Content-Length cannot exhaust memory.
 */
async function readCapped(response: Response, maxChars: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
    if (text.length > maxChars) {
      await reader.cancel().catch(() => undefined);
      throw new MarquezError('format', 'Marquez returned a response that is too large.');
    }
  }
}

/** Waits for `work`, or rejects as soon as `signal` aborts (the work itself is not cancelled). */
function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export class MarquezSource implements EventSource {
  readonly kind = 'marquez';
  /** Entries skipped as not valid RunEvents in the latest read. */
  skipped = 0;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly disposal = new AbortController();

  constructor(
    private readonly config: MarquezConfig,
    private readonly deps: MarquezDeps,
  ) {}

  private pageUrl(window: TimeWindow, offset: number, limit: number): string {
    const base = new URL(this.config.url);
    const prefix = base.pathname.replace(/\/+$/, '');
    const url = new URL(`${base.origin}${prefix}${EVENTS_PATH}`);
    url.searchParams.set('sortDirection', 'desc');
    url.searchParams.set('after', window.since.toISOString());
    url.searchParams.set('before', window.until.toISOString());
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    return url.toString();
  }

  private async get(url: string, caller: AbortSignal | undefined): Promise<unknown> {
    const timeoutMs = this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.config.token) headers['Authorization'] = `Bearer ${this.config.token}`;
    let response: Response;
    try {
      response = await this.deps.fetch(url, { method: 'GET', headers, redirect: 'error', signal });
    } catch (error) {
      if (caller?.aborted) throw error;
      if (timeout.aborted) {
        throw new MarquezError('timeout', `Marquez did not answer within ${timeoutMs / 1000} s.`);
      }
      throw new MarquezError('network', 'Marquez could not be reached.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new MarquezError('auth', `Marquez refused the credentials (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new MarquezError('http', `Marquez returned HTTP ${response.status}.`);
    return this.readJson(response, signal);
  }

  private async readJson(response: Response, signal: AbortSignal): Promise<unknown> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) {
      throw new MarquezError('format', 'Marquez returned a response that is too large.');
    }
    let text: string;
    try {
      text = await readCapped(response, MAX_BODY_CHARS);
    } catch (error) {
      if (error instanceof MarquezError || signal.aborted) throw error;
      throw new MarquezError('network', 'The Marquez response was interrupted.');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new MarquezError('format', 'Marquez returned a response that is not JSON.');
    }
  }

  /**
   * Pages every slice of the window, newest slice first, within the page budget. Marquez treats
   * `after` as inclusive and `before` as exclusive (observed against 0.51), so adjacent slices
   * neither overlap nor leave a gap. When the budget runs out the oldest events are left out and
   * the result says so.
   */
  private async readPages(
    window: TimeWindow,
    sliceMs: number,
    signal: AbortSignal,
  ): Promise<LoadResult> {
    const events: RunEvent[] = [];
    let skipped = 0;
    let budget = this.deps.maxPages ?? MAX_PAGES_PER_LOAD;
    const finish = (truncated: boolean): LoadResult => {
      this.skipped = skipped;
      return { events, truncated };
    };
    for (const slice of sliceWindow(window, sliceMs)) {
      for (let offset = 0; ; offset += PAGE_LIMIT) {
        if (budget <= 0) return finish(true);
        budget -= 1;
        const body = await this.get(this.pageUrl(slice, offset, PAGE_LIMIT), signal);
        const items = (body as { events?: unknown } | null)?.events;
        if (!Array.isArray(items)) {
          throw new MarquezError('format', 'Marquez returned no events list.');
        }
        for (const item of items) {
          const event = normalizeEvent(item);
          if (typeof event === 'string') skipped += 1;
          else events.push(event);
        }
        if (items.length < PAGE_LIMIT) break;
      }
    }
    return finish(false);
  }

  async check(signal?: AbortSignal): Promise<void> {
    const now = this.deps.nowMs();
    const window = { since: new Date(now - MS_PER_MINUTE), until: new Date(now) };
    await this.get(this.pageUrl(window, 0, 1), signal);
  }

  async load(
    window: TimeWindow,
    signal?: AbortSignal,
    options: LoadOptions = {},
  ): Promise<LoadResult> {
    const sliceMs = Math.max(MS_PER_MINUTE, options.sliceMs ?? EVENT_SLICE_MS);
    const snapped = {
      since: new Date(floorMinute(window.since.getTime())),
      until: new Date(ceilMinute(window.until.getTime())),
    };
    const key = `${snapped.since.getTime()}-${snapped.until.getTime()}-${sliceMs}`;
    const now = this.deps.nowMs();
    const hit = this.cache.get(key);
    const value =
      hit && now - hit.atMs < CACHE_TTL_MS
        ? hit.value
        : this.fetchAndCache(key, snapped, sliceMs, now);
    const result = await abortable(value, signal);
    const since = window.since.getTime();
    const until = window.until.getTime();
    const namespace = this.config.namespace;
    return {
      truncated: result.truncated,
      events: result.events.filter(
        (event) =>
          event.timeMs >= since &&
          event.timeMs < until &&
          (namespace === undefined || event.job.namespace === namespace),
      ),
    };
  }

  dispose(): void {
    this.disposal.abort();
    this.cache.clear();
  }

  private fetchAndCache(
    key: string,
    window: TimeWindow,
    sliceMs: number,
    now: number,
  ): Promise<LoadResult> {
    for (const [other, entry] of this.cache) {
      if (now - entry.atMs >= CACHE_TTL_MS) this.cache.delete(other);
    }
    while (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    // Shared by concurrent callers, so it follows disposal, not any one caller's signal.
    const value = this.readPages(window, sliceMs, this.disposal.signal);
    this.cache.set(key, { atMs: now, value });
    // A failed read must not be served again from the cache.
    value.catch(() => this.cache.delete(key));
    return value;
  }
}
