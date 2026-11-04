import type { Priority, TaskStatus } from "@/lib/domain/types";
import { buildAnalyticsReport } from "@/lib/analytics/report";
import { matchesFilters, normalizeFilters } from "@/lib/analytics/filters";
import { nearestRank, ratio, roundTo2 } from "@/lib/analytics/stats";
import { localDayKey, parseDayKey, weekStartKey } from "@/lib/analytics/time";
import { buildHistories, stateAt } from "@/lib/analytics/timeline";
import type { AnalyticsFilters, AnalyticsReport, AnalyticsSource, ReportOptions } from "@/lib/analytics/types";
import type { RiskBand, RiskConfidence, RiskResult } from "@/lib/risk/model";

/**
 * Dashboard view model (pure). Every chart series is derived here from the
 * Phase 5 analytics report, the replayed event history and the risk results, so
 * tests can pin exact chart data to known fixtures without rendering.
 */

export interface DashboardProject {
  id: string;
  name: string;
  color: string;
}
export interface DashboardMember {
  id: string;
  name: string;
}
export interface RiskMeta {
  modelVersion: string;
  revision: number;
  fingerprint: string;
  capacityPoints: number;
}

export interface DashboardRiskItem {
  taskId: string;
  title: string;
  projectId: string;
  assigneeName: string | null;
  dueDate: string | null;
  score: number;
  band: RiskBand;
  interval: { low: number; high: number };
  bandRange: { from: RiskBand; to: RiskBand };
  confidence: RiskConfidence;
  topFactors: { label: string; contribution: number }[];
  missingInputs: string[];
}

export interface DashboardDTO {
  window: AnalyticsReport["window"];
  filters: AnalyticsFilters;
  summary: {
    openTasks: number;
    completed: number;
    reopened: number;
    completionRate: number | null;
    completionEligible: number;
    onTimeRate: number | null;
    onTimeEligible: number;
    overdue: number;
    blocked: number;
    blockedShare: number | null;
    cycleP50: number | null;
    cycleP85: number | null;
    leadP50: number | null;
    activePoints: number;
    activeCoverage: number | null;
    highRisk: number;
  };
  completionTrend: { weekStart: string; label: string; daysInWindow: number; created: number; completed: number; reopened: number; net: number }[];
  cycleTrend: { weekStart: string; label: string; count: number; p50: number | null; p85: number | null }[];
  workload: {
    assigneeId: string | null;
    name: string;
    activePoints: number;
    queuedPoints: number;
    activeTasks: number;
    queuedTasks: number;
    unestimated: number;
    overCapacity: boolean;
  }[];
  overdueTasks: { taskId: string; title: string; projectId: string; assigneeName: string | null; priority: Priority; dueDate: string; daysOverdue: number }[];
  projectProgress: { projectId: string; name: string; color: string; total: number; done: number; open: number; overdue: number; blocked: number; completionShare: number | null }[];
  blocked: {
    count: number;
    share: number | null;
    points: number;
    tasks: { taskId: string; title: string; blockedDays: number | null; blockers: { taskId: string; title: string }[] }[];
  };
  risk: {
    modelVersion: string;
    revision: number;
    fingerprint: string;
    capacityPoints: number;
    distribution: Record<RiskBand, number>;
    lowConfidence: number;
    items: DashboardRiskItem[];
  };
  dataQuality: { unestimatedOpen: number; undatedOpen: number };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ACTIVE = new Set<TaskStatus>(["in_progress", "review"]);
const DAY_MS = 86_400_000;

/** Locale-independent label so chart data is deterministic: "Mar 9". */
export function weekLabel(weekStart: string): string {
  const { month, day } = parseDayKey(weekStart);
  return `${MONTHS[month - 1]} ${day}`;
}

export function buildDashboard(
  source: AnalyticsSource,
  options: ReportOptions,
  risk: { results: Map<string, RiskResult>; meta: RiskMeta },
  projects: readonly DashboardProject[],
  members: readonly DashboardMember[],
  riskLimit = 10,
): DashboardDTO {
  const filters = normalizeFilters(options.filters);
  const report = buildAnalyticsReport(source, { ...options, filters });
  const asOf = options.asOf;
  const histories = buildHistories(source.tasks, source.events, asOf);
  const nameOf = new Map(members.map((m) => [m.id, m.name] as const));
  const titleOf = new Map(source.tasks.map((t) => [t.id, t.title] as const));

  // Population snapshot at asOf (same rules as the report).
  const rows = source.tasks.flatMap((task) => {
    if (!matchesFilters(task, filters)) return [];
    const h = histories.get(task.id);
    const s = h ? stateAt(h, asOf) : null;
    if (!s || s.deleted) return [];
    return [{ task, status: s.status }];
  });
  const open = rows.filter((r) => r.status !== "done");
  const isOpenGlobal = (id: string) => {
    const h = histories.get(id);
    const s = h ? stateAt(h, asOf) : null;
    return !!s && !s.deleted && s.status !== "done";
  };

  // Blocked tasks with blockers and duration (edges created after asOf ignored).
  const blockersOf = new Map<string, { ids: string[]; since: Date | null; unknown: boolean }>();
  const openIds = new Set(open.map((r) => r.task.id));
  for (const e of source.edges) {
    if (!openIds.has(e.taskId) || !isOpenGlobal(e.dependsOnId)) continue;
    if (e.createdAt && e.createdAt.getTime() > asOf.getTime()) continue;
    const entry = blockersOf.get(e.taskId) ?? { ids: [], since: null, unknown: false };
    entry.ids.push(e.dependsOnId);
    if (!e.createdAt) entry.unknown = true;
    else if (!entry.since || e.createdAt.getTime() < entry.since.getTime()) entry.since = e.createdAt;
    blockersOf.set(e.taskId, entry);
  }
  const blockedTasks = open
    .filter((r) => blockersOf.has(r.task.id))
    .map((r) => {
      const b = blockersOf.get(r.task.id)!;
      const days = b.unknown || !b.since ? null : roundTo2((asOf.getTime() - b.since.getTime()) / DAY_MS);
      return {
        taskId: r.task.id,
        title: r.task.title,
        blockedDays: days,
        blockers: [...b.ids]
          .sort((x, y) => (titleOf.get(x) ?? "").localeCompare(titleOf.get(y) ?? ""))
          .map((id) => ({ taskId: id, title: titleOf.get(id) ?? "" })),
      };
    })
    .sort((x, y) => (y.blockedDays ?? -1) - (x.blockedDays ?? -1) || x.title.localeCompare(y.title));

  // Weekly series.
  const completionTrend = report.weekly.map((w) => ({
    weekStart: w.weekStart,
    label: weekLabel(w.weekStart),
    daysInWindow: w.daysInWindow,
    created: w.created,
    completed: w.completed,
    reopened: w.reopened,
    net: w.net,
  }));
  const cycleTrend = report.weekly.map((w) => {
    const days = report.timing.cycleSamples
      .filter((s) => weekStartKey(localDayKey(new Date(s.completedAt), report.window.timeZone)) === w.weekStart)
      .map((s) => s.days)
      .sort((a, b) => a - b);
    return {
      weekStart: w.weekStart,
      label: weekLabel(w.weekStart),
      count: days.length,
      p50: days.length ? roundTo2(nearestRank(days, 50)) : null,
      p85: days.length ? roundTo2(nearestRank(days, 85)) : null,
    };
  });

  // Workload distribution per assignee (unassigned last).
  const loads = new Map<string | null, { activePoints: number; queuedPoints: number; activeTasks: number; queuedTasks: number; unestimated: number }>();
  for (const r of open) {
    const key = r.task.assigneeId;
    const l = loads.get(key) ?? { activePoints: 0, queuedPoints: 0, activeTasks: 0, queuedTasks: 0, unestimated: 0 };
    const pts = r.task.estimatePoints ?? 0;
    if (r.task.estimatePoints === null) l.unestimated += 1;
    if (ACTIVE.has(r.status)) {
      l.activePoints += pts;
      l.activeTasks += 1;
    } else {
      l.queuedPoints += pts;
      l.queuedTasks += 1;
    }
    loads.set(key, l);
  }
  const workload = [...loads.entries()]
    .map(([assigneeId, l]) => ({
      assigneeId,
      name: assigneeId === null ? "Unassigned" : (nameOf.get(assigneeId) ?? "Former member"),
      activePoints: roundTo2(l.activePoints),
      queuedPoints: roundTo2(l.queuedPoints),
      activeTasks: l.activeTasks,
      queuedTasks: l.queuedTasks,
      unestimated: l.unestimated,
      overCapacity: assigneeId !== null && l.activePoints > risk.meta.capacityPoints,
    }))
    .sort((a, b) => {
      if (a.assigneeId === null) return 1;
      if (b.assigneeId === null) return -1;
      return b.activePoints - a.activePoints || a.name.localeCompare(b.name);
    });

  // Overdue tasks (strict, current due date).
  const overdueTasks = open
    .filter((r) => r.task.dueDate !== null && r.task.dueDate.getTime() < asOf.getTime())
    .map((r) => ({
      taskId: r.task.id,
      title: r.task.title,
      projectId: r.task.projectId,
      assigneeName: r.task.assigneeId ? (nameOf.get(r.task.assigneeId) ?? "Former member") : null,
      priority: r.task.priority,
      dueDate: (r.task.dueDate as Date).toISOString(),
      daysOverdue: roundTo2((asOf.getTime() - (r.task.dueDate as Date).getTime()) / DAY_MS),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.title.localeCompare(b.title));

  // Project progress over the filtered population (an empty project still appears).
  const visibleProjects = projects
    .filter((p) => !filters.projectId || p.id === filters.projectId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const projectProgress = visibleProjects.map((p) => {
    const inProject = rows.filter((r) => r.task.projectId === p.id);
    const done = inProject.filter((r) => r.status === "done").length;
    const openRows = inProject.filter((r) => r.status !== "done");
    return {
      projectId: p.id,
      name: p.name,
      color: p.color,
      total: inProject.length,
      done,
      open: openRows.length,
      overdue: openRows.filter((r) => r.task.dueDate !== null && r.task.dueDate.getTime() < asOf.getTime()).length,
      blocked: openRows.filter((r) => blockersOf.has(r.task.id)).length,
      completionShare: ratio(done, inProject.length),
    };
  });

  // Risk over the filtered open population.
  const riskRows = open.flatMap((r) => {
    const res = risk.results.get(r.task.id);
    return res ? [{ task: r.task, res }] : [];
  });
  const distribution: Record<RiskBand, number> = { low: 0, medium: 0, high: 0 };
  for (const { res } of riskRows) distribution[res.band] += 1;
  const items: DashboardRiskItem[] = riskRows
    .sort((a, b) => b.res.score - a.res.score || a.task.title.localeCompare(b.task.title))
    .slice(0, riskLimit)
    .map(({ task, res }) => ({
      taskId: task.id,
      title: task.title,
      projectId: task.projectId,
      assigneeName: task.assigneeId ? (nameOf.get(task.assigneeId) ?? "Former member") : null,
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      score: res.score,
      band: res.band,
      interval: res.interval,
      bandRange: res.bandRange,
      confidence: res.confidence,
      topFactors: [...res.factors]
        .filter((f) => f.contribution > 0)
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 2)
        .map((f) => ({ label: f.label, contribution: f.contribution })),
      missingInputs: res.missingInputs,
    }));

  return {
    window: report.window,
    filters,
    summary: {
      openTasks: report.population.open,
      completed: report.throughput.completed,
      reopened: report.throughput.reopened,
      completionRate: report.completionRate.rate,
      completionEligible: report.completionRate.eligible,
      onTimeRate: report.onTime.rate,
      onTimeEligible: report.onTime.eligible,
      overdue: report.overdue.count,
      blocked: report.blocked.blocked,
      blockedShare: report.blocked.share,
      cycleP50: report.timing.cycle.p50,
      cycleP85: report.timing.cycle.p85,
      leadP50: report.timing.lead.p50,
      activePoints: report.workload.active.points,
      activeCoverage: report.workload.active.coverage,
      highRisk: distribution.high,
    },
    completionTrend,
    cycleTrend,
    workload,
    overdueTasks,
    projectProgress,
    blocked: {
      count: report.blocked.blocked,
      share: report.blocked.share,
      points: report.blocked.blockedEstimatedPoints,
      tasks: blockedTasks,
    },
    risk: {
      modelVersion: risk.meta.modelVersion,
      revision: risk.meta.revision,
      fingerprint: risk.meta.fingerprint,
      capacityPoints: risk.meta.capacityPoints,
      distribution,
      lowConfidence: riskRows.filter((r) => r.res.confidence === "low").length,
      items,
    },
    dataQuality: {
      unestimatedOpen: open.filter((r) => r.task.estimatePoints === null).length,
      undatedOpen: open.filter((r) => r.task.dueDate === null).length,
    },
  };
}
