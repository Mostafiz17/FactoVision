/**
 * In-process fixed-window rate limiter with an injectable clock (pure, testable).
 * Protects the paid AI provider and the database from burst usage. Single-instance
 * scope, like the login throttle (ADR-009); a shared store is the scaling upgrade.
 */
export interface RateLimiterOptions {
  /** Maximum requests per key per window. */
  capacity: number;
  windowMs: number;
  now?: () => number;
}

export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly opts: RateLimiterOptions) {}

  /** True when the request is allowed (and consumes a slot); false when rate-limited. */
  take(key: string): boolean {
    const now = (this.opts.now ?? Date.now)();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.opts.windowMs });
      return true;
    }
    if (entry.count >= this.opts.capacity) return false;
    entry.count += 1;
    return true;
  }

  /** Whole seconds until the key's window resets (0 when not limited). */
  retryAfterSeconds(key: string): number {
    const now = (this.opts.now ?? Date.now)();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return Math.ceil((entry.resetAt - now) / 1000);
  }

  /** Test/maintenance helper. */
  reset(): void {
    this.hits.clear();
  }
}
