/**
 * Basic in-memory sliding-window rate limiter keyed by client.
 * Good enough for a local development API; not designed for clusters.
 */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(key: string): RateLimitDecision {
    const t = this.now();
    const cutoff = t - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (list.length >= this.limit) {
      const oldest = list[0] ?? t;
      this.hits.set(key, list);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, oldest + this.windowMs - t) };
    }
    list.push(t);
    this.hits.set(key, list);
    // Opportunistic cleanup so the map does not grow forever.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.every((ts) => ts <= cutoff)) this.hits.delete(k);
    }
    return { allowed: true, remaining: this.limit - list.length, retryAfterMs: 0 };
  }
}
