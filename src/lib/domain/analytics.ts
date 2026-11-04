import {
  DAY_MS,
  addDays,
  dayKey,
  dayRange,
  daysBetween,
  round,
  startOfDay,
} from "./dates";
import type {
  CfdPoint,
  DailyPoint,
  ForecastDTO,
  TaskStatus,
} from "./types";
import { STATUSES, WIP_STATUSES } from "./types";

/** Nearest-rank percentile. p in [0,100]. Empty sample → 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

/** Numeric summary used by the legacy risk context; never sees an empty sample (callers check count). */
export interface NumericSummary {
  count: number;
  mean: number;
  p50: number;
  p85: number;
  min: number;
  max: number;
}

export function summarize(values: number[]): NumericSummary {
  if (values.length === 0) {
    return { count: 0, mean: 0, p50: 0, p85: 0, min: 0, max: 0 };
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    count: values.length,
    mean: round(mean),
    p50: round(percentile(values, 50)),
    p85: round(percentile(values, 85)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

/** λ_t = α·x_t + (1−α)·λ_{t−1}, λ_0 = x_0. */
export function ewmaSeries(values: number[], alpha: number): number[] {
  if (values.length === 0) return [];
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

export interface EventInput {
  type: string;
  createdAt: Date;
}

/** Daily created / completed / reopened counts within [from, to] + EWMA of completions. */
export function buildDailySeries(
  events: EventInput[],
  from: Date,
  to: Date,
  alpha: number,
): DailyPoint[] {
  const keys = dayRange(from, to);
  const map = new Map<string, { completed: number; reopened: number; created: number }>();
  for (const k of keys) map.set(k, { completed: 0, reopened: 0, created: 0 });
  const lo = startOfDay(from).getTime();
  const hi = startOfDay(to).getTime() + DAY_MS;
  for (const e of events) {
    const t = e.createdAt.getTime();
    if (t < lo || t >= hi) continue;
    const bucket = map.get(dayKey(e.createdAt));
    if (!bucket) continue;
    if (e.type === "completed") bucket.completed += 1;
    else if (e.type === "reopened") bucket.reopened += 1;
    else if (e.type === "created") bucket.created += 1;
  }
  const completed = keys.map((k) => map.get(k)?.completed ?? 0);
  const smooth = ewmaSeries(completed, alpha);
  return keys.map((k, i) => ({
    date: k,
    completed: completed[i],
    reopened: map.get(k)?.reopened ?? 0,
    created: map.get(k)?.created ?? 0,
    ewma: round(smooth[i], 3),
  }));
}

export interface CompletedTaskInput {
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  dueDate: Date | null;
}

function completedInWindow<T extends CompletedTaskInput>(
  tasks: T[],
  from: Date,
  to: Date,
): T[] {
  const lo = startOfDay(from).getTime();
  const hi = startOfDay(to).getTime() + DAY_MS;
  return tasks.filter((t) => {
    if (!t.completedAt) return false;
    const c = t.completedAt.getTime();
    return c >= lo && c < hi;
  });
}

/** Cycle time = completedAt − startedAt (days); lead time = completedAt − createdAt. */
export function cycleLeadSamples(
  tasks: CompletedTaskInput[],
  from: Date,
  to: Date,
): { cycle: number[]; lead: number[] } {
  const done = completedInWindow(tasks, from, to);
  const cycle: number[] = [];
  const lead: number[] = [];
  for (const t of done) {
    if (!t.completedAt) continue;
    if (t.startedAt && t.completedAt.getTime() >= t.startedAt.getTime()) {
      cycle.push(daysBetween(t.startedAt, t.completedAt));
    }
    lead.push(Math.max(0, daysBetween(t.createdAt, t.completedAt)));
  }
  return { cycle, lead };
}

export function onTimeStats(
  tasks: CompletedTaskInput[],
  from: Date,
  to: Date,
): { onTime: number; late: number; total: number; rate: number } {
  const done = completedInWindow(tasks, from, to).filter((t) => t.dueDate !== null);
  let onTime = 0;
  for (const t of done) {
    if (t.completedAt && t.dueDate && t.completedAt.getTime() <= t.dueDate.getTime()) onTime++;
  }
  const total = done.length;
  return {
    onTime,
    late: total - onTime,
    total,
    rate: total === 0 ? 0 : round(onTime / total, 4),
  };
}

export interface CfdTaskInput {
  createdAt: Date;
  initialStatus: TaskStatus;
  transitions: { at: Date; to: TaskStatus }[];
}

/**
 * End-of-day occupancy per status, reconstructed from the event log.
 * The Done band holds tasks whose status is Done at day end — a reopen moves
 * work back into an active band, so bands always sum to live task count.
 */
export function buildCfd(tasks: CfdTaskInput[], from: Date, to: Date): CfdPoint[] {
  const keys = dayRange(from, to);
  const points: CfdPoint[] = keys.map((date) => ({
    date,
    backlog: 0,
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0,
  }));
  for (const task of tasks) {
    const timeline = [...task.transitions].sort((a, b) => a.at.getTime() - b.at.getTime());
    let ti = 0;
    let status: TaskStatus = task.initialStatus;
    for (let di = 0; di < keys.length; di++) {
      const endOfDay = startOfDay(new Date(keys[di] + "T00:00:00.000Z")).getTime() + DAY_MS;
      if (task.createdAt.getTime() >= endOfDay) continue;
      while (ti < timeline.length && timeline[ti].at.getTime() < endOfDay) {
        status = timeline[ti].to;
        ti++;
      }
      points[di][status] += 1;
    }
  }
  return points;
}

/**
 * Backlog clearance from empirical daily-completion percentiles (zero days included).
 * Optimistic uses q85/day, conservative uses q50/day. ε guard avoids division by zero
 * (returns Infinity when the workspace has no throughput at that percentile).
 */
export function forecast(
  backlog: number,
  dailyCompleted: number[],
  alpha: number,
): ForecastDTO {
  const p50Daily = percentile(dailyCompleted, 50);
  const p85Daily = percentile(dailyCompleted, 85);
  const smooth = ewmaSeries(dailyCompleted, alpha);
  const ewmaLast = smooth.length === 0 ? 0 : round(smooth[smooth.length - 1], 3);
  const days = (rate: number) => (backlog === 0 ? 0 : rate <= 0 ? Infinity : round(backlog / rate, 1));
  return {
    backlog,
    p50Daily,
    p85Daily,
    ewmaLast,
    optimisticDays: days(p85Daily),
    conservativeDays: days(p50Daily),
  };
}

/** Default per-member WIP limit for flow views (PROJECT_SPEC §5). */
export const DEFAULT_WIP_LIMIT = 3;

export interface OpenTaskLite {
  assigneeId: string | null;
  status: TaskStatus;
}

export function isWip(status: TaskStatus): boolean {
  return WIP_STATUSES.includes(status);
}

export function totalWip(tasks: OpenTaskLite[]): number {
  return tasks.filter((t) => isWip(t.status)).length;
}

export function windowBounds(days: number, now: Date): { from: Date; to: Date } {
  const to = startOfDay(now);
  return { from: addDays(to, -(days - 1)), to };
}

export function statusOrder(s: TaskStatus): number {
  return STATUSES.indexOf(s);
}