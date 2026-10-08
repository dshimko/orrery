// SPDX-License-Identifier: Apache-2.0

export interface RateLimitOptions {
  /** Tokens added per second. */
  ratePerSecond: number;
  /** Bucket capacity, which is also the largest burst. */
  burst: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = { ratePerSecond: 20, burst: 40 };

const MS_PER_SECOND = 1000;

/** In-memory token bucket. */
export class TokenBucket {
  private tokens: number;
  private lastMs: number;

  constructor(
    private readonly options: RateLimitOptions,
    private readonly nowMs: () => number = () => performance.now(),
  ) {
    this.tokens = options.burst;
    this.lastMs = nowMs();
  }

  /** Takes `cost` tokens; returns false (taking none) when the bucket has fewer. */
  tryTake(cost = 1): boolean {
    const now = this.nowMs();
    const refill = ((now - this.lastMs) / MS_PER_SECOND) * this.options.ratePerSecond;
    this.tokens = Math.min(this.options.burst, this.tokens + refill);
    this.lastMs = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Returns tokens taken by `tryTake`, for a request refused by a later check. */
  refund(cost = 1): void {
    this.tokens = Math.min(this.options.burst, this.tokens + cost);
  }
}

/** Per-environment ceiling shared by all clients, so many clients cannot overwhelm an adapter. */
export const DEFAULT_GLOBAL_RATE_LIMIT: RateLimitOptions = { ratePerSecond: 200, burst: 400 };
/** Client buckets kept per environment; the least recently used go first beyond this. */
export const DEFAULT_MAX_CLIENTS = 10_000;

export interface RateLimiterOptions {
  /** Limit for each client within one environment. */
  client?: RateLimitOptions;
  /** Limit for all clients of one environment together. */
  global?: RateLimitOptions;
  maxClients?: number;
  nowMs?: () => number;
}

interface EnvBuckets {
  global: TokenBucket;
  /** Insertion order is recency order: a used client is re-inserted at the end. */
  clients: Map<string, TokenBucket>;
}

/** Token buckets keyed by (environment, client), with a global bucket per environment. */
export class RateLimiter {
  private readonly envs = new Map<string, EnvBuckets>();
  private readonly client: RateLimitOptions;
  private readonly global: RateLimitOptions;
  private readonly maxClients: number;
  private readonly nowMs: () => number;

  constructor(envIds: Iterable<string>, options: RateLimiterOptions = {}) {
    this.client = options.client ?? DEFAULT_RATE_LIMIT;
    this.global = options.global ?? DEFAULT_GLOBAL_RATE_LIMIT;
    this.maxClients = Math.max(1, options.maxClients ?? DEFAULT_MAX_CLIENTS);
    this.nowMs = options.nowMs ?? (() => performance.now());
    for (const id of envIds) {
      this.envs.set(id, { global: new TokenBucket(this.global, this.nowMs), clients: new Map() });
    }
  }

  /** Number of client buckets currently held for the environment. */
  clientCount(envId: string): number {
    return this.envs.get(envId)?.clients.size ?? 0;
  }

  /** Takes `cost` from the client's bucket and the environment's global bucket. */
  tryTake(envId: string, clientKey: string, cost = 1): boolean {
    const env = this.envs.get(envId);
    if (!env) return false;
    const bucket = this.bucketFor(env, clientKey);
    if (!bucket.tryTake(cost)) return false;
    if (env.global.tryTake(cost)) return true;
    bucket.refund(cost);
    return false;
  }

  private bucketFor(env: EnvBuckets, clientKey: string): TokenBucket {
    const existing = env.clients.get(clientKey);
    if (existing) {
      env.clients.delete(clientKey);
      env.clients.set(clientKey, existing);
      return existing;
    }
    while (env.clients.size >= this.maxClients) {
      const oldest = env.clients.keys().next().value;
      if (oldest === undefined) break;
      env.clients.delete(oldest);
    }
    const created = new TokenBucket(this.client, this.nowMs);
    env.clients.set(clientKey, created);
    return created;
  }
}
