import { DAY_MS } from "./dates";
import type { TaskStatus } from "./types";

/**
 * Legal Kanban transitions. A completed task must be reopened to To do before
 * it can re-enter flow; this creates a distinct, auditable rework cycle.
 *
 * backlog → todo → in_progress → review → done
 *   ↘ in_progress          ↘ todo     ↘ in_progress / todo
 * done → todo (reopen)
 */
export const LEGAL_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ["todo", "in_progress"],
  todo: ["backlog", "in_progress"],
  in_progress: ["todo", "review", "done"],
  review: ["todo", "in_progress", "done"],
  done: ["todo"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || LEGAL_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: TaskStatus): readonly TaskStatus[] {
  return LEGAL_TRANSITIONS[from];
}

/** Labels are case-insensitive identifiers; persisted values are trimmed lowercase. */
export function normalizeLabels(values: readonly string[], maxLabels = 8): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const label = value.trim().toLowerCase();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    normalized.push(label);
    if (normalized.length === maxLabels) break;
  }
  return normalized;
}

export interface LifecycleEventInput {
  type: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

export interface FlowDurationSamples {
  /** One lead-time sample per completion: completedAt − createdAt. */
  leadTimeDays: number[];
  /** One cycle-time sample per completion with a recorded flow start. */
  cycleTimeDays: number[];
}

/**
 * Reconstruct lead/cycle durations from immutable task events.
 *
 * A flow start is the first event that puts a task in `in_progress` or `review`;
 * reopen resets that start, so a rework completion has its own cycle sample.
 * Lead time always runs from the original `created` event to each completion.
 * The task projection's timestamps are deliberately not required here.
 */
export function deriveFlowDurations(events: readonly LifecycleEventInput[]): FlowDurationSamples {
  const ordered = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const created = ordered.find((e) => e.type === "created");
  const createdAt = created?.createdAt ?? null;
  let flowStartedAt: Date | null = null;
  if (created?.toValue === "in_progress" || created?.toValue === "review") {
    flowStartedAt = created.createdAt;
  }
  const leadTimeDays: number[] = [];
  const cycleTimeDays: number[] = [];

  for (const event of ordered) {
    if (event.type === "status_changed") {
      if (event.toValue === "in_progress" || event.toValue === "review") {
        if (flowStartedAt === null) flowStartedAt = event.createdAt;
      }
    } else if (event.type === "reopened") {
      flowStartedAt = null;
    } else if (event.type === "completed") {
      if (createdAt) {
        leadTimeDays.push(Math.max(0, (event.createdAt.getTime() - createdAt.getTime()) / DAY_MS));
      }
      if (flowStartedAt) {
        cycleTimeDays.push(Math.max(0, (event.createdAt.getTime() - flowStartedAt.getTime()) / DAY_MS));
      }
      flowStartedAt = null;
    }
  }
  return { leadTimeDays, cycleTimeDays };
}