// SPDX-License-Identifier: Apache-2.0

export interface RateLimitOptions {
  /** Tokens added per second. */
  ratePerSecond: number;
  /** Bucket capacity, which is also the largest burst. */
  burst: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = { ratePerSecond: 20, burst: 40 };

const MS_PER_SECOND = 1000;

/** In-memory token bucket, one per environment. */
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
}
