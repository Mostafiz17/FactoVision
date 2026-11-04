import { describe, expect, it } from "vitest";
import { buildAnalyticsReport } from "../report";
import type { AnalyticsEvent, AnalyticsFilters, AnalyticsReport, AnalyticsSource, AnalyticsTask } from "../types";
import { AS_OF, FIXTURE_EDGES, FIXTURE_EVENTS, FIXTURE_SOURCE, FIXTURE_TASKS, at } from "./fixture";

/*
 * Expected values below are hand-calculated from the fixture timestamps
 * (see fixture.ts). Derivations are summarized next to each group.
 */

const run = (
  opts: { asOf?: Date; days?: number; timeZone?: string; filters?: AnalyticsFilters } = {},
  source: AnalyticsSource = FIXTURE_SOURCE,
): AnalyticsReport =>
  buildAnalyticsReport(source, {
    asOf: opts.asOf ?? AS_OF,
    days: opts.days ?? 7,
    timeZone: opts.timeZone ?? "UTC",
    filters: opts.filters,
  });

describe("baseline: 7 days ending 2026-03-15 (UTC), no filters", () => {
  // Window [2026-03-09T00Z, 2026-03-16T00Z), cutoff 2026-03-15T12:00Z.
  const r = run();

  it("window boundaries", () => {
    expect(r.window).toMatchObject({
      startDay: "2026-03-09",
      endDay: "2026-03-15",
      start: "2026-03-09T00:00:00.000Z",
      endExclusive: "2026-03-16T00:00:00.000Z",
      asOf: "2026-03-15T12:00:00.000Z",
    });
  });

  it("population: 11 tasks existed at asOf (including the deleted T10); 7 are open", () => {
    expect(r.population).toEqual({ tasks: 11, open: 7 });
  });

  it("throughput: created 4 (T3,T4,T8,T10), completed 3 (T1,T2,T4), reopened 1 (T2), net 2", () => {
    expect(r.throughput).toEqual({ created: 4, completed: 3, reopened: 1, net: 2 });
  });

  it("daily counts sum to the throughput totals", () => {
    expect(r.daily).toEqual([
      { day: "2026-03-09", created: 3, completed: 0, reopened: 0 },
      { day: "2026-03-10", created: 0, completed: 1, reopened: 0 },
      { day: "2026-03-11", created: 0, completed: 0, reopened: 0 },
      { day: "2026-03-12", created: 1, completed: 0, reopened: 0 },
      { day: "2026-03-13", created: 0, completed: 1, reopened: 0 },
      { day: "2026-03-14", created: 0, completed: 1, reopened: 1 },
      { day: "2026-03-15", created: 0, completed: 0, reopened: 0 },
    ]);
  });

  it("cohort completion rate: cohort {T3,T4,T8} (T10 deleted), done at asOf {T4} → 1/3", () => {
    expect(r.completionRate).toEqual({ eligible: 3, completed: 1, rate: 0.3333 });
  });

  it("cycle time: samples [3, 3.3333, 7] → mean 4.44, P50 3.33, P85 7", () => {
    expect(r.timing.cycle).toEqual({ count: 3, mean: 4.44, p50: 3.33, p85: 7, min: 3, max: 7 });
  });

  it("lead time: samples [4.0417, 5.125, 8] → mean 5.72, P50 5.13 (half-up), P85 8", () => {
    expect(r.timing.lead).toEqual({ count: 3, mean: 5.72, p50: 5.13, p85: 8, min: 4.04, max: 8 });
  });

  it("per-completion cycle samples, oldest first, with estimate points", () => {
    expect(r.timing.cycleSamples).toEqual([
      { taskId: "T1", completedAt: "2026-03-10T10:00:00.000Z", days: 3, points: 3 },
      { taskId: "T2", completedAt: "2026-03-13T08:00:00.000Z", days: 7, points: 5 },
      { taskId: "T4", completedAt: "2026-03-14T16:00:00.000Z", days: 3.33, points: 2 },
    ]);
    expect(r.completedTaskIds).toEqual(["T1", "T2", "T4"]);
  });

  it("on-time: T1 on time (03-10 ≤ 03-12); T2 late (03-13 > 03-11); T4 late (03-14 16:00 > 03-14 00:00) → 1/3", () => {
    expect(r.onTime).toEqual({ eligible: 3, onTime: 1, late: 2, rate: 0.3333 });
  });

  it("overdue at asOf: T2 (due 03-11) and T5 (due 03-10); T9 due 03-16 and T7 due 03-20 are not", () => {
    expect(r.overdue.count).toBe(2);
    expect(r.overdue.openWithDue).toBe(4); // T2, T5, T7, T9
    expect(r.overdue.share).toBe(0.5);
    // ages: T2 = 4.5 days (03-11T00 → 03-15T12), T5 = 5.5 days
    expect(r.overdue.ageDays).toEqual({ count: 2, mean: 5, p50: 4.5, p85: 5.5, min: 4.5, max: 5.5 });
  });

  it("active workload: T2 (5), T3 (unestimated), T7 (3) → 8 points, coverage 2/3", () => {
    expect(r.workload.active).toEqual({ count: 3, estimated: 2, unestimated: 1, points: 8, coverage: 0.6667 });
  });

  it("queued workload: T5 (8), T8 (2), T9 (1), T11 (6) → 17 points, full coverage", () => {
    expect(r.workload.queued).toEqual({ count: 4, estimated: 4, unestimated: 0, points: 17, coverage: 1 });
  });

  it("active load by assignee: B holds 8 points; A holds one unestimated task", () => {
    expect(r.workload.activeByAssignee).toEqual([
      { assigneeId: "B", count: 2, points: 8 },
      { assigneeId: "A", count: 1, points: 0 },
    ]);
  });

  it("blocked: T5 (blocked by open T7) and T8 (blocked by open T9); T8's T6 blocker is done → 2/7", () => {
    expect(r.blocked).toEqual({
      openTasks: 7,
      blocked: 2,
      share: 0.2857,
      blockedEstimatedPoints: 10,
      topBlockers: [
        { taskId: "T7", title: "eta", blocks: 1 },
        { taskId: "T9", title: "iota", blocks: 1 },
      ],
    });
  });

  it("weekly: one Monday-start week covering all 7 days", () => {
    expect(r.weekly).toEqual([
      {
        weekStart: "2026-03-09",
        daysInWindow: 7,
        created: 4,
        completed: 3,
        reopened: 1,
        net: 2,
        onTimeEligible: 3,
        onTime: 1,
        onTimeRate: 0.3333,
        cycleCount: 3,
        cycleMedianDays: 3.33,
      },
    ]);
  });

  it("limitations are attached to every report", () => {
    expect(r.limitations.length).toBeGreaterThan(0);
  });
});

