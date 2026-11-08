import { describe, expect, it } from "vitest";
import {
  buildCfd,
  buildDailySeries,
  cycleLeadSamples,
  ewmaSeries,
  forecast,
  onTimeStats,
  percentile,
  summarize,
  totalWip,
  windowBounds,
} from "../analytics";
import { DAY_MS } from "../dates";

const D = (s: string) => new Date(s + "T12:00:00.000Z");

describe("percentile (nearest-rank)", () => {
  it("computes P50 and P85 on 1..10", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 85)).toBe(9);
  });
  it("sorts a copy and handles singletons / empty", () => {
    expect(percentile([9, 1, 5], 50)).toBe(5);
    expect(percentile([7], 85)).toBe(7);
    expect(percentile([], 85)).toBe(0);
  });
});

describe("summarize", () => {
  it("matches hand-computed statistics", () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.count).toBe(8);
    expect(s.mean).toBe(5);
    expect(s.p50).toBe(4);
    expect(s.p85).toBe(7);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
  });
  it("returns zeros for an empty sample", () => {
    expect(summarize([])).toEqual({ count: 0, mean: 0, p50: 0, p85: 0, min: 0, max: 0 });
  });
});

describe("EWMA λ_t = α·x_t + (1−α)·λ_{t−1}", () => {
  it("applies the recurrence with λ0 = x0", () => {
    expect(ewmaSeries([2, 4], 0.5)).toEqual([2, 3]);
    const out = ewmaSeries([0, 10, 0], 0.3);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(3, 10);
    expect(out[2]).toBeCloseTo(2.1, 10);
  });
  it("α=1 reproduces the raw series; empty stays empty", () => {
    expect(ewmaSeries([3, 1, 4], 1)).toEqual([3, 1, 4]);
    expect(ewmaSeries([], 0.3)).toEqual([]);
  });
});

describe("buildDailySeries", () => {
  const from = D("2026-01-01");
  const to = D("2026-01-03");
  it("buckets by UTC day and excludes out-of-window events", () => {
    const events = [
      { type: "completed", createdAt: new Date("2026-01-01T08:00:00Z") },
      { type: "completed", createdAt: new Date("2026-01-01T23:59:59Z") },
      { type: "reopened", createdAt: new Date("2026-01-02T10:00:00Z") },
      { type: "created", createdAt: new Date("2026-01-03T10:00:00Z") },
      { type: "completed", createdAt: new Date("2025-12-31T23:00:00Z") }, // before
      { type: "completed", createdAt: new Date("2026-01-04T00:00:00Z") }, // after
    ];
    const series = buildDailySeries(events, from, to, 0.5);
    expect(series).toHaveLength(3);
    expect(series[0]).toMatchObject({ date: "2026-01-01", completed: 2, reopened: 0 });
    expect(series[1]).toMatchObject({ date: "2026-01-02", completed: 0, reopened: 1 });
    expect(series[2]).toMatchObject({ date: "2026-01-03", created: 1 });
    expect(series.map((s) => s.ewma)).toEqual([2, 1, 0.5]);
  });
});

describe("cycleLeadSamples", () => {
  const from = D("2026-01-01");
  const to = D("2026-01-10");
  it("cycle = completed − started; lead = completed − created; window-filtered", () => {
    const tasks = [
      { createdAt: D("2026-01-01"), startedAt: D("2026-01-04"), completedAt: D("2026-01-06"), dueDate: null }, // cycle 2, lead 5
      { createdAt: D("2025-12-01"), startedAt: D("2025-12-20"), completedAt: D("2025-12-25"), dueDate: null }, // out
      { createdAt: D("2026-01-02"), startedAt: null, completedAt: D("2026-01-05"), dueDate: null }, // lead only
    ];
    const { cycle, lead } = cycleLeadSamples(tasks, from, to);
    expect(cycle).toEqual([2]);
    expect(lead.sort()).toEqual([3, 5]);
  });
});

describe("onTimeStats", () => {
  const from = D("2026-01-01");
  const to = D("2026-01-10");
  it("counts completion exactly at the due instant as on time; excludes undated", () => {
    const due = D("2026-01-05");
    const tasks = [
      { createdAt: from, startedAt: from, completedAt: due, dueDate: due }, // on time (boundary)
      { createdAt: from, startedAt: from, completedAt: new Date(due.getTime() + 1000), dueDate: due }, // late
      { createdAt: from, startedAt: from, completedAt: D("2026-01-04"), dueDate: null }, // excluded
    ];
    const r = onTimeStats(tasks, from, to);
    expect(r).toEqual({ onTime: 1, late: 1, total: 2, rate: 0.5 });
  });
});

describe("buildCfd (end-of-day occupancy from events)", () => {
  it("moves work between bands and back on reopen", () => {
    const tasks = [
      {
        createdAt: new Date("2026-01-01T09:00:00Z"),
        initialStatus: "todo" as const,
        transitions: [
          { at: new Date("2026-01-02T09:00:00Z"), to: "in_progress" as const },
          { at: new Date("2026-01-03T09:00:00Z"), to: "done" as const },
          { at: new Date("2026-01-04T09:00:00Z"), to: "in_progress" as const },
        ],
      },
    ];
    const cfd = buildCfd(tasks, D("2026-01-01"), D("2026-01-05"));
    expect(cfd.map((p) => p.todo)).toEqual([1, 0, 0, 0, 0]);
    expect(cfd.map((p) => p.in_progress)).toEqual([0, 1, 0, 1, 1]);
    expect(cfd.map((p) => p.done)).toEqual([0, 0, 1, 0, 0]);
    // bands always sum to the live task count
    for (const p of cfd) expect(p.backlog + p.todo + p.in_progress + p.review + p.done).toBe(1);
  });
  it("ignores days before creation", () => {
    const tasks = [{ createdAt: new Date("2026-01-03T09:00:00Z"), initialStatus: "backlog" as const, transitions: [] }];
    const cfd = buildCfd(tasks, D("2026-01-01"), D("2026-01-04"));
    expect(cfd.map((p) => p.backlog)).toEqual([0, 0, 1, 1]);
  });
});

describe("forecast", () => {
  it("uses empirical percentiles including zero days", () => {
    const f = forecast(8, [0, 2, 4, 2, 0, 2, 4], 0.3);
    expect(f.p50Daily).toBe(2);
    expect(f.p85Daily).toBe(4);
    expect(f.conservativeDays).toBe(4);
    expect(f.optimisticDays).toBe(2);
  });
  it("empty backlog clears instantly; zero throughput has no finite forecast, with a JSON-safe null", () => {
    expect(forecast(0, [0, 0], 0.3).conservativeDays).toBe(0);
    expect(forecast(5, [0, 0, 0], 0.3).conservativeDays).toBeNull();
  });
});

describe("WIP + window helpers", () => {
  it("counts only in_progress and review", () => {
    expect(
      totalWip([
        { assigneeId: null, status: "in_progress" },
        { assigneeId: null, status: "review" },
        { assigneeId: null, status: "todo" },
        { assigneeId: null, status: "done" },
      ]),
    ).toBe(2);
  });
  it("windowBounds spans exactly N UTC days", () => {
    const now = new Date("2026-02-14T18:30:00Z");
    const { from, to } = windowBounds(7, now);
    expect(to.toISOString()).toBe("2026-02-14T00:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(6 * DAY_MS);
  });
});