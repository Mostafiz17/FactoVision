import type { DashboardDTO } from "@/lib/dashboard/model";
import { fmtDays, pct } from "@/lib/utils";
import { MAX_INSIGHTS, type EvidenceBundle, type InsightItem } from "./types";

/**
 * Rule-based narrator. Always available, clearly labelled "deterministic" —
 * never presented as AI. It emits the same shape as a validated AI response:
 * observed facts and suggestions, each citing evidence ids from the bundle.
 *
 * The bundle is built from the dashboard the narrator also receives, so its
 * citations point at facts that state exactly the numbers it uses.
 */
export function deterministicInsights(dashboard: DashboardDTO, bundle: EvidenceBundle): InsightItem[] {
  const out: InsightItem[] = [];
  const factByText = (needle: string): string[] =>
    bundle.facts.filter((f) => f.text.includes(needle)).map((f) => f.id);
  const d = dashboard;

  // 1 — delivery risk (highest-risk tasks)
  const high = d.risk.items.filter((r) => r.band === "high");
  if (high.length > 0) {
    const top = high.slice(0, 3);
    out.push({
      kind: "fact",
      severity: "danger",
      title: `${high.length} task${high.length === 1 ? "" : "s"} at high deadline risk`,
      body: top
        .map((r) => `“${r.title}” scores ${r.score}/100 (range ${r.interval.low}–${r.interval.high}${r.confidence === "low" ? ", low confidence" : ""})`)
        .join("; ") + ".",
      evidenceRefs: factByText("Highest-risk open tasks").concat(factByText("Deadline risk")).slice(0, 3),
      taskIds: top.map((r) => r.taskId),
    });
    out.push({
      kind: "suggestion",
      severity: "warning",
      title: "Triage the high-risk queue first",
      body: `Open the top risk item${top.length > 1 ? "s" : ""} and re-scope, reassign, or pull ${top.length > 1 ? "them" : "it"} into review. Low-confidence scores list the missing inputs that would sharpen them.`,
      evidenceRefs: factByText("Highest-risk open tasks").concat(factByText("Data quality")).slice(0, 3),
      taskIds: top.slice(0, 1).map((r) => r.taskId),
    });
  }

  // 2 — workload imbalance
  const overloaded = d.workload.filter((w) => w.overCapacity);
  const idle = d.workload.filter((w) => w.assigneeId !== null && w.activePoints === 0 && w.activeTasks === 0);
  if (overloaded.length > 0) {
    out.push({
      kind: "fact",
      severity: "warning",
      title: "Workload exceeds capacity",
      body: overloaded.map((w) => `${w.name} carries ${w.activePoints} active pt over the configured capacity`).join("; ") + ".",
      evidenceRefs: overloaded.flatMap((w) => factByText(`Workload of ${w.name}`)).slice(0, 4),
      taskIds: [],
    });
    out.push({
      kind: "suggestion",
      severity: "info",
      title: "Rebalance before starting new work",
      body:
        idle.length > 0
          ? `${idle.map((w) => w.name).join(", ")} ${idle.length === 1 ? "has" : "have"} no active work — move items from the overloaded assignee${overloaded.length > 1 ? "s" : ""}.`
          : "Finish before starting: reducing in-flight work shortens cycle time (Little's Law).",
      evidenceRefs: overloaded.flatMap((w) => factByText(`Workload of ${w.name}`)).concat(idle.flatMap((w) => factByText(`Workload of ${w.name}`))).slice(0, 4),
      taskIds: [],
    });
  } else if (d.workload.length > 0) {
    out.push({
      kind: "fact",
      severity: "success",
      title: "Workload is within capacity",
      body: `No assignee exceeds the configured capacity; ${d.summary.activePoints} active pt across ${d.workload.filter((w) => w.assigneeId !== null).length} member(s).`,
      evidenceRefs: factByText("Workload:").slice(0, 2),
      taskIds: [],
    });
  }

  // 3 — bottlenecks: blocked work
  if (d.blocked.count > 0) {
    const worst = d.blocked.tasks[0];
    out.push({
      kind: "fact",
      severity: "warning",
      title: `${d.blocked.count} task${d.blocked.count === 1 ? "" : "s"} blocked (${d.blocked.points} pt waiting)`,
      body: worst
        ? `Longest block: “${worst.title}” ${worst.blockedDays === null ? "for an unknown duration" : `for ${fmtDays(worst.blockedDays)} days`} behind ${worst.blockers.map((b) => `“${b.title}”`).join(", ")}.`
        : "",
      evidenceRefs: factByText("Blocked:").slice(0, 2),
      taskIds: worst ? [worst.taskId, ...worst.blockers.map((b) => b.taskId)] : [],
    });
    out.push({
      kind: "suggestion",
      severity: "info",
      title: "Unblock the longest-waiting task",
      body: "Prioritise the blockers of the longest-blocked task, or re-sequence dependents so the blocked work is not on the critical path.",
      evidenceRefs: factByText("Blocked:").slice(0, 2),
      taskIds: worst ? worst.blockers.map((b) => b.taskId) : [],
    });
  }

  // 4 — on-time delivery
  if (d.summary.onTimeRate !== null) {
    const good = d.summary.onTimeRate >= 0.85;
    out.push({
      kind: "fact",
      severity: good ? "success" : "warning",
      title: `On-time delivery at ${pct(d.summary.onTimeRate)}`,
      body: `${d.summary.onTimeEligible} dated completion(s) in the window; ${good ? "due dates are being honoured" : `cycle P85 is ${fmtDays(d.summary.cycleP85 ?? null)}d — set due dates at least that far after start`}.`,
      evidenceRefs: factByText("On-time delivery").concat(factByText("Cycle time")).slice(0, 3),
      taskIds: [],
    });
  }

  // 5 — overdue
  if (d.summary.overdue > 0) {
    out.push({
      kind: "fact",
      severity: "danger",
      title: `${d.summary.overdue} open task${d.summary.overdue === 1 ? "" : "s"} overdue`,
      body: d.overdueTasks
        .slice(0, 3)
        .map((t) => `“${t.title}” ${fmtDays(t.daysOverdue)} days late${t.assigneeName ? ` (${t.assigneeName})` : " (unassigned)"}`)
        .join("; ") + ".",
      evidenceRefs: factByText("Overdue:").slice(0, 2),
      taskIds: d.overdueTasks.slice(0, 3).map((t) => t.taskId),
    });
  }

  // 6 — data quality / trend when nothing else fired
  if (out.length < 2) {
    out.push({
      kind: "fact",
      severity: "info",
      title: `Window summary: ${d.summary.completed} completed, ${d.summary.openTasks} open`,
      body: d.dataQuality.unestimatedOpen + d.dataQuality.undatedOpen > 0
        ? `${d.dataQuality.unestimatedOpen} open task(s) lack estimates and ${d.dataQuality.undatedOpen} lack due dates — adding them sharpens risk and forecast quality.`
        : "Estimates and due dates are complete across open work.",
      evidenceRefs: factByText("Throughput:").concat(factByText("Data quality")).slice(0, 3),
      taskIds: [],
    });
  }

  // Every item must cite evidence; drop degenerate items and cap the list.
  return out.filter((i) => i.evidenceRefs.length > 0 && i.body.length > 0).slice(0, MAX_INSIGHTS);
}
