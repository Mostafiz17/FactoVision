import type { AnalyticsFilters, AnalyticsTask } from "./types";

/**
 * Filters select the task population using each task's CURRENT project,
 * assignee, priority and labels. Historical attributes are not replayed
 * (see limitations). Each filter is a conjunction; an absent filter matches all.
 */
export function normalizeFilters(filters: AnalyticsFilters = {}): AnalyticsFilters {
  const out: AnalyticsFilters = {};
  if (filters.projectId) out.projectId = filters.projectId;
  if (filters.assigneeId) out.assigneeId = filters.assigneeId;
  if (filters.priority) out.priority = filters.priority;
  const label = filters.label?.trim().toLowerCase();
  if (label) out.label = label;
  return out;
}

export function matchesFilters(task: AnalyticsTask, filters: AnalyticsFilters): boolean {
  if (filters.projectId !== undefined && task.projectId !== filters.projectId) return false;
  if (filters.assigneeId === "none") {
    if (task.assigneeId !== null) return false;
  } else if (filters.assigneeId !== undefined && task.assigneeId !== filters.assigneeId) {
    return false;
  }
  if (filters.priority !== undefined && task.priority !== filters.priority) return false;
  if (filters.label !== undefined && !task.labels.includes(filters.label)) return false;
  return true;
}
