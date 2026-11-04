import type { TaskStatus } from "@/lib/domain/types";
import { GLOBAL_LIMITATIONS } from "./definitions";
import { matchesFilters, normalizeFilters } from "./filters";
import { nearestRank, ratio, roundTo2, summarizeSamples } from "./stats";
import { buildWindow, daysBetween, inWindow, localDayKey, weekStartKey } from "./time";
import { buildHistories, stateAt, type CompletionSample, type TaskHistory } from "./timeline";
import type {
  AnalyticsReport,
  AnalyticsSource,
  AnalyticsTask,
  AssigneeLoad,
  BlockerSummary,
  DailyEventType,
  DayCounts,
  ReportOptions,
  WeekBucket,
  WorkloadGroup,
} from "./types";

/**
 * Deterministic analytics report. Pure: the same source and options always
 * produce the same report. No clock is read; `asOf` is the only notion of "now".
 *
 * Population  = tasks matching the filters that existed at asOf.
 * Historical  = event-derived metrics (throughput, timing, on-time, weekly),
 *               which include tasks deleted after the event.
 * Snapshot    = metrics at asOf (overdue, workload, blocked, cohort status),
 *               which exclude tasks deleted by asOf.
 */

const ACTIVE = new Set<TaskStatus>(["in_progress", "review"]);
const QUEUED = new Set<TaskStatus>(["backlog", "todo"]);

interface OpenRow {
  task: AnalyticsTask;
  status: TaskStatus;
  due: Date | null;
}

interface DayBucket {
  created: number;
  completed: number;
  reopened: number;
}

function historyOf(histories: Map<string, TaskHistory>, taskId: string): TaskHistory {
  const history = histories.get(taskId);
  if (!history) throw new Error(`analytics invariant violated: no history for task ${taskId}`);
  return history;
}

function groupOf(rows: readonly OpenRow[]): WorkloadGroup {
  const estimates = rows.flatMap((r) => (r.task.estimatePoints === null ? [] : [r.task.estimatePoints]));
  const points = estimates.reduce((sum, v) => sum + v, 0);
  return {
    count: rows.length,
    estimated: estimates.length,
    unestimated: rows.length - estimates.length,
    points: roundTo2(points),
    coverage: ratio(estimates.length, rows.length),
  };
}

export function buildAnalyticsReport(source: AnalyticsSource, options: ReportOptions): AnalyticsReport {
  const filters = normalizeFilters(options.filters);
  const win = buildWindow(options.asOf, options.timeZone, options.days);
  const cutoff = win.asOf;
  const tz = win.timeZone;
  const histories = buildHistories(source.tasks, source.events, cutoff);
  const titleById = new Map(source.tasks.map((t) => [t.id, t.title] as const));

  // Population: filtered tasks that existed at the cutoff.
  const population = source.tasks.filter(
    (t) => matchesFilters(t, filters) && historyOf(histories, t.id).createdAt.getTime() <= cutoff.getTime(),
  );
  const popHistories = population.map((task) => ({ task, history: historyOf(histories, task.id) }));
  const taskById = new Map(population.map((t) => [t.id, t] as const));

  // Completion samples in the window, oldest first (stable for ties by task id).
  const samples: CompletionSample[] = popHistories
    .flatMap(({ history }) => history.completions)
    .filter((c) => inWindow(win, c.completedAt))
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime() || (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));

  const createdInWindow = popHistories.filter(({ history }) => inWindow(win, history.createdAt));

  // Daily counts: pre-aggregated rows when supplied (SQL GROUP BY), otherwise derived from history.
  const dailyMap = new Map<string, DayBucket>(
    win.dayKeys.map((day) => [day, { created: 0, completed: 0, reopened: 0 }] as const),
  );
  const bump = (day: string, type: DailyEventType) => {
    const bucket = dailyMap.get(day);
    if (bucket) bucket[type] += 1;
  };
  if (source.dailyCounts) {
    for (const row of source.dailyCounts) {
      const bucket = dailyMap.get(row.day);
      if (bucket) bucket[row.type] += row.count;
    }
  } else {
    for (const c of samples) bump(localDayKey(c.completedAt, tz), "completed");
    for (const { history } of popHistories) {
      for (const at of history.reopenedAt) if (inWindow(win, at)) bump(localDayKey(at, tz), "reopened");
    }
    for (const { history } of createdInWindow) bump(localDayKey(history.createdAt, tz), "created");
  }
  const daily: DayCounts[] = win.dayKeys.map((day) => {
    const b = dailyMap.get(day) ?? { created: 0, completed: 0, reopened: 0 };
    return { day, created: b.created, completed: b.completed, reopened: b.reopened };
  });
  const sumOf = (key: keyof DayBucket) => daily.reduce((total, d) => total + d[key], 0);
  const created = sumOf("created");
  const completed = sumOf("completed");
  const reopened = sumOf("reopened");

  // Cohort completion rate: created in window, not deleted at cutoff, done at cutoff.
  const cohortStates = createdInWindow.flatMap(({ history }) => {
    const state = stateAt(history, cutoff);
    return state && !state.deleted ? [state] : [];
  });
  const cohortDone = cohortStates.filter((s) => s.status === "done").length;

  // Timing.
  const cycleSamples = samples.flatMap((c) =>
    c.cycleDays === null
      ? []
      : [
          {
            taskId: c.taskId,
            completedAt: c.completedAt.toISOString(),
            days: roundTo2(c.cycleDays),
            points: taskById.get(c.taskId)?.estimatePoints ?? null,
          },
        ],
  );
  const cycle = summarizeSamples(samples.flatMap((c) => (c.cycleDays === null ? [] : [c.cycleDays])));
  const lead = summarizeSamples(samples.map((c) => c.leadDays));

  // On-time: completions whose task has a due date.
  const dated = samples.flatMap((c) => (c.dueDate === null ? [] : [{ completedAt: c.completedAt, due: c.dueDate }]));
  const onTimeCount = dated.filter((d) => d.completedAt.getTime() <= d.due.getTime()).length;

  // Snapshot at cutoff: open tasks.
  const open: OpenRow[] = popHistories.flatMap(({ task, history }) => {
    const state = stateAt(history, cutoff);
    if (!state || state.deleted || state.status === "done") return [];
    return [{ task, status: state.status, due: task.dueDate }];
  });
  const withDue = open.flatMap((r) => (r.due === null ? [] : [{ ...r, due: r.due }]));
  const overdueRows = withDue.filter((r) => r.due.getTime() < cutoff.getTime());

  // Workload.
  const activeRows = open.filter((r) => ACTIVE.has(r.status));
  const queuedRows = open.filter((r) => QUEUED.has(r.status));
  const perAssignee = new Map<string | null, { count: number; points: number }>();
  for (const r of activeRows) {
    const current = perAssignee.get(r.task.assigneeId) ?? { count: 0, points: 0 };
    current.count += 1;
    current.points += r.task.estimatePoints ?? 0;
    perAssignee.set(r.task.assigneeId, current);
  }
  const activeByAssignee: AssigneeLoad[] = [...perAssignee.entries()]
    .map(([assigneeId, v]) => ({ assigneeId, count: v.count, points: roundTo2(v.points) }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        (a.assigneeId ?? "\uffff").localeCompare(b.assigneeId ?? "\uffff"),
    );

  // Blocked analysis: unresolved blockers of open population tasks.
  const openIds = new Set(open.map((r) => r.task.id));
  const blockerUnresolved = (blockerId: string): boolean => {
    const history = histories.get(blockerId);
    if (!history) return false;
    const state = stateAt(history, cutoff);
    return state !== null && !state.deleted && state.status !== "done";
  };
  const blockersOf = new Map<string, string[]>();
  for (const edge of source.edges) {
    if (!openIds.has(edge.taskId) || !blockerUnresolved(edge.dependsOnId)) continue;
    const list = blockersOf.get(edge.taskId);
    if (list) list.push(edge.dependsOnId);
    else blockersOf.set(edge.taskId, [edge.dependsOnId]);
  }
  const heldBack = new Map<string, number>();
  for (const list of blockersOf.values()) {
    for (const blockerId of list) heldBack.set(blockerId, (heldBack.get(blockerId) ?? 0) + 1);
  }
  const topBlockers: BlockerSummary[] = [...heldBack.entries()]
    .map(([taskId, blocks]) => ({ taskId, title: titleById.get(taskId) ?? "", blocks }))
    .sort((a, b) => b.blocks - a.blocks || a.title.localeCompare(b.title) || (a.taskId < b.taskId ? -1 : 1))
    .slice(0, 5);
  const blockedRows = open.filter((r) => blockersOf.has(r.task.id));
  const blockedPoints = blockedRows.reduce((sum, r) => sum + (r.task.estimatePoints ?? 0), 0);

  // Weekly trends: Monday-start local weeks covering the window.
  const weekKeys = [...new Set(win.dayKeys.map(weekStartKey))];
  const weekly: WeekBucket[] = weekKeys.map((weekStart) => {
    const days = win.dayKeys.filter((d) => weekStartKey(d) === weekStart);
    let weekCreated = 0;
    let weekCompleted = 0;
    let weekReopened = 0;
    for (const d of days) {
      const b = dailyMap.get(d);
      if (!b) continue;
      weekCreated += b.created;
      weekCompleted += b.completed;
      weekReopened += b.reopened;
    }
    const weekSamples = samples.filter((c) => weekStartKey(localDayKey(c.completedAt, tz)) === weekStart);
    const weekDated = weekSamples.flatMap((c) => (c.dueDate === null ? [] : [{ completedAt: c.completedAt, due: c.dueDate }]));
    const weekOnTime = weekDated.filter((d) => d.completedAt.getTime() <= d.due.getTime()).length;
    const cycles = weekSamples.flatMap((c) => (c.cycleDays === null ? [] : [c.cycleDays])).sort((a, b) => a - b);
    return {
      weekStart,
      daysInWindow: days.length,
      created: weekCreated,
      completed: weekCompleted,
      reopened: weekReopened,
      net: weekCompleted - weekReopened,
      onTimeEligible: weekDated.length,
      onTime: weekOnTime,
      onTimeRate: ratio(weekOnTime, weekDated.length),
      cycleCount: cycles.length,
      cycleMedianDays: cycles.length === 0 ? null : roundTo2(nearestRank(cycles, 50)),
    };
  });

  return {
    window: {
      timeZone: tz,
      days: win.days,
      asOf: cutoff.toISOString(),
      startDay: win.startDay,
      endDay: win.endDay,
      start: win.start.toISOString(),
      endExclusive: win.endExclusive.toISOString(),
    },
    filters,
    population: { tasks: population.length, open: open.length },
    throughput: { created, completed, reopened, net: completed - reopened },
    completionRate: {
      eligible: cohortStates.length,
      completed: cohortDone,
      rate: ratio(cohortDone, cohortStates.length),
    },
    timing: { cycle, lead, cycleSamples },
    completedTaskIds: samples.map((c) => c.taskId),
    onTime: {
      eligible: dated.length,
      onTime: onTimeCount,
      late: dated.length - onTimeCount,
      rate: ratio(onTimeCount, dated.length),
    },
    overdue: {
      count: overdueRows.length,
      openWithDue: withDue.length,
      share: ratio(overdueRows.length, withDue.length),
      ageDays: summarizeSamples(overdueRows.map((r) => daysBetween(r.due, cutoff))),
    },
    workload: {
      active: groupOf(activeRows),
      queued: groupOf(queuedRows),
      activeByAssignee,
    },
    blocked: {
      openTasks: open.length,
      blocked: blockedRows.length,
      share: ratio(blockedRows.length, open.length),
      blockedEstimatedPoints: roundTo2(blockedPoints),
      topBlockers,
    },
    daily,
    weekly,
    limitations: GLOBAL_LIMITATIONS,
  };
}
