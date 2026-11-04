import { describe, expect, it } from "vitest";
import { nearestRank, ratio, roundHalfUp, summarizeSamples } from "../stats";

describe("nearest-rank percentiles", () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it("matches hand-computed ranks on 1..10", () => {
    expect(nearestRank(ten, 10)).toBe(1); // ceil(1) = 1
    expect(nearestRank(ten, 50)).toBe(5); // ceil(5) = 5
    expect(nearestRank(ten, 85)).toBe(9); // ceil(8.5) = 9
    expect(nearestRank(ten, 100)).toBe(10);
  });
  it("uses integer rank arithmetic: P55 of 1..100 is 55, although (55/100)·100 drifts to 55.00000000000001", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect((55 / 100) * 100).toBeGreaterThan(55); // the float form would ceil to 56
    expect(nearestRank(hundred, 55)).toBe(55); // ceil(55·100/100) = 55
  });
  it("a single sample is every percentile", () => {
    expect(nearestRank([7], 50)).toBe(7);
    expect(nearestRank([7], 85)).toBe(7);
  });
  it("rejects empty samples and out-of-range percentiles", () => {
    expect(() => nearestRank([], 50)).toThrow(RangeError);
    expect(() => nearestRank([1], 0)).toThrow(RangeError);
    expect(() => nearestRank([1], 101)).toThrow(RangeError);
  });
});

describe("summaries and empty samples", () => {
  it("empty samples produce nulls, never zeros", () => {
    expect(summarizeSamples([])).toEqual({ count: 0, mean: null, p50: null, p85: null, min: null, max: null });
  });
  it("rounds outputs to 2 decimals half-up (lead times 4.0417, 5.125, 8)", () => {
    const s = summarizeSamples([97 / 24, 5.125, 8]);
    expect(s).toEqual({ count: 3, mean: 5.72, p50: 5.13, p85: 8, min: 4.04, max: 8 });
  });
  it("cycle-style sample 3, 3.3333, 7 summarizes to mean 4.44 and P50 3.33", () => {
    const s = summarizeSamples([3, 80 / 24, 7]);
    expect(s.mean).toBe(4.44);
    expect(s.p50).toBe(3.33);
    expect(s.p85).toBe(7);
  });
});

describe("rounding", () => {
  it("removes binary noise before rounding half-up", () => {
    expect(roundHalfUp(2.675, 2)).toBe(2.68); // stored as 2.67499999…
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(5.125, 2)).toBe(5.13);
    expect(roundHalfUp(5.124, 2)).toBe(5.12);
    expect(roundHalfUp(0, 2)).toBe(0);
  });
  it("ratios are 4-decimal and null on an empty denominator", () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(2, 3)).toBe(0.6667);
    expect(ratio(0, 5)).toBe(0);
    expect(ratio(0, 0)).toBeNull();
  });
});
