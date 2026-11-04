import { STATUSES, type TaskStatus } from "@/lib/domain/types";
import { daysBetween } from "./time";
import type { AnalyticsEvent, AnalyticsTask } from "./types";

/**
 * Event replay. Rebuilds, for every task, its status and deletion timeline and
 * one completion sample per `completed` event, using only events at or before
 * the replay cutoff.
 *
 * Definitions (see ANALYTICS.md):
 * - Lead time  = completedAt − createdAt, anchored to the original creation.
 * - Flow start = first entry into in_progress or review since creation or the
 *   last reopen. A task created directly in review or done starts at creation.
 * - Cycle time = completedAt − flowStart, or null when no flow start exists.
 * - A reopen (done → todo) clears the flow start, so rework gets its own cycle.
 */

const ACTIVE = new Set<TaskStatus>(["in_progress", "review"]);
const STATUS_SET = new Set<string>(STATUSES);
const CREATED_RANK = 0;

export interface StateAt {
  at: Date;
  status: TaskStatus;
  deleted: boolean;
}

export interface CompletionSample {
  taskId: string;
  completedAt: Date;
  leadDays: number;
  cycleDays: number | null;
  dueDate: Date | null;
}

export interface TaskHistory {
  taskId: string;
  createdAt: Date;
  /** Chronological; the first entry is the creation state. */
  states: StateAt[];
  completions: CompletionSample[];
  reopenedAt: Date[];
}

function isStatus(value: string | null): value is TaskStatus {
  return value !== null && STATUS_SET.has(value);
}

/** Same-millisecond ordering: created first, then by id so replay is deterministic. */
function compareEvents(a: AnalyticsEvent, b: AnalyticsEvent): number {
  const byTime = a.at.getTime() - b.at.getTime();
  if (byTime !== 0) return byTime;
  const rank = (e: AnalyticsEvent) => (e.type === "created" ? CREATED_RANK : 1);
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function initialStatus(task: AnalyticsTask, events: readonly AnalyticsEvent[]): TaskStatus {
  const created = events.find((e) => e.type === "created");
  if (created && isStatus(created.toValue)) return created.toValue;
  // Without a created event, the earliest recorded transition's source is the best evidence.
  const firstTransition = events.find((e) => e.type === "status_changed" || e.type === "completed" || e.type === "reopened");
  if (firstTransition && isStatus(firstTransition.fromValue)) return firstTransition.fromValue;
  return task.status;
}

/**
 * Replays events up to `cutoff` for each task. Tasks created after the cutoff
 * still get a history (so callers can filter them), but contain no later events.
 */
export function buildHistories(
  tasks: readonly AnalyticsTask[],
  events: readonly AnalyticsEvent[],
  cutoff: Date,
): Map<string, TaskHistory> {
  const byTask = new Map<string, AnalyticsEvent[]>();
  for (const e of events) {
    if (e.at.getTime() > cutoff.getTime()) continue;
    const list = byTask.get(e.taskId);
    if (list) list.push(e);
    else byTask.set(e.taskId, [e]);
  }

  const histories = new Map<string, TaskHistory>();
  for (const task of tasks) {
    const ordered = (byTask.get(task.id) ?? []).sort(compareEvents);
    const created = ordered.find((e) => e.type === "created");
    const createdAt = created ? created.at : task.createdAt;
    let status = initialStatus(task, ordered);
    let deleted = false;
    let flowStart: Date | null = ACTIVE.has(status) || status === "done" ? createdAt : null;
    const states: StateAt[] = [{ at: createdAt, status, deleted }];
    const completions: CompletionSample[] = [];
    const reopenedAt: Date[] = [];

    for (const e of ordered) {
      if (e.type === "created") continue;
      if (e.type === "deleted") {
        deleted = true;
        states.push({ at: e.at, status, deleted });
        continue;
      }
      if (e.type === "restored") {
        deleted = false;
        states.push({ at: e.at, status, deleted });
        continue;
      }
      if (e.type !== "status_changed" && e.type !== "completed" && e.type !== "reopened") continue;

      const next: TaskStatus = isStatus(e.toValue) ? e.toValue : status;
      const isCompletion = e.type === "completed" || (e.type === "status_changed" && next === "done");

      if (e.type === "reopened") {
        reopenedAt.push(e.at);
        flowStart = null;
      } else if (isCompletion) {
        completions.push({
          taskId: task.id,
          completedAt: e.at,
          leadDays: daysBetween(createdAt, e.at),
          cycleDays: flowStart ? daysBetween(flowStart, e.at) : null,
          dueDate: task.dueDate,
        });
        flowStart = null;
      } else if (ACTIVE.has(next) && flowStart === null) {
        flowStart = e.at;
      }

      status = next;
      states.push({ at: e.at, status, deleted });
    }

    histories.set(task.id, { taskId: task.id, createdAt, states, completions, reopenedAt });
  }
  return histories;
}

/** Status and deletion flag at `instant`, or null if the task did not exist yet. */
export function stateAt(history: TaskHistory, instant: Date): StateAt | null {
  if (instant.getTime() < history.createdAt.getTime()) return null;
  let found: StateAt | null = null;
  for (const state of history.states) {
    if (state.at.getTime() <= instant.getTime()) found = state;
    else break;
  }
  return found;
}
