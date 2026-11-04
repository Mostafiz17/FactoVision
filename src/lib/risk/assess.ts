import type { TaskStatus } from "@/lib/domain/types";
import { buildHistories, stateAt } from "@/lib/analytics/timeline";
import type { AnalyticsSource } from "@/lib/analytics/types";
import { computeTaskRisk, type RiskConfig, type RiskInput, type RiskResult, type VelocitySource } from "./model";

/**
 * Builds risk inputs for every open task at `asOf` from the same replayed event
 * history the analytics use, then scores them. Pure.
 *
 * Velocity (points/day, calendar days):
 *   assignee rate = Σ estimate of the assignee's completions in the look-back ÷ lookbackDays,
 *                   used when the assignee has ≥ minVelocitySamples estimated completions;
 *   team rate     = Σ estimate of all completions ÷ lookbackDays ÷ #distinct completers,
 *                   used when the team has ≥ minVelocitySamples;
 *   otherwise defaultPointsPerDay.
 * Completions are attributed to the task's current assignee.
 *
 * Blocked since = earliest createdAt among the task's edges whose blocker is
 * unresolved (exists, not deleted, not done) at asOf. Edges created after asOf are ignored.
 */
const ACTIVE = new Set<TaskStatus>(["in_progress", "review"]);
const DAY_MS = 86_400_000;

export function assessWorkspaceRisk(
  source: AnalyticsSource,
  asOf: Date,
  config: RiskConfig,
  configRevision: number,
): Map<string, RiskResult> {
  const histories = buildHistories(source.tasks, source.events, asOf);
  const taskById = new Map(source.tasks.map((t) => [t.id, t] as const));
  const statusAt = new Map<string, { status: TaskStatus; deleted: boolean }>();
  for (const t of source.tasks) {
    const h = histories.get(t.id);
    const s = h ? stateAt(h, asOf) : null;
    if (s) statusAt.set(t.id, { status: s.status, deleted: s.deleted });
  }
  const isOpen = (id: string) => {
    const s = statusAt.get(id);
    return !!s && !s.deleted && s.status !== "done";
  };

  // Velocity over the look-back.
  const p = config.params;
  const since = asOf.getTime() - p.velocityLookbackDays * DAY_MS;
  const perAssignee = new Map<string, { points: number; samples: number }>();
  let teamPoints = 0;
  let teamSamples = 0;
  for (const h of histories.values()) {
    const task = taskById.get(h.taskId);
    if (!task || task.estimatePoints === null || task.assigneeId === null) continue;
    for (const c of h.completions) {
      const t = c.completedAt.getTime();
      if (t < since || t > asOf.getTime()) continue;
      const entry = perAssignee.get(task.assigneeId) ?? { points: 0, samples: 0 };
      entry.points += task.estimatePoints;
      entry.samples += 1;
      perAssignee.set(task.assigneeId, entry);
      teamPoints += task.estimatePoints;
      teamSamples += 1;
    }
  }
  const completers = perAssignee.size;
  const teamRate = completers > 0 ? teamPoints / p.velocityLookbackDays / completers : 0;
  const velocityFor = (assigneeId: string | null): { pointsPerDay: number; source: VelocitySource; samples: number } => {
    const own = assigneeId ? perAssignee.get(assigneeId) : undefined;
    if (own && own.samples >= p.minVelocitySamples && own.points > 0) {
      return { pointsPerDay: own.points / p.velocityLookbackDays, source: "assignee", samples: own.samples };
    }
    if (teamSamples >= p.minVelocitySamples && teamRate > 0) {
      return { pointsPerDay: teamRate, source: "team", samples: teamSamples };
    }
    return { pointsPerDay: p.defaultPointsPerDay, source: "default", samples: own?.samples ?? 0 };
  };

  // Assignee active load at asOf.
  const load = new Map<string, { points: number; unestimated: number }>();
  for (const t of source.tasks) {
    if (!t.assigneeId || !isOpen(t.id)) continue;
    const s = statusAt.get(t.id);
    if (!s || !ACTIVE.has(s.status)) continue;
    const entry = load.get(t.assigneeId) ?? { points: 0, unestimated: 0 };
    if (t.estimatePoints === null) entry.unestimated += 1;
    else entry.points += t.estimatePoints;
    load.set(t.assigneeId, entry);
  }

  // Unresolved blockers per task.
  const blockers = new Map<string, { count: number; since: Date | null; unknown: boolean }>();
  for (const e of source.edges) {
    if (e.createdAt && e.createdAt.getTime() > asOf.getTime()) continue;
    if (!isOpen(e.dependsOnId)) continue;
    const entry = blockers.get(e.taskId) ?? { count: 0, since: null, unknown: false };
    entry.count += 1;
    if (!e.createdAt) entry.unknown = true;
    else if (!entry.since || e.createdAt.getTime() < entry.since.getTime()) entry.since = e.createdAt;
    blockers.set(e.taskId, entry);
  }

  const results = new Map<string, RiskResult>();
  for (const t of source.tasks) {
    if (!isOpen(t.id)) continue;
    const b = blockers.get(t.id);
    const l = t.assigneeId ? load.get(t.assigneeId) : undefined;
    const input: RiskInput = {
      estimatePoints: t.estimatePoints,
      dueDate: t.dueDate,
      blockedSince: b?.since ?? null,
      blockedSinceUnknown: b?.unknown ?? false,
      unresolvedBlockers: b?.count ?? 0,
      assigneeId: t.assigneeId,
      assigneeActivePoints: l?.points ?? 0,
      assigneeActiveUnestimated: l?.unestimated ?? 0,
      velocity: velocityFor(t.assigneeId),
    };
    results.set(t.id, computeTaskRisk(input, asOf, config, configRevision));
  }
  return results;
}