describe("window and as-of replay", () => {
  it("a 14-day window splits into two Monday-start weeks (03-02 and 03-09), each with 7 days", () => {
    const r = run({ days: 14 });
    expect(r.window.startDay).toBe("2026-03-02");
    expect(r.throughput).toEqual({ created: 10, completed: 4, reopened: 1, net: 3 });
    expect(r.completionRate).toEqual({ eligible: 9, completed: 3, rate: 0.3333 });
    expect(r.weekly).toEqual([
      {
        weekStart: "2026-03-02",
        daysInWindow: 7,
        created: 6, // T6, T5, T2, T11, T1, T7
        completed: 1, // T6 on 03-08
        reopened: 0,
        net: 1,
        onTimeEligible: 0, // T6 has no due date
        onTime: 0,
        onTimeRate: null,
        cycleCount: 1,
        cycleMedianDays: 2,
      },
      {
        weekStart: "2026-03-09",
        daysInWindow: 7,
        created: 4,
        completed: 3,
        reopened: 1,
        net: 2,
        onTimeEligible: 3,
        onTime: 1,
        onTimeRate: 0.3333,
        cycleCount: 3,
        cycleMedianDays: 3.33,
      },
    ]);
  });

  it("asOf 2026-03-12T12:00Z replays history: later completions, deletion and reopen are not yet applied", () => {
    // Window [03-06, 03-13). T2 completes 03-13 and T4 completes 03-14: both are in the future.
    const r = run({ asOf: at("2026-03-12T12:00:00Z") });
    expect(r.throughput).toEqual({ created: 6, completed: 2, reopened: 0, net: 2 });
    // Cohort {T1,T7,T3,T4,T8}; T10 was deleted 03-11 (before asOf) so it is excluded; only T1 is done.
    expect(r.completionRate).toEqual({ eligible: 5, completed: 1, rate: 0.2 });
    expect(r.population.open).toBe(8); // T2,T3,T4,T5,T7,T8,T9,T11
    expect(r.overdue).toMatchObject({ count: 2, openWithDue: 5, share: 0.4 }); // T2, T5 overdue
    expect(r.workload.active).toMatchObject({ count: 3, unestimated: 1, points: 7 }); // T2 5, T4 2
    expect(r.workload.queued).toMatchObject({ count: 5, points: 20 }); // T5 8, T7 3, T8 2, T9 1, T11 6
  });
});

describe("filters: changing a filter changes the population and the numbers", () => {
  it("project P1 (T1,T2,T4,T7,T8,T10,T11): completions and cohort shrink, blocked uses cross-project blockers", () => {
    const r = run({ filters: { projectId: "P1" } });
    expect(r.throughput).toEqual({ created: 3, completed: 3, reopened: 1, net: 2 });
    expect(r.completionRate).toEqual({ eligible: 2, completed: 1, rate: 0.5 }); // T4, T8 (T10 deleted)
    expect(r.population.open).toBe(4); // T2, T7, T8, T11
    expect(r.overdue).toMatchObject({ count: 1, openWithDue: 2, share: 0.5 }); // T2 of {T2, T7}
    expect(r.workload.active).toMatchObject({ count: 2, points: 8, coverage: 1 });
    expect(r.workload.queued).toMatchObject({ count: 2, points: 8 });
    // T8 is blocked by T9, which lives in P2. Blockers are resolved across projects.
    expect(r.blocked).toEqual({
      openTasks: 4,
      blocked: 1,
      share: 0.25,
      blockedEstimatedPoints: 2,
      topBlockers: [{ taskId: "T9", title: "iota", blocks: 1 }],
    });
  });

  it("project P2 (T3,T5,T6,T9): zero completions give rate 0, not null, while an empty cohort gives null", () => {
    const r = run({ filters: { projectId: "P2" } });
    expect(r.throughput).toEqual({ created: 1, completed: 0, reopened: 0, net: 0 });
    expect(r.completionRate).toEqual({ eligible: 1, completed: 0, rate: 0 });
    expect(r.timing.cycle).toMatchObject({ count: 0, mean: null, p50: null, p85: null });
    expect(r.onTime).toEqual({ eligible: 0, onTime: 0, late: 0, rate: null });
    expect(r.overdue).toMatchObject({ count: 1, openWithDue: 2, share: 0.5 }); // T5 of {T5, T9}
    expect(r.workload.active).toEqual({ count: 1, estimated: 0, unestimated: 1, points: 0, coverage: 0 });
    expect(r.workload.queued).toMatchObject({ count: 2, points: 9 });
    expect(r.blocked).toEqual({
      openTasks: 3,
      blocked: 1,
      share: 0.3333,
      blockedEstimatedPoints: 8,
      topBlockers: [{ taskId: "T7", title: "eta", blocks: 1 }],
    });
  });

  it("P1 + P2 partitions add up to the unfiltered totals", () => {
    const all = run();
    const p1 = run({ filters: { projectId: "P1" } });
    const p2 = run({ filters: { projectId: "P2" } });
    expect(p1.throughput.created + p2.throughput.created).toBe(all.throughput.created);
    expect(p1.throughput.completed + p2.throughput.completed).toBe(all.throughput.completed);
    expect(p1.throughput.reopened + p2.throughput.reopened).toBe(all.throughput.reopened);
    expect(p1.population.open + p2.population.open).toBe(all.population.open);
    expect(p1.overdue.count + p2.overdue.count).toBe(all.overdue.count);
    expect(p1.blocked.blocked + p2.blocked.blocked).toBe(all.blocked.blocked);
    expect(p1.workload.active.count + p2.workload.active.count).toBe(all.workload.active.count);
    expect(p1.workload.active.points + p2.workload.active.points).toBe(all.workload.active.points);
    expect(p1.workload.queued.points + p2.workload.queued.points).toBe(all.workload.queued.points);
  });

  it("assignee B (T2, T6, T7): only T2 completes in the window; cohort is empty so the rate is null", () => {
    const r = run({ filters: { assigneeId: "B" } });
    expect(r.completedTaskIds).toEqual(["T2"]);
    expect(r.throughput).toEqual({ created: 0, completed: 1, reopened: 1, net: 0 });
    expect(r.completionRate).toEqual({ eligible: 0, completed: 0, rate: null });
    expect(r.overdue).toMatchObject({ count: 1, openWithDue: 2, share: 0.5 });
    expect(r.workload.active.points).toBe(8);
    expect(r.blocked).toMatchObject({ openTasks: 2, blocked: 0, share: 0, topBlockers: [] });
  });

  it("assignee 'none' (unassigned T5, T11): T5 is overdue and blocked by T7", () => {
    const r = run({ filters: { assigneeId: "none" } });
    expect(r.population.open).toBe(2);
    expect(r.completedTaskIds).toEqual([]);
    expect(r.overdue).toMatchObject({ count: 1, openWithDue: 1, share: 1 });
    expect(r.blocked).toEqual({
      openTasks: 2,
      blocked: 1,
      share: 0.5,
      blockedEstimatedPoints: 8,
      topBlockers: [{ taskId: "T7", title: "eta", blocks: 1 }],
    });
    expect(r.workload.queued).toMatchObject({ count: 2, points: 14 });
  });

  it("priority 'high' keeps only T2", () => {
    const r = run({ filters: { priority: "high" } });
    expect(r.throughput).toEqual({ created: 0, completed: 1, reopened: 1, net: 0 });
    expect(r.population.open).toBe(1);
    expect(r.overdue).toMatchObject({ count: 1, share: 1 });
    expect(r.workload.active.points).toBe(5);
  });

  it("label filter is normalized (' UI ' → 'ui') and selects T1, T2, T4", () => {
    const r = run({ filters: { label: " UI " } });
    expect(r.filters).toEqual({ label: "ui" });
    expect(r.throughput).toEqual({ created: 1, completed: 3, reopened: 1, net: 2 });
    expect(r.completionRate).toEqual({ eligible: 1, completed: 1, rate: 1 });
    expect(r.population.open).toBe(1); // T2
  });

  it("label 'infra' selects only T5: no completions, overdue, and blocked", () => {
    const r = run({ filters: { label: "infra" } });
    expect(r.throughput.completed).toBe(0);
    expect(r.overdue).toMatchObject({ count: 1, share: 1 });
    expect(r.blocked).toMatchObject({ blocked: 1, share: 1 });
  });

  it("an empty project (P3 has no tasks) yields zeros, nulls and an empty weekly series", () => {
    const r = run({ filters: { projectId: "P3" } });
    expect(r.population).toEqual({ tasks: 0, open: 0 });
    expect(r.throughput).toEqual({ created: 0, completed: 0, reopened: 0, net: 0 });
    expect(r.completionRate).toEqual({ eligible: 0, completed: 0, rate: null });
    expect(r.timing.cycle.count).toBe(0);
    expect(r.onTime.rate).toBeNull();
    expect(r.overdue.share).toBeNull();
    expect(r.workload.active.coverage).toBeNull();
    expect(r.blocked).toEqual({ openTasks: 0, blocked: 0, share: null, blockedEstimatedPoints: 0, topBlockers: [] });
    expect(r.weekly[0]).toMatchObject({ created: 0, completed: 0, onTimeRate: null, cycleMedianDays: null });
  });
});

