export const DAY_MS = 86_400_000;

/** UTC start of day — all analytics bucket on UTC days for determinism. */
export function startOfDay(d: Date): Date {
  const c = new Date(d.getTime());
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fractional days between two instants (b − a). */
export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Inclusive list of UTC day keys covering [from, to]. */
export function dayRange(from: Date, to: Date): string[] {
  const keys: string[] = [];
  let cur = startOfDay(from);
  const end = startOfDay(to);
  while (cur.getTime() <= end.getTime()) {
    keys.push(dayKey(cur));
    cur = addDays(cur, 1);
  }
  return keys;
}

export function round(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}