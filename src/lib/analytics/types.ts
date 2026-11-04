import type { Priority, TaskStatus } from "@/lib/domain/types";
import type { SampleStats } from "./stats";

/** Task projection as seen by analytics. Status and deletion are also replayed from events. */
export interface AnalyticsTask {
  id: string;
  title: string;
  projectId: string;
  assigneeId: string | null;
  priority: Priority;
  estimatePoints: number | null;
  dueDate: Date | null;
  labels: readonly string[];
  /** Current status (projection). Used only when a task has no status history. */
  status: TaskStatus;
  createdAt: Date;
  deletedAt: Date | null;
}

/** Immutable task event, restricted to the types analytics replays. */
export interface AnalyticsEvent {
  id: string;
  taskId: string;
  type: string;
  at: Date;
  fromValue: string | null;
  toValue: string | null;
}

/** "taskId depends on dependsOnId" — dependsOnId blocks taskId while unresolved. */
export interface AnalyticsEdge {
  taskId: string;
  dependsOnId: string;
  /** When the dependency was added; used for blocked duration. Absent for unknown/legacy edges. */
  createdAt?: Date;
}

export interface AnalyticsFilters {
  projectId?: string;
  /** "none" selects unassigned tasks. */
  assigneeId?: string | "none";
  priority?: Priority;
  /** Normalized lowercase label. */
  label?: string;
}

export type DailyEventType = "created" | "completed" | "reopened";

/** Pre-aggregated per-day counts (e.g. from a GROUP BY). Optional; derived from events when absent. */
export interface DailyCountRow {
  day: string;
  type: DailyEventType;
  count: number;
}

export interface AnalyticsSource {
  tasks: readonly AnalyticsTask[];
  events: readonly AnalyticsEvent[];
  edges: readonly AnalyticsEdge[];
  dailyCounts?: readonly DailyCountRow[];
}

export interface ReportOptions {
  asOf: Date;
  timeZone: string;
  days: number;
  filters?: AnalyticsFilters;
}

export interface DayCounts {
  day: string;
  created: number;
  completed: number;
  reopened: number;
}

export interface WeekBucket {
  weekStart: string;
  /** Days of this week inside the window (partial at window edges). */
  daysInWindow: number;
  created: number;
  completed: number;
  reopened: number;
  net: number;
  onTimeEligible: number;
  onTime: number;
  onTimeRate: number | null;
  cycleCount: number;
  cycleMedianDays: number | null;
}

export interface WorkloadGroup {
  count: number;
  estimated: number;
  unestimated: number;
  points: number;
  /** Estimated share of tasks in the group, 0..1; null when the group is empty. */
  coverage: number | null;
}

export interface AssigneeLoad {
  assigneeId: string | null;
  count: number;
  points: number;
}

export interface BlockerSummary {
  taskId: string;
  title: string;
  /** Open tasks in the population that this unresolved blocker currently holds back. */
  blocks: number;
}

export interface AnalyticsReport {
  window: {
    timeZone: string;
    days: number;
    asOf: string;
    startDay: string;
    endDay: string;
    start: string;
    endExclusive: string;
  };
  filters: AnalyticsFilters;
  population: { tasks: number; open: number };
  throughput: { created: number; completed: number; reopened: number; net: number };
  /** Cohort completion rate: tasks created in the window, not deleted at asOf, done at asOf. */
  completionRate: { eligible: number; completed: number; rate: number | null };
  timing: {
    cycle: SampleStats;
    lead: SampleStats;
    /** One entry per completion with a recorded flow start, oldest first. */
    cycleSamples: { taskId: string; completedAt: string; days: number; points: number | null }[];
  };
  /** One entry per completion in the window; the task id repeats for reopened tasks. */
  completedTaskIds: string[];
  onTime: { eligible: number; onTime: number; late: number; rate: number | null };
  overdue: { count: number; openWithDue: number; share: number | null; ageDays: SampleStats };
  workload: {
    active: WorkloadGroup;
    queued: WorkloadGroup;
    activeByAssignee: AssigneeLoad[];
  };
  blocked: {
    openTasks: number;
    blocked: number;
    share: number | null;
    blockedEstimatedPoints: number;
    topBlockers: BlockerSummary[];
  };
  daily: DayCounts[];
  weekly: WeekBucket[];
  limitations: string[];
}