describe("empty datasets and boundaries", () => {
  it("before any task existed, every statistic is empty rather than zero", () => {
    const r = run({ asOf: at("2026-01-01T00:00:00Z") });
    expect(r.population).toEqual({ tasks: 0, open: 0 });
    expect(r.timing.cycle).toEqual({ count: 0, mean: null, p50: null, p85: null, min: null, max: null });
    expect(r.timing.lead.p85).toBeNull();
    expect(r.completionRate.rate).toBeNull();
    expect(r.onTime.rate).toBeNull();
    expect(r.overdue.ageDays.count).toBe(0);
    expect(r.daily.every((d) => d.created + d.completed + d.reopened === 0)).toBe(true);
  });

  it("a source with no tasks and no events is handled", () => {
    const r = buildAnalyticsReport({ tasks: [], events: [], edges: [] }, { asOf: AS_OF, days: 1, timeZone: "UTC" });
    expect(r.population.tasks).toBe(0);
    expect(r.daily).toEqual([{ day: "2026-03-15", created: 0, completed: 0, reopened: 0 }]);
  });

  it("overdue is strict: a due instant equal to asOf is not overdue; one millisecond earlier is", () => {
    const base = (due: Date): AnalyticsSource => ({
      tasks: [{ ...FIXTURE_TASKS[0], id: "Q", dueDate: due, status: "backlog", deletedAt: null, labels: [], assigneeId: null, estimatePoints: null, projectId: "P1", priority: "medium", createdAt: at("2026-03-01T00:00:00Z") }],
      events: [{ id: "q1", taskId: "Q", type: "created", at: at("2026-03-01T00:00:00Z"), fromValue: null, toValue: "backlog" }],
      edges: [],
    });
    expect(run({}, base(AS_OF)).overdue.count).toBe(0);
    expect(run({}, base(new Date(AS_OF.getTime() - 1))).overdue.count).toBe(1);
  });

  it("on-time counts completion exactly at the due instant as on time", () => {
    const due = at("2026-03-10T10:00:00Z");
    const source: AnalyticsSource = {
      tasks: [{ id: "E", title: "e", projectId: "P1", assigneeId: null, priority: "medium", estimatePoints: null, dueDate: due, labels: [], status: "done", createdAt: at("2026-03-06T09:00:00Z"), deletedAt: null }],
      events: [
        { id: "e1", taskId: "E", type: "created", at: at("2026-03-06T09:00:00Z"), fromValue: null, toValue: "backlog" },
        { id: "e2", taskId: "E", type: "status_changed", at: at("2026-03-07T10:00:00Z"), fromValue: "backlog", toValue: "in_progress" },
        { id: "e3", taskId: "E", type: "completed", at: due, fromValue: "in_progress", toValue: "done" },
      ],
      edges: [],
    };
    expect(run({}, source).onTime).toEqual({ eligible: 1, onTime: 1, late: 0, rate: 1 });
  });
});

