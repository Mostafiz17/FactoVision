import type { Filter } from "mongodb";
import { store } from "@/db/repository";
import type { DbTask } from "@/db/schema";
import type { AnalysisWindow, AnalyticsFilters, AnalyticsSource, DailyCountRow, DailyEventType } from "@/lib/analytics";

export const SOURCE_EVENT_TYPES = ["created", "status_changed", "completed", "reopened", "deleted", "restored"] as const;
const DAILY_EVENT_TYPES: DailyEventType[] = ["created", "completed", "reopened"];
export function taskPopulationPredicates(workspaceId: string, filters: AnalyticsFilters): Filter<DbTask> {
  return { workspaceId,
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.assigneeId ? { assigneeId: filters.assigneeId === "none" ? null : filters.assigneeId } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.label ? { tags: filters.label } : {}),
  };
}
/** MongoDB-native daily aggregation; time zones and half-open/asOf boundaries
 * match the pure replay engine. Cross-tenant task joins are explicitly scoped.
 */
export function dailyCountPipeline(workspaceId: string, win: AnalysisWindow, filters: AnalyticsFilters) {
  return [
    { $match: { workspaceId, type: { $in: DAILY_EVENT_TYPES }, createdAt: { $gte: win.start, $lt: win.endExclusive, $lte: win.asOf } } },
    { $lookup: { from: "tasks", let: { taskId: "$taskId" }, pipeline: [
      { $match: { ...taskPopulationPredicates(workspaceId, filters), $expr: { $eq: ["$id", "$$taskId"] } } },
      { $project: { id: 1 } },
    ], as: "population" } },
    { $match: { "population.0": { $exists: true } } },
    { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: win.timeZone } }, type: "$type" }, count: { $sum: 1 } } },
    { $project: { _id: 0, day: "$_id.day", type: "$_id.type", count: 1 } },
  ];
}
export async function loadAnalyticsSource(workspaceId: string, win: AnalysisWindow, filters: AnalyticsFilters): Promise<AnalyticsSource & { dailyCounts: DailyCountRow[] }> {
  const [taskRows, eventRows, edgeRows, dailyCounts] = await Promise.all([
    store.tasks.find({ workspaceId }),
    store.taskEvents.find({ workspaceId, createdAt: { $lte: win.asOf }, type: { $in: [...SOURCE_EVENT_TYPES] } }),
    store.taskDependencies.find({ workspaceId }),
    store.taskEvents.aggregate<DailyCountRow>(dailyCountPipeline(workspaceId, win, filters)),
  ]);
  return {
    tasks: taskRows.map((t) => ({ id: t.id, title: t.title, projectId: t.projectId, assigneeId: t.assigneeId, priority: t.priority, estimatePoints: t.estimatePoints, dueDate: t.dueDate, labels: t.tags, status: t.status, createdAt: t.createdAt, deletedAt: t.deletedAt })),
    events: eventRows.map((e) => ({ id: e.id, taskId: e.taskId, type: e.type, at: e.createdAt, fromValue: e.fromValue, toValue: e.toValue })),
    edges: edgeRows.map((e) => ({ taskId: e.taskId, dependsOnId: e.dependsOnId, createdAt: e.createdAt })),
    dailyCounts,
  };
}
