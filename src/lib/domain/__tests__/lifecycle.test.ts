import { describe, expect, it } from "vitest";
import { DAY_MS } from "../dates";
import { canTransition, deriveFlowDurations, LEGAL_TRANSITIONS, nextStatuses, normalizeLabels } from "../lifecycle";
import { STATUSES } from "../types";

const at = (day: number) => new Date(Date.UTC(2026, 0, 1 + day));

describe("legal task status transitions", () => {
  it("declares transitions for every status", () => {
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual([...STATUSES].sort());
  });
  it("allows the intended flow, expedited backlog start, feedback loops and reopen", () => {
    const allowed: [Parameters<typeof canTransition>[0], Parameters<typeof canTransition>[1]][] = [
      ["backlog", "todo"],
      ["backlog", "in_progress"],
      ["todo", "backlog"],
      ["todo", "in_progress"],
      ["in_progress", "todo"],
      ["in_progress", "review"],
      ["in_progress", "done"],
      ["review", "todo"],
      ["review", "in_progress"],
      ["review", "done"],
      ["done", "todo"],
    ];
    for (const [from, to] of allowed) expect(canTransition(from, to)).toBe(true);
  });
  it("rejects skipping acceptance/reopen stages", () => {
    expect(canTransition("backlog", "review")).toBe(false);
    expect(canTransition("backlog", "done")).toBe(false);
    expect(canTransition("todo", "done")).toBe(false);
    expect(canTransition("review", "backlog")).toBe(false);
    expect(canTransition("done", "in_progress")).toBe(false);
    expect(canTransition("done", "review")).toBe(false);
  });
  it("treats an unchanged status as an idempotent no-op", () => {
    for (const status of STATUSES) expect(canTransition(status, status)).toBe(true);
  });
  it("exposes the next legal statuses for the board/detail UI", () => {
    expect(nextStatuses("done")).toEqual(["todo"]);
    expect(nextStatuses("backlog")).toContain("in_progress");
  });
});

describe("label normalization", () => {
  it("trims, lowercases and deduplicates labels case-insensitively", () => {
    expect(normalizeLabels([" UI ", "ui", "API", " api ", "Bug"])).toEqual(["ui", "api", "bug"]);
  });
  it("drops blank labels and caps the set", () => {
    expect(normalizeLabels(["", "  ", "a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});

describe("event-sourced flow durations", () => {
  it("derives cycle and lead time from immutable event timestamps, not projections", () => {
    const events = [
      { type: "created", fromValue: null, toValue: "todo", createdAt: at(0) },
      { type: "status_changed", fromValue: "todo", toValue: "in_progress", createdAt: at(2) },
      { type: "status_changed", fromValue: "in_progress", toValue: "review", createdAt: at(3) },
      { type: "completed", fromValue: "review", toValue: "done", createdAt: at(5) },
    ];
    const samples = deriveFlowDurations(events);
    expect(samples.leadTimeDays).toEqual([5]);
    expect(samples.cycleTimeDays).toEqual([3]);
  });
  it("reopen creates a separate cycle sample while lead stays anchored to creation", () => {
    const events = [
      { type: "created", fromValue: null, toValue: "todo", createdAt: at(0) },
      { type: "status_changed", fromValue: "todo", toValue: "in_progress", createdAt: at(1) },
      { type: "completed", fromValue: "in_progress", toValue: "done", createdAt: at(3) },
      { type: "reopened", fromValue: "done", toValue: "todo", createdAt: at(5) },
      { type: "status_changed", fromValue: "todo", toValue: "in_progress", createdAt: at(6) },
      { type: "completed", fromValue: "in_progress", toValue: "done", createdAt: at(8) },
    ];
    const samples = deriveFlowDurations(events);
    expect(samples.leadTimeDays).toEqual([3, 8]);
    expect(samples.cycleTimeDays).toEqual([2, 2]);
  });
  it("does not invent cycle time when a completion has no flow-start event", () => {
    const events = [
      { type: "created", fromValue: null, toValue: "todo", createdAt: at(0) },
      { type: "completed", fromValue: "todo", toValue: "done", createdAt: at(2) },
    ];
    const samples = deriveFlowDurations(events);
    expect(samples.leadTimeDays).toEqual([2]);
    expect(samples.cycleTimeDays).toEqual([]);
  });
  it("handles empty history", () => {
    expect(deriveFlowDurations([])).toEqual({ leadTimeDays: [], cycleTimeDays: [] });
    expect(at(0).getTime() + 2 * DAY_MS).toBe(at(2).getTime());
  });
});