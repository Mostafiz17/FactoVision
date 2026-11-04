import type { Priority, TaskStatus } from "@/lib/domain/types";
import type { AnalyticsEdge, AnalyticsEvent, AnalyticsSource, AnalyticsTask } from "../types";

/**
 * Hand-calculated fixture (UTC). Every expected value in report.test.ts is
 * derived manually from these timestamps; none is produced by running the code.
 *
 * Symbolic ids: tasks T1…T11, projects P1…P3 (P3 is empty), users A and B.
 * Analysis instant AS_OF = 2026-03-15T12:00Z; default window = 7 days.
 */

export const at = (iso: string): Date => new Date(iso);
export const AS_OF = at("2026-03-15T12:00:00Z");

const eventsSpec: [string, string, string, string | null, string | null][] = [
  // [taskId, type, instant, fromValue, toValue]
  ["T1", "created", "2026-03-06T09:00:00Z", null, "backlog"],
  ["T1", "status_changed", "2026-03-07T10:00:00Z", "backlog", "in_progress"],
  ["T1", "status_changed", "2026-03-08T10:00:00Z", "in_progress", "review"],
  ["T1", "completed", "2026-03-10T10:00:00Z", "review", "done"],

  ["T2", "created", "2026-03-05T08:00:00Z", null, "backlog"],
  ["T2", "status_changed", "2026-03-06T08:00:00Z", "backlog", "in_progress"],
  ["T2", "completed", "2026-03-13T08:00:00Z", "in_progress", "done"],
  ["T2", "reopened", "2026-03-14T09:00:00Z", "done", "todo"],
  ["T2", "status_changed", "2026-03-14T11:00:00Z", "todo", "in_progress"],

  ["T3", "created", "2026-03-09T12:00:00Z", null, "todo"],
  ["T3", "status_changed", "2026-03-10T09:00:00Z", "todo", "in_progress"],

  ["T4", "created", "2026-03-09T13:00:00Z", null, "backlog"],
  ["T4", "status_changed", "2026-03-10T13:00:00Z", "backlog", "todo"],
  ["T4", "status_changed", "2026-03-11T08:00:00Z", "todo", "in_progress"],
  ["T4", "status_changed", "2026-03-12T08:00:00Z", "in_progress", "review"],
  ["T4", "completed", "2026-03-14T16:00:00Z", "review", "done"],

  ["T5", "created", "2026-03-04T10:00:00Z", null, "backlog"],

  ["T6", "created", "2026-03-02T09:00:00Z", null, "backlog"],
  ["T6", "status_changed", "2026-03-06T09:00:00Z", "backlog", "in_progress"],
  ["T6", "completed", "2026-03-08T09:00:00Z", "in_progress", "done"],

  ["T7", "created", "2026-03-06T09:30:00Z", null, "backlog"],
  ["T7", "status_changed", "2026-03-13T12:00:00Z", "backlog", "in_progress"],

  ["T8", "created", "2026-03-12T10:00:00Z", null, "backlog"],

  ["T9", "created", "2026-03-01T08:00:00Z", null, "backlog"],

  ["T10", "created", "2026-03-09T09:00:00Z", null, "todo"],
  ["T10", "deleted", "2026-03-11T08:00:00Z", null, null],

  ["T11", "created", "2026-03-03T10:00:00Z", null, "backlog"],
  ["T11", "deleted", "2026-03-10T10:00:00Z", null, null],
  ["T11", "restored", "2026-03-11T10:00:00Z", null, null],
];

export const FIXTURE_EVENTS: AnalyticsEvent[] = eventsSpec.map(([taskId, type, when, fromValue, toValue], i) => ({
  id: `ev-${String(i + 1).padStart(3, "0")}`,
  taskId,
  type,
  at: at(when),
  fromValue,
  toValue,
}));

interface TaskSpec {
  id: string;
  title: string;
  projectId: string;
  assigneeId: string | null;
  priority: Priority;
  estimatePoints: number | null;
  dueDate: string | null;
  labels: string[];
  status: TaskStatus;
  createdAt: string;
  deletedAt: string | null;
}

const taskSpecs: TaskSpec[] = [
  { id: "T1", title: "alpha", projectId: "P1", assigneeId: "A", priority: "medium", estimatePoints: 3, dueDate: "2026-03-12T00:00:00Z", labels: ["ui"], status: "done", createdAt: "2026-03-06T09:00:00Z", deletedAt: null },
  { id: "T2", title: "beta", projectId: "P1", assigneeId: "B", priority: "high", estimatePoints: 5, dueDate: "2026-03-11T00:00:00Z", labels: ["api", "ui"], status: "in_progress", createdAt: "2026-03-05T08:00:00Z", deletedAt: null },
  { id: "T3", title: "gamma", projectId: "P2", assigneeId: "A", priority: "medium", estimatePoints: null, dueDate: null, labels: [], status: "in_progress", createdAt: "2026-03-09T12:00:00Z", deletedAt: null },
  { id: "T4", title: "delta", projectId: "P1", assigneeId: "A", priority: "medium", estimatePoints: 2, dueDate: "2026-03-14T00:00:00Z", labels: ["ui"], status: "done", createdAt: "2026-03-09T13:00:00Z", deletedAt: null },
  { id: "T5", title: "epsilon", projectId: "P2", assigneeId: null, priority: "urgent", estimatePoints: 8, dueDate: "2026-03-10T00:00:00Z", labels: ["infra"], status: "backlog", createdAt: "2026-03-04T10:00:00Z", deletedAt: null },
  { id: "T6", title: "zeta", projectId: "P2", assigneeId: "B", priority: "medium", estimatePoints: 1, dueDate: null, labels: [], status: "done", createdAt: "2026-03-02T09:00:00Z", deletedAt: null },
  { id: "T7", title: "eta", projectId: "P1", assigneeId: "B", priority: "medium", estimatePoints: 3, dueDate: "2026-03-20T00:00:00Z", labels: [], status: "in_progress", createdAt: "2026-03-06T09:30:00Z", deletedAt: null },
  { id: "T8", title: "theta", projectId: "P1", assigneeId: "A", priority: "medium", estimatePoints: 2, dueDate: null, labels: [], status: "backlog", createdAt: "2026-03-12T10:00:00Z", deletedAt: null },
  { id: "T9", title: "iota", projectId: "P2", assigneeId: "A", priority: "medium", estimatePoints: 1, dueDate: "2026-03-16T00:00:00Z", labels: [], status: "backlog", createdAt: "2026-03-01T08:00:00Z", deletedAt: null },
  { id: "T10", title: "kappa", projectId: "P1", assigneeId: "A", priority: "medium", estimatePoints: 4, dueDate: null, labels: [], status: "todo", createdAt: "2026-03-09T09:00:00Z", deletedAt: "2026-03-11T08:00:00Z" },
  { id: "T11", title: "lambda", projectId: "P1", assigneeId: null, priority: "medium", estimatePoints: 6, dueDate: null, labels: [], status: "backlog", createdAt: "2026-03-03T10:00:00Z", deletedAt: null },
];

const d = (iso: string | null): Date | null => (iso === null ? null : at(iso));

export const FIXTURE_TASKS: AnalyticsTask[] = taskSpecs.map((s) => ({
  id: s.id,
  title: s.title,
  projectId: s.projectId,
  assigneeId: s.assigneeId,
  priority: s.priority,
  estimatePoints: s.estimatePoints,
  dueDate: d(s.dueDate),
  labels: s.labels,
  status: s.status,
  createdAt: at(s.createdAt),
  deletedAt: d(s.deletedAt),
}));

/** T5 is blocked by T7 (unresolved); T8 depends on T6 (done, resolved) and T9 (unresolved). */
export const FIXTURE_EDGES: AnalyticsEdge[] = [
  { taskId: "T5", dependsOnId: "T7" },
  { taskId: "T8", dependsOnId: "T6" },
  { taskId: "T8", dependsOnId: "T9" },
];

export const FIXTURE_SOURCE: AnalyticsSource = {
  tasks: FIXTURE_TASKS,
  events: FIXTURE_EVENTS,
  edges: FIXTURE_EDGES,
};
