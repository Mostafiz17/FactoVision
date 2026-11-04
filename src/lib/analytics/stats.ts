/**
 * Numeric helpers with explicit empty-sample and rounding behaviour.
 *
 * - Empty samples yield `null` (never 0): "no data" must not look like a result.
 * - Percentiles use the nearest-rank method: rank = ceil(p · n / 100), 1-based.
 *   Integer arithmetic (p·n before dividing) avoids float errors such as
 *   0.85 · 20 = 17.000000000000004 pushing the rank up by one.
 * - Rounding is half-up for non-negative values and is applied only to outputs.
 *   Intermediate values are kept at full precision.
 */

export interface SampleStats {
  count: number;
  mean: number | null;
  p50: number | null;
  p85: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Half-up rounding that first removes binary noise: 2.675 is stored as
 * 2.67499999…, so a naive Math.round(x · 100) would return 2.67.
 */
export function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(Number((value * factor).toPrecision(12))) / factor;
}

export function nearestRank(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) throw new RangeError("nearestRank requires at least one value");
  if (!(p > 0 && p <= 100)) throw new RangeError("percentile must be in (0, 100]");
  const rank = Math.ceil((p * sortedAscending.length) / 100);
  const index = Math.min(sortedAscending.length, Math.max(1, rank)) - 1;
  return sortedAscending[index];
}

const DAYS_DECIMALS = 2;

export function summarizeSamples(values: readonly number[]): SampleStats {
  if (values.length === 0) {
    return { count: 0, mean: null, p50: null, p85: null, min: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    count: sorted.length,
    mean: roundHalfUp(mean, DAYS_DECIMALS),
    p50: roundHalfUp(nearestRank(sorted, 50), DAYS_DECIMALS),
    p85: roundHalfUp(nearestRank(sorted, 85), DAYS_DECIMALS),
    min: roundHalfUp(sorted[0], DAYS_DECIMALS),
    max: roundHalfUp(sorted[sorted.length - 1], DAYS_DECIMALS),
  };
}

/** Ratio in [0, 1] rounded to 4 decimals; null when the denominator is zero. */
export function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return roundHalfUp(numerator / denominator, 4);
}

/** Points / days sums: 2 decimals. */
export function roundTo2(value: number): number {
  return roundHalfUp(value, 2);
}
