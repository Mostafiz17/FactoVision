/**
 * Human-readable metric catalogue. Text only: no numbers are stored here, so
 * the UI and documentation cannot drift into showing hardcoded results.
 */
export interface MetricDefinition {
  id: string;
  label: string;
  formula: string;
  eligibility: string;
  boundary: string;
  limitations: string[];
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "throughput",
    label: "Throughput (created, completed, reopened, net)",
    formula: "completed = #completed events in window; reopened = #reopened events in window; net = completed − reopened",
    eligibility: "Events of tasks in the filtered population, including tasks deleted after the event.",
    boundary: "Event instant in [window start, window end) and ≤ asOf; days are local calendar days.",
    limitations: ["Each reopen-and-recomplete counts as a separate completion (gross flow, not unique tasks)."],
  },
  {
    id: "completion_rate",
    label: "Completion rate (created-cohort)",
    formula: "completed ÷ eligible, where eligible = tasks created in window and not deleted at asOf; completed = those with status done at asOf",
    eligibility: "Tasks created in the window that are not soft-deleted at asOf. Deleted tasks are excluded from the denominator.",
    boundary: "Creation instant in [window start, window end) and ≤ asOf. Status is read at asOf.",
    limitations: [
      "Tasks created before the window are not in the cohort, even if completed inside it; throughput covers them.",
      "A task completed and then reopened before asOf is not counted as completed.",
    ],
  },
  {
    id: "on_time_rate",
    label: "On-time completion rate",
    formula: "on-time ÷ eligible, where eligible = completions in window whose task has a due date; on-time = completedAt ≤ dueDate",
    eligibility: "Completions in the window with a due date. Undated completions are excluded from the denominator and reported as such.",
    boundary: "Completion instant in the window; completedAt equal to dueDate counts as on time.",
    limitations: [
      "Uses the task's CURRENT due date, not the due date at completion (due-date history is not replayed). Retroactive due-date edits change past results.",
      "Each reopen-and-recomplete is judged separately against the same due date.",
    ],
  },
  {
    id: "overdue",
    label: "Overdue count and share",
    formula: "overdue = #open tasks with dueDate < asOf; share = overdue ÷ #open tasks with a due date; ageDays = asOf − dueDate for overdue tasks",
    eligibility: "Open tasks (status backlog, todo, in_progress, review) not deleted at asOf, created on or before asOf, and with a due date.",
    boundary: "Strict: a due instant equal to asOf is not overdue. Status and deletion are read at asOf.",
    limitations: ["Uses the current due date (see on-time limitation)."],
  },
  {
    id: "cycle_time",
    label: "Cycle time (P50 / P85 / mean)",
    formula: "cycle = completedAt − flowStart, in days; P50 and P85 by nearest-rank; mean is the arithmetic mean",
    eligibility: "Completions in the window that have a flow start (see definition of flow start). Missing flow starts are excluded, never estimated.",
    boundary: "Completion instant in the window and ≤ asOf.",
    limitations: [
      "Flow start is the first entry into in_progress or review since creation or the last reopen; moving back to todo does not reset it.",
      "Tasks created directly in done have cycle 0 (start = creation = completion).",
      "Projection timestamps startedAt/completedAt are not used by analytics.",
    ],
  },
  {
    id: "lead_time",
    label: "Lead time (P50 / P85 / mean)",
    formula: "lead = completedAt − createdAt, in days; same statistics as cycle time",
    eligibility: "All completions in the window (always defined).",
    boundary: "Completion instant in the window and ≤ asOf.",
    limitations: ["Anchored to the original creation, so reworked tasks have long lead times by design."],
  },
  {
    id: "active_workload",
    label: "Active and queued estimated workload",
    formula: "active = open tasks in in_progress or review; queued = open tasks in backlog or todo; points = Σ estimatePoints over estimated tasks; coverage = estimated ÷ count",
    eligibility: "Open tasks at asOf. Tasks without an estimate are counted as unestimated and contribute 0 points.",
    boundary: "Snapshot at asOf.",
    limitations: [
      "Estimates are the current values; estimate history is not replayed.",
      "Points are not hours and are not comparable across teams.",
    ],
  },
  {
    id: "weekly_trends",
    label: "Weekly trends",
    formula: "per ISO-style week (Monday start, local time zone): created, completed, reopened, net; on-time rate and median cycle time of that week's completions",
    eligibility: "Same as the underlying metrics. Weeks at the window edges are partial and report daysInWindow.",
    boundary: "Weeks are local calendar weeks in the requested time zone.",
    limitations: ["A week's on-time rate and cycle median are null when no eligible completions occurred that week."],
  },
  {
    id: "blocked",
    label: "Blocked-task analysis",
    formula: "blocked = open tasks with ≥ 1 unresolved blocker; unresolved blocker = a non-deleted task that is not done at asOf; share = blocked ÷ open; topBlockers ranked by number of open tasks held back",
    eligibility: "Open tasks at asOf. Deleted blockers do not block.",
    boundary: "Snapshot at asOf; blocker status is replayed to asOf.",
    limitations: [
      "Dependency edges are current-state: edges created after asOf are excluded; removed edges cannot be reconstructed.",
      "Time spent blocked is not measured: dependency events record the blocker title, not its id.",
    ],
  },
];

export const GLOBAL_LIMITATIONS: string[] = [
  "Analytics replay the append-only event log up to asOf for status, deletion and completions. Project, assignee, priority, labels, due dates and estimates are current values.",
  "Only current dependency edges created by asOf are included; removed edges cannot be reconstructed.",
  "Events sharing the same millisecond are ordered by type (created first) and then by id; this is deterministic but arbitrary.",
  "Metrics describe what was recorded. They do not measure effort, quality or individual performance.",
];
