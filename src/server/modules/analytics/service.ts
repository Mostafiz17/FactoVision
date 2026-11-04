import { store, memberUsers } from "@/db/repository";
import {
  assertTimeZone,
  buildAnalyticsReport,
  buildWindow,
  normalizeFilters,
  roundHalfUp,
  type AnalyticsFilters,
  type AnalyticsReport,
  type AnalyticsEvent,
} from "@/lib/analytics";
import {
  buildCfd,
  ewmaSeries,
  forecast,
  DEFAULT_WIP_LIMIT,
  isWip,
  type CfdTaskInput,
} from "@/lib/domain/analytics";
import type { AnalyticsDTO, MemberLoad, PersonLite, RiskItem, TaskStatus } from "@/lib/domain/types";
import { STATUSES } from "@/lib/domain/types";
import { workspaceRisk } from "@/server/modules/risk/service";
import { ensureCan, requireMembership } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import { loadAnalyticsSource } from "./repository";

export const DEFAULT_ALPHA = 0.3;
const MAX_CLOCK_SKEW_MS = 60_000;

export interface ReportQuery {
  days: number;
  timeZone: string;
  /** Replay instant. Defaults to now; future instants are rejected. */
  asOf?: Date;
  filters: AnalyticsFilters;
}

export function validateQuery(query: ReportQuery, now: Date): { asOf: Date; filters: AnalyticsFilters } {
  try {
    assertTimeZone(query.timeZone);
  } catch (e) {
    throw new ApiError(400, e instanceof Error ? e.message : "Unknown time zone");
  }
  if (!Number.isInteger(query.days) || query.days < 1 || query.days > 366) {
    throw new ApiError(400, "days must be an integer between 1 and 366");
  }
  const asOf = query.asOf ?? now;
  if (Number.isNaN(asOf.getTime())) throw new ApiError(400, "asOf must be a valid instant");
  if (asOf.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) throw new ApiError(400, "asOf cannot be in the future");
  return { asOf, filters: normalizeFilters(query.filters) };
}

/** A filter that names another tenant's project must look exactly like a missing project. */
export async function assertFilterScope(workspaceId: string, filters: AnalyticsFilters): Promise<void> {
  if (!filters.projectId) return;
  const rows = await store.projects.find({ id: filters.projectId, workspaceId }, { limit: 1 });
  if (!rows[0]) throw new ApiError(404, "Project not found");
}

/**
 * Authorized analytics report. Membership and the `analytics.read` capability are
 * checked before any data is read; filters are validated against the workspace.
 */
export async function getAnalyticsReport(
  userId: string,
  workspaceId: string,
  query: ReportQuery,
): Promise<AnalyticsReport> {
  const membership = await requireMembership(userId, workspaceId);
  ensureCan(membership.role, "analytics.read");
  const { asOf, filters } = validateQuery(query, new Date());
  await assertFilterScope(workspaceId, filters);
  const win = buildWindow(asOf, query.timeZone, query.days);
  const source = await loadAnalyticsSource(workspaceId, win, filters);
  return buildAnalyticsReport(source, { asOf, timeZone: query.timeZone, days: query.days, filters });
}

const asStatus = (v: string | null): TaskStatus | null =>
  v !== null && (STATUSES as string[]).includes(v) ? (v as TaskStatus) : null;

/**
 * Dashboard view model (UTC days, default alpha). Flow metrics (throughput,
 * timing, on-time, daily series, totals) come from the analytics domain report.
 * Cumulative flow, the forecast, member load and the risk queue remain computed
 * here from current projections and the same replayed events.
 */
export async function computeAnalytics(
  userId: string,
  workspaceId: string,
  days: number,
  alpha = DEFAULT_ALPHA,
): Promise<AnalyticsDTO> {
  const membership = await requireMembership(userId, workspaceId);
  ensureCan(membership.role, "analytics.read");
  const now = new Date();
  const win = buildWindow(now, "UTC", days);
  const [source, taskRows, memberRows] = await Promise.all([
    loadAnalyticsSource(workspaceId, win, {}),
    store.tasks.find({ workspaceId, deletedAt: null }),
    memberUsers(workspaceId),
  ]);

  const report = buildAnalyticsReport(source, { asOf: now, timeZone: "UTC", days });
  const previous = buildAnalyticsReport(
    { tasks: source.tasks, events: source.events, edges: source.edges },
    { asOf: new Date(win.start.getTime() - 1), timeZone: "UTC", days },
  );

  const completedSeries = report.daily.map((d) => d.completed);
  const smooth = ewmaSeries(completedSeries, alpha);
  const daily = report.daily.map((d, i) => ({
    date: d.day,
    created: d.created,
    completed: d.completed,
    reopened: d.reopened,
    ewma: roundHalfUp(smooth[i] ?? 0, 3),
  }));

  // Cumulative flow from replayed status events (non-deleted tasks, as before).
  const eventsByTask = new Map<string, AnalyticsEvent[]>();
  for (const e of source.events) {
    const list = eventsByTask.get(e.taskId);
    if (list) list.push(e);
    else eventsByTask.set(e.taskId, [e]);
  }
  const cfdInputs: CfdTaskInput[] = taskRows.map((t) => {
    const evs = eventsByTask.get(t.id) ?? [];
    const created = evs.find((e) => e.type === "created");
    const transitions = evs
      .filter((e) => e.type === "status_changed" || e.type === "completed" || e.type === "reopened")
      .flatMap((e) => {
        const to = asStatus(e.toValue);
        return to ? [{ at: e.at, to }] : [];
      });
    return {
      createdAt: t.createdAt,
      initialStatus: asStatus(created?.toValue ?? null) ?? "backlog",
      transitions,
    };
  });
  const cfd = buildCfd(cfdInputs, win.start, new Date(win.endExclusive.getTime() - 1));

  const titleById = new Map(source.tasks.map((t) => [t.id, t.title] as const));
  const assigneeById = new Map(source.tasks.map((t) => [t.id, t.assigneeId] as const));
  const cycleSamples = report.timing.cycleSamples.map((s) => ({
    id: s.taskId,
    title: titleById.get(s.taskId) ?? "",
    days: s.days,
    points: s.points,
  }));

  const open = taskRows.filter((t) => t.status !== "done");
  const activeByMember = new Map<string, number>();
  for (const t of open) {
    if (t.assigneeId) activeByMember.set(t.assigneeId, (activeByMember.get(t.assigneeId) ?? 0) + 1);
  }
  const completedByMember = new Map<string, number>();
  for (const id of report.completedTaskIds) {
    const assignee = assigneeById.get(id);
    if (assignee) completedByMember.set(assignee, (completedByMember.get(assignee) ?? 0) + 1);
  }
  const workload: MemberLoad[] = memberRows.map(({ u }) => {
    const active = open.filter((t) => t.assigneeId === u.id);
    const wip = active.filter((t) => isWip(t.status)).length;
    return {
      userId: u.id,
      name: u.name,
      avatarHue: u.avatarHue,
      active: active.length,
      wip,
      completed: completedByMember.get(u.id) ?? 0,
      overload: wip > DEFAULT_WIP_LIMIT,
    };
  });

  const cycleFallbackUsed = report.timing.cycle.count < 3;

  const membersLite = new Map<string, PersonLite>(
    memberRows.map(({ u }) => [u.id, { id: u.id, name: u.name, avatarHue: u.avatarHue }] as const),
  );
  const { results: riskResults, config: riskConfig } = await workspaceRisk(workspaceId, now);
  const riskQueue: RiskItem[] = open
    .flatMap((t) => {
      const risk = riskResults.get(t.id);
      if (!risk) return [];
      const top = [...risk.factors].sort((x, y) => y.contribution - x.contribution)[0];
      return [
        {
          taskId: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          assignee: t.assigneeId ? (membersLite.get(t.assigneeId) ?? null) : null,
          score: risk.score,
          band: risk.band,
          confidence: risk.confidence,
          interval: risk.interval,
          topFactor: top?.label ?? "—",
        },
      ];
    })
    .sort((x, y) => y.score - x.score || x.title.localeCompare(y.title));
  const riskDistribution = {
    low: riskQueue.filter((r) => r.band === "low").length,
    medium: riskQueue.filter((r) => r.band === "medium").length,
    high: riskQueue.filter((r) => r.band === "high").length,
  };

  const forecastDto = forecast(report.population.open, completedSeries, alpha);

  return {
    days,
    from: win.start.toISOString(),
    to: win.endExclusive.toISOString(),
    alpha,
    daily,
    cfd,
    cycle: report.timing.cycle,
    lead: report.timing.lead,
    cycleSamples,
    onTime: {
      onTime: report.onTime.onTime,
      late: report.onTime.late,
      total: report.onTime.eligible,
      rate: report.onTime.rate,
    },
    wip: { total: report.workload.active.count, limitPerMember: DEFAULT_WIP_LIMIT },
    workload,
    forecast: forecastDto,
    totals: {
      completed: report.throughput.completed,
      reopened: report.throughput.reopened,
      net: report.throughput.net,
      created: report.throughput.created,
      open: report.population.open,
      highRisk: riskDistribution.high,
    },
    prev: {
      completed: previous.throughput.completed,
      net: previous.throughput.net,
      cycleP50: previous.timing.cycle.p50,
      onTimeRate: previous.onTime.rate,
    },
    riskQueue: riskQueue.slice(0, 10),
    riskDistribution,
    riskModel: { version: riskConfig.modelVersion, revision: riskConfig.revision },
    cycleFallbackUsed,
  };
}
