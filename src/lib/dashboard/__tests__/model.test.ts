import { describe, expect, it } from "vitest";
import { AS_OF } from "@/lib/analytics/__tests__/fixture";
import { assessWorkspaceRisk } from "@/lib/risk/assess";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/model";
import { DATED_SOURCE } from "@/lib/risk/__tests__/fixture";
import { buildDashboard, weekLabel, type DashboardProject } from "../model";

/*
 * Fixture → exact chart data. Values are hand-derived from the Phase 5 fixture
 * (see ANALYTICS.md §9) and the risk fixture in src/lib/risk/__tests__/model.test.ts.
 */
const projects: DashboardProject[] = [
  { id: "P1", name: "Alpha app", color: "#7c5cff" },
  { id: "P2", name: "Beta data", color: "#22d3ee" },
  { id: "P3", name: "Empty", color: "#a3e635" },
];
const members = [
  { id: "A", name: "Ann" },
  { id: "B", name: "Ben" },
];
const risk = {
  results: assessWorkspaceRisk(DATED_SOURCE, AS_OF, DEFAULT_RISK_CONFIG, 0),
  meta: { modelVersion: "2.0.0", revision: 0, fingerprint: "test", capacityPoints: 8 },
};
const build = (filters = {}) =>
  buildDashboard(DATED_SOURCE, { asOf: AS_OF, timeZone: "UTC", days: 7, filters }, risk, projects, members);

describe("dashboard chart data for the 7-day UTC fixture window", () => {
  const d = build();

  it("summary cards", () => {
    expect(d.summary).toEqual({
      openTasks: 7,
      completed: 3,
      reopened: 1,
      completionRate: 0.3333,
      completionEligible: 3,
      onTimeRate: 0.3333,
      onTimeEligible: 3,
      overdue: 2,
      blocked: 2,
      blockedShare: 0.2857,
      cycleP50: 3.33,
      cycleP85: 7,
      leadP50: 5.13,
      activePoints: 8,
      activeCoverage: 0.6667,
      highRisk: 1,
    });
  });

  it("completion trend series (one Monday-start week)", () => {
    expect(d.completionTrend).toEqual([{ weekStart: "2026-03-09", label: "Mar 9", daysInWindow: 7, created: 4, completed: 3, reopened: 1, net: 2 }]);
  });

  it("cycle-time trend: week samples [3, 3.33, 7] → P50 3.33, P85 7", () => {
    expect(d.cycleTrend).toEqual([{ weekStart: "2026-03-09", label: "Mar 9", count: 3, p50: 3.33, p85: 7 }]);
  });

  it("workload distribution: Ben 8 active pt; Ann 1 unestimated active + 3 queued pt; unassigned last", () => {
    expect(d.workload).toEqual([
      { assigneeId: "B", name: "Ben", activePoints: 8, queuedPoints: 0, activeTasks: 2, queuedTasks: 0, unestimated: 0, overCapacity: false },
      { assigneeId: "A", name: "Ann", activePoints: 0, queuedPoints: 3, activeTasks: 1, queuedTasks: 2, unestimated: 1, overCapacity: false },
      { assigneeId: null, name: "Unassigned", activePoints: 0, queuedPoints: 14, activeTasks: 0, queuedTasks: 2, unestimated: 0, overCapacity: false },
    ]);
  });

  it("overdue tasks, most overdue first", () => {
    expect(d.overdueTasks.map((t) => [t.taskId, t.daysOverdue, t.assigneeName])).toEqual([
      ["T5", 5.5, null],
      ["T2", 4.5, "Ben"],
    ]);
  });

  it("project progress, including the empty project with a null share", () => {
    expect(d.projectProgress.map(({ color: _c, ...p }) => p)).toEqual([
      { projectId: "P1", name: "Alpha app", total: 6, done: 2, open: 4, overdue: 1, blocked: 1, completionShare: 0.3333 },
      { projectId: "P2", name: "Beta data", total: 4, done: 1, open: 3, overdue: 1, blocked: 1, completionShare: 0.25 },
      { projectId: "P3", name: "Empty", total: 0, done: 0, open: 0, overdue: 0, blocked: 0, completionShare: null },
    ]);
  });

  it("blocked-task indicators with blockers and durations", () => {
    expect(d.blocked).toEqual({
      count: 2,
      share: 0.2857,
      points: 10,
      tasks: [
        { taskId: "T5", title: "epsilon", blockedDays: 3, blockers: [{ taskId: "T7", title: "eta" }] },
        { taskId: "T8", title: "theta", blockedDays: 1.5, blockers: [{ taskId: "T9", title: "iota" }] },
      ],
    });
  });

  it("risk panel: distribution, low-confidence count and ranked items with intervals", () => {
    expect(d.risk.distribution).toEqual({ low: 2, medium: 4, high: 1 });
    expect(d.risk.lowConfidence).toBe(3);
    expect(d.risk.items.map((i) => [i.taskId, i.score, i.band, i.interval.low, i.interval.high, i.confidence])).toEqual([
      ["T5", 69.5, "high", 69.5, 69.5, "high"],
      ["T2", 65, "medium", 65, 65, "high"],
      ["T7", 65, "medium", 65, 65, "high"],
      ["T9", 49.4, "medium", 40, 58.8, "medium"],
      ["T8", 40.4, "medium", 11, 69.8, "low"],
      ["T11", 32.5, "low", 12.5, 52.5, "low"],
      ["T3", 29.4, "low", 0, 58.8, "low"],
    ]);
    expect(d.risk.items[0].topFactors).toEqual([
      { label: "Schedule pressure", contribution: 40 },
      { label: "Assignee workload", contribution: 12.5 },
    ]);
  });

  it("data-quality counts drive the uncertainty notice", () => {
    expect(d.dataQuality).toEqual({ unestimatedOpen: 1, undatedOpen: 3 });
  });
});

describe("filters change the visual data", () => {
  it("project P2 narrows every section; a task's risk score is unchanged by filtering", () => {
    const all = build();
    const p2 = build({ projectId: "P2" });
    expect(p2.projectProgress.map((p) => p.projectId)).toEqual(["P2"]);
    expect(p2.summary.openTasks).toBe(3);
    expect(p2.overdueTasks.map((t) => t.taskId)).toEqual(["T5"]);
    expect(p2.risk.distribution).toEqual({ low: 1, medium: 1, high: 1 });
    expect(p2.workload.map((w) => [w.name, w.activePoints, w.queuedPoints, w.unestimated])).toEqual([
      ["Ann", 0, 1, 1],
      ["Unassigned", 0, 8, 0],
    ]);
    const score = (d: typeof all, id: string) => d.risk.items.find((i) => i.taskId === id)?.score;
    expect(score(p2, "T5")).toBe(score(all, "T5"));
  });

  it("assignee 'none' keeps only unassigned tasks", () => {
    const d = build({ assigneeId: "none" });
    expect(d.workload.map((w) => w.name)).toEqual(["Unassigned"]);
    expect(d.risk.items.map((i) => i.taskId)).toEqual(["T5", "T11"]);
  });

  it("an empty project gives empty series rather than errors", () => {
    const d = build({ projectId: "P3" });
    expect(d.summary).toMatchObject({ openTasks: 0, completed: 0, completionRate: null, cycleP50: null, blockedShare: null, highRisk: 0 });
    expect(d.workload).toEqual([]);
    expect(d.overdueTasks).toEqual([]);
    expect(d.risk.items).toEqual([]);
    expect(d.cycleTrend).toEqual([{ weekStart: "2026-03-09", label: "Mar 9", count: 0, p50: null, p85: null }]);
  });
});

describe("labels", () => {
  it("are locale-independent", () => {
    expect(weekLabel("2026-03-09")).toBe("Mar 9");
    expect(weekLabel("2026-12-28")).toBe("Dec 28");
  });
});
