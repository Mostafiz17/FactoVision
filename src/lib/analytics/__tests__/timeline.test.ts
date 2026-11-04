import { describe, expect, it } from "vitest";
import { buildHistories, stateAt } from "../timeline";
import type { AnalyticsEvent, AnalyticsTask } from "../types";

const at = (iso: string) => new Date(iso);
const task = (id: string, createdAt: string, extra: Partial<AnalyticsTask> = {}): AnalyticsTask => ({
  id,
  title: id,
  projectId: "P1",
  assigneeId: null,
  priority: "medium",
  estimatePoints: null,
  dueDate: null,
  labels: [],
  status: "backlog",
  createdAt: at(createdAt),
  deletedAt: null,
  ...extra,
});
const ev = (id: string, taskId: string, type: string, when: string, from: string | null, to: string | null): AnalyticsEvent => ({
  id,
  taskId,
  type,
  at: at(when),
  fromValue: from,
  toValue: to,
});

describe("completion samples: lead and cycle", () => {
  it("reopen starts a new cycle while lead stays anchored to creation", () => {
    const t = task("R", "2026-03-01T00:00:00Z");
    const events = [
      ev("1", "R", "created", "2026-03-01T00:00:00Z", null, "backlog"),
      ev("2", "R", "status_changed", "2026-03-02T00:00:00Z", "backlog", "in_progress"),
      ev("3", "R", "completed", "2026-03-03T00:00:00Z", "in_progress", "done"),
      ev("4", "R", "reopened", "2026-03-04T00:00:00Z", "done", "todo"),
      ev("5", "R", "status_changed", "2026-03-05T00:00:00Z", "todo", "in_progress"),
      ev("6", "R", "completed", "2026-03-07T00:00:00Z", "in_progress", "done"),
    ];
    const h = buildHistories([t], events, at("2026-03-15T00:00:00Z")).get("R")!;
    expect(h.completions.map((c) => [c.leadDays, c.cycleDays])).toEqual([
      [2, 1],
      [6, 2],
    ]);
    expect(h.reopenedAt).toEqual([at("2026-03-04T00:00:00Z")]);
  });

  it("a task created directly in done has zero cycle and lead", () => {
    const t = task("D", "2026-03-01T00:00:00Z", { status: "done" });
    const events = [
      ev("1", "D", "created", "2026-03-01T00:00:00Z", null, "done"),
      ev("2", "D", "completed", "2026-03-01T00:00:00Z", null, "done"),
    ];
    const c = buildHistories([t], events, at("2026-03-15T00:00:00Z")).get("D")!.completions;
    expect(c).toHaveLength(1);
    expect(c[0].cycleDays).toBe(0);
    expect(c[0].leadDays).toBe(0);
  });

  it("same-millisecond ties: created is replayed before completed regardless of input order", () => {
    const t = task("S", "2026-03-01T00:00:00Z", { status: "done" });
    const shuffled = [
      ev("b", "S", "completed", "2026-03-01T00:00:00Z", null, "done"),
      ev("a", "S", "created", "2026-03-01T00:00:00Z", null, "done"),
    ];
    const c = buildHistories([t], shuffled, at("2026-03-15T00:00:00Z")).get("S")!.completions;
    expect(c).toHaveLength(1);
    expect(c[0].cycleDays).toBe(0);
  });

  it("a completion without any flow start has a lead time but no cycle time", () => {
    const t = task("N", "2026-03-01T00:00:00Z");
    const events = [
      ev("1", "N", "created", "2026-03-01T00:00:00Z", null, "backlog"),
      ev("2", "N", "completed", "2026-03-03T00:00:00Z", "backlog", "done"),
    ];
    const c = buildHistories([t], events, at("2026-03-15T00:00:00Z")).get("N")!.completions;
    expect(c[0].leadDays).toBe(2);
    expect(c[0].cycleDays).toBeNull();
  });

  it("moving back to todo does not reset the flow start (documented choice)", () => {
    const t = task("B", "2026-03-01T00:00:00Z");
    const events = [
      ev("1", "B", "created", "2026-03-01T00:00:00Z", null, "backlog"),
      ev("2", "B", "status_changed", "2026-03-02T00:00:00Z", "backlog", "in_progress"),
      ev("3", "B", "status_changed", "2026-03-03T00:00:00Z", "in_progress", "todo"),
      ev("4", "B", "status_changed", "2026-03-04T00:00:00Z", "todo", "in_progress"),
      ev("5", "B", "completed", "2026-03-06T00:00:00Z", "in_progress", "done"),
    ];
    const c = buildHistories([t], events, at("2026-03-15T00:00:00Z")).get("B")!.completions;
    expect(c[0].cycleDays).toBe(4); // from the first start on 03-02
  });

  it("completions of tasks deleted afterwards remain in history", () => {
    const t = task("X", "2026-03-10T09:00:00Z", { deletedAt: at("2026-03-12T10:00:00Z") });
    const events = [
      ev("1", "X", "created", "2026-03-10T09:00:00Z", null, "backlog"),
      ev("2", "X", "status_changed", "2026-03-10T10:00:00Z", "backlog", "in_progress"),
      ev("3", "X", "completed", "2026-03-11T10:00:00Z", "in_progress", "done"),
      ev("4", "X", "deleted", "2026-03-12T10:00:00Z", null, null),
    ];
    const h = buildHistories([t], events, at("2026-03-15T00:00:00Z")).get("X")!;
    expect(h.completions).toHaveLength(1);
    expect(stateAt(h, at("2026-03-13T00:00:00Z"))?.deleted).toBe(true);
  });
});

describe("state replay and the as-of cutoff", () => {
  it("events after the cutoff are ignored entirely", () => {
    const t = task("C", "2026-03-01T00:00:00Z");
    const events = [
      ev("1", "C", "created", "2026-03-01T00:00:00Z", null, "backlog"),
      ev("2", "C", "completed", "2026-03-20T00:00:00Z", "backlog", "done"),
    ];
    const h = buildHistories([t], events, at("2026-03-15T00:00:00Z")).get("C")!;
    expect(h.completions).toHaveLength(0);
    expect(stateAt(h, at("2026-03-15T00:00:00Z"))?.status).toBe("backlog");
  });

  it("stateAt returns null before creation and tracks delete/restore", () => {
    const t = task("T", "2026-03-01T00:00:00Z");
    const events = [
      ev("1", "T", "created", "2026-03-01T00:00:00Z", null, "todo"),
      ev("2", "T", "deleted", "2026-03-05T00:00:00Z", null, null),
      ev("3", "T", "restored", "2026-03-06T00:00:00Z", null, null),
    ];
    const h = buildHistories([t], events, at("2026-03-15T00:00:00Z")).get("T")!;
    expect(stateAt(h, at("2026-02-28T00:00:00Z"))).toBeNull();
    expect(stateAt(h, at("2026-03-04T00:00:00Z"))?.deleted).toBe(false);
    expect(stateAt(h, at("2026-03-05T00:00:00Z"))?.deleted).toBe(true);
    expect(stateAt(h, at("2026-03-06T00:00:00Z"))?.deleted).toBe(false);
  });

  it("falls back to the projection status only when no status history exists", () => {
    const t = task("P", "2026-03-01T00:00:00Z", { status: "review" });
    const h = buildHistories([t], [], at("2026-03-15T00:00:00Z")).get("P")!;
    expect(stateAt(h, at("2026-03-02T00:00:00Z"))?.status).toBe("review");
  });
});
