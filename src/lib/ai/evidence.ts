import type { DashboardDTO } from "@/lib/dashboard/model";
import { fmtDays, pct } from "@/lib/utils";
import type { EvidenceBundle, EvidenceFact } from "./types";

/**
 * Builds the ONLY data an AI provider may see: aggregates and a bounded set of
 * task references taken from the caller's authorized dashboard view model.
 * Pure and deterministic — no ids, names or numbers enter the bundle that are
 * not already in the dashboard, so tenant isolation is inherited from it.
 */
const MAX_TASK_REFS = 12;

const num = (v: number | null): string => (v === null ? "unknown" : String(v));

export function buildEvidence(dashboard: DashboardDTO, workspaceName: string, generatedAt: Date): EvidenceBundle {
  const facts: EvidenceFact[] = [];
  const taskRefs = new Map<string, string>();
  const ref = (taskId: string, title: string) => {
    if (taskRefs.size < MAX_TASK_REFS) taskRefs.set(taskId, title);
  };
  const add = (text: string, taskIds: string[] = []): string => {
    const id = `E${String(facts.length + 1).padStart(2, "0")}`;
    facts.push({ id, text: text.length > 4000 ? text.slice(0, 3950) + " [details truncated]" : text, taskIds: taskIds.slice(0, 12) });
    return id;
  };

  const s = dashboard.summary;
  add(`Analysis window: ${dashboard.window.days} days (${dashboard.window.startDay} to ${dashboard.window.endDay}, ${dashboard.window.timeZone}).`);
  add(
    `Throughput: ${s.completed} completed and ${s.reopened} reopened in the window; completion rate of the created cohort is ${s.completionRate === null ? "unknown (empty cohort)" : pct(s.completionRate)} over ${s.completionEligible} eligible task(s).`,
  );
  add(
    `On-time delivery: ${s.onTimeRate === null ? "unknown (no dated completions)" : pct(s.onTimeRate)} over ${s.onTimeEligible} dated completion(s).`,
  );
  add(`Cycle time: P50 ${fmtDays(s.cycleP50)} days, P85 ${fmtDays(s.cycleP85)} days; lead time P50 ${fmtDays(s.leadP50)} days.`);
  add(
    `Workload: ${s.openTasks} open task(s), ${s.activePoints} estimated active points, estimate coverage ${s.activeCoverage === null ? "unknown" : pct(s.activeCoverage)}.`,
  );
  add(
    `Overdue: ${s.overdue} open task(s) past their due date${
      dashboard.overdueTasks.length
        ? ": " +
          dashboard.overdueTasks
            .slice(0, 4)
            .map((t) => `“${t.title}” (${fmtDays(t.daysOverdue)} days late${t.assigneeName ? `, ${t.assigneeName}` : ", unassigned"})`)
            .join("; ")
        : ""
    }.`,
    dashboard.overdueTasks.slice(0, 4).map((t) => {
      ref(t.taskId, t.title);
      return t.taskId;
    }),
  );
  add(
    `Blocked: ${dashboard.blocked.count} open task(s) blocked (${dashboard.blocked.share === null ? "share unknown" : pct(dashboard.blocked.share)} of open, ${dashboard.blocked.points} estimated points waiting)${
      dashboard.blocked.tasks.length
        ? ": " +
          dashboard.blocked.tasks
            .slice(0, 4)
            .map((t) => `“${t.title}” blocked ${t.blockedDays === null ? "for an unknown duration" : `${fmtDays(t.blockedDays)} days`} by ${t.blockers.slice(0, 8).map((b) => `“${b.title}”`).join(", ")}`)
            .join("; ")
        : ""
    }.`,
    dashboard.blocked.tasks.slice(0, 4).flatMap((t) => {
      ref(t.taskId, t.title);
      for (const b of t.blockers) ref(b.taskId, b.title);
      return [t.taskId, ...t.blockers.map((b) => b.taskId)];
    }),
  );
  for (const w of dashboard.workload.slice(0, 20)) {
    add(
      `Workload of ${w.name}: ${w.activePoints} active pt across ${w.activeTasks} task(s), ${w.queuedPoints} queued pt across ${w.queuedTasks} task(s), ${w.unestimated} unestimated${w.overCapacity ? " — OVER the configured capacity" : ""}.`,
    );
  }
  for (const p of dashboard.projectProgress.slice(0, 20)) {
    add(
      `Project “${p.name}”: ${p.done}/${p.total} done (${p.completionShare === null ? "no tasks" : pct(p.completionShare)}), ${p.open} open, ${p.overdue} overdue, ${p.blocked} blocked.`,
    );
  }
  add(
    `Deadline risk: ${dashboard.risk.distribution.high} high, ${dashboard.risk.distribution.medium} medium, ${dashboard.risk.distribution.low} low; ${dashboard.risk.lowConfidence} score(s) low-confidence.`,
  );
  const topRisk = dashboard.risk.items.slice(0, 5);
  if (topRisk.length) {
    add(
      `Highest-risk open tasks: ${topRisk
        .map((r) => `“${r.title}” score ${r.score}/100 (${r.band}, range ${r.interval.low}–${r.interval.high}, ${r.confidence} confidence; top factors: ${r.topFactors.map((f) => `${f.label} +${f.contribution}`).join(", ") || "none"}${r.missingInputs.length ? `; missing inputs: ${r.missingInputs.join(", ")}` : ""})`)
        .join("; ")}.`,
      topRisk.map((r) => {
        ref(r.taskId, r.title);
        return r.taskId;
      }),
    );
  }
  const trend = dashboard.completionTrend;
  if (trend.length >= 2) {
    const last = trend[trend.length - 1];
    const prev = trend[trend.length - 2];
    add(
      `Weekly completion trend: ${prev.completed} completed in the week of ${prev.label}, ${last.completed} in the week of ${last.label} (net ${num(last.net)}).`,
    );
  }
  add(
    `Data quality: ${dashboard.dataQuality.unestimatedOpen} open task(s) without an estimate and ${dashboard.dataQuality.undatedOpen} without a due date; their risk scores are ranges, not points.`,
  );

  return {
    workspaceName,
    generatedAt: generatedAt.toISOString(),
    facts,
    taskRefs: [...taskRefs.entries()].map(([id, title]) => ({ id, title })),
  };
}
