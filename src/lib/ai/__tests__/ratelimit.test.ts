import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "../ratelimit";

describe("fixed-window rate limiter", () => {
  it("allows up to capacity, then blocks until the window resets", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ capacity: 3, windowMs: 1000, now: () => now });
    expect([limiter.take("u"), limiter.take("u"), limiter.take("u")]).toEqual([true, true, true]);
    expect(limiter.take("u")).toBe(false);
    expect(limiter.retryAfterSeconds("u")).toBe(1);
    now = 1000; // window elapsed
    expect(limiter.take("u")).toBe(true);
    expect(limiter.retryAfterSeconds("u")).toBe(1);
  });

  it("keys are isolated", () => {
    const limiter = new FixedWindowLimiter({ capacity: 1, windowMs: 60_000 });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    expect(limiter.take("b")).toBe(true);
  });

  it("retryAfter is 0 for unknown or expired keys and never negative", () => {
    let now = 5000;
    const limiter = new FixedWindowLimiter({ capacity: 1, windowMs: 2000, now: () => now });
    expect(limiter.retryAfterSeconds("ghost")).toBe(0);
    limiter.take("k");
    now = 6500;
    expect(limiter.retryAfterSeconds("k")).toBe(1); // ceil(500ms)
    now = 7000;
    expect(limiter.retryAfterSeconds("k")).toBe(0);
  });

  it("reset clears all keys", () => {
    const limiter = new FixedWindowLimiter({ capacity: 1, windowMs: 60_000 });
    limiter.take("a");
    expect(limiter.take("a")).toBe(false);
    limiter.reset();
    expect(limiter.take("a")).toBe(true);
  });
});