describe("determinism and the pre-aggregated path", () => {
  it("input order does not change the report", () => {
    const reversed: AnalyticsEvent[] = [...FIXTURE_EVENTS].reverse();
    expect(run({}, { ...FIXTURE_SOURCE, events: reversed })).toEqual(run());
  });

  it("supplying daily counts (SQL GROUP BY path) gives the same daily series and throughput as derivation", () => {
    const derived = run();
    const rows = derived.daily.flatMap((d) => [
      ...(d.created ? [{ day: d.day, type: "created" as const, count: d.created }] : []),
      ...(d.completed ? [{ day: d.day, type: "completed" as const, count: d.completed }] : []),
      ...(d.reopened ? [{ day: d.day, type: "reopened" as const, count: d.reopened }] : []),
    ]);
    const viaSql = run({}, { ...FIXTURE_SOURCE, dailyCounts: rows });
    expect(viaSql.daily).toEqual(derived.daily);
    expect(viaSql.throughput).toEqual(derived.throughput);
    expect(viaSql.weekly).toEqual(derived.weekly);
  });
});

describe("deleted tasks and reopen semantics", () => {
  it("a task completed and then deleted counts in historical throughput but not in the cohort or snapshots", () => {
    const task: AnalyticsTask = { id: "X", title: "x", projectId: "P1", assigneeId: null, priority: "medium", estimatePoints: null, dueDate: null, labels: [], status: "done", createdAt: at("2026-03-10T09:00:00Z"), deletedAt: at("2026-03-12T10:00:00Z") };
    const source: AnalyticsSource = {
      tasks: [task],
      events: [
        { id: "x1", taskId: "X", type: "created", at: at("2026-03-10T09:00:00Z"), fromValue: null, toValue: "backlog" },
        { id: "x2", taskId: "X", type: "status_changed", at: at("2026-03-10T10:00:00Z"), fromValue: "backlog", toValue: "in_progress" },
        { id: "x3", taskId: "X", type: "completed", at: at("2026-03-11T10:00:00Z"), fromValue: "in_progress", toValue: "done" },
        { id: "x4", taskId: "X", type: "deleted", at: at("2026-03-12T10:00:00Z"), fromValue: null, toValue: null },
      ],
      edges: [],
    };
    const r = run({}, source);
    expect(r.throughput.completed).toBe(1);
    expect(r.timing.cycle.count).toBe(1);
    expect(r.completionRate).toEqual({ eligible: 0, completed: 0, rate: null });
    expect(r.population.open).toBe(0);
  });

  it("T2 completes once in the window (03-13) and its reopen is counted separately (03-14)", () => {
    const r = run();
    expect(r.completedTaskIds.filter((id) => id === "T2")).toHaveLength(1);
    expect(r.throughput.reopened).toBe(1);
    expect(r.workload.active.points).toBe(8); // T2 is open again (in_progress)
  });
});

describe("timezone changes the local day buckets (and therefore the window)", () => {
  // Created 2026-03-13T02:00Z; in progress 02:10Z; completed 2026-03-14T03:30Z.
  const source: AnalyticsSource = {
    tasks: [{ id: "Z", title: "z", projectId: "P1", assigneeId: null, priority: "medium", estimatePoints: null, dueDate: null, labels: [], status: "done", createdAt: at("2026-03-13T02:00:00Z"), deletedAt: null }],
    events: [
      { id: "z1", taskId: "Z", type: "created", at: at("2026-03-13T02:00:00Z"), fromValue: null, toValue: "backlog" },
      { id: "z2", taskId: "Z", type: "status_changed", at: at("2026-03-13T02:10:00Z"), fromValue: "backlog", toValue: "in_progress" },
      { id: "z3", taskId: "Z", type: "completed", at: at("2026-03-14T03:30:00Z"), fromValue: "in_progress", toValue: "done" },
    ],
    edges: [],
  };
  const asOf = at("2026-03-14T23:00:00Z");

  it("UTC: created and completed on different days, both inside the window", () => {
    const r = buildAnalyticsReport(source, { asOf, days: 2, timeZone: "UTC" });
    expect(r.daily).toEqual([
      { day: "2026-03-13", created: 1, completed: 0, reopened: 0 },
      { day: "2026-03-14", created: 0, completed: 1, reopened: 0 },
    ]);
  });

  it("America/New_York: the completion is 03-13 local, and the creation falls before the window", () => {
    const r = buildAnalyticsReport(source, { asOf, days: 2, timeZone: "America/New_York" });
    expect(r.window.startDay).toBe("2026-03-13");
    expect(r.daily).toEqual([
      { day: "2026-03-13", created: 0, completed: 1, reopened: 0 },
      { day: "2026-03-14", created: 0, completed: 0, reopened: 0 },
    ]);
    expect(r.completionRate.eligible).toBe(0); // created 03-12 local, outside the window
  });

  it("Pacific/Kiritimati (UTC+14): the window shifts forward a day", () => {
    const r = buildAnalyticsReport(source, { asOf, days: 2, timeZone: "Pacific/Kiritimati" });
    expect(r.window.startDay).toBe("2026-03-14");
    expect(r.daily).toEqual([
      { day: "2026-03-14", created: 0, completed: 1, reopened: 0 },
      { day: "2026-03-15", created: 0, completed: 0, reopened: 0 },
    ]);
  });
});
