export type Role = "owner" | "admin" | "project_manager" | "member";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  project_manager: "PM",
  member: "Member",
};
export type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type EventType =
  | "created"
  | "status_changed"
  | "completed"
  | "reopened"
  | "assigned"
  | "priority_changed"
  | "due_changed"
  | "estimate_changed"
  | "edited"
  | "labels_changed"
  | "parent_changed"
  | "commented"
  | "dependency_added"
  | "dependency_removed"
  | "deleted"
  | "restored";

export const STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "review", "done"];
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];
export const OPEN_STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "review"];
export const WIP_STATUSES: TaskStatus[] = ["in_progress", "review"];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export interface PersonLite {
  id: string;
  name: string;
  avatarHue: number;
}
export interface MemberDTO extends PersonLite {
  email: string;
  role: Role;
}
export interface WorkspaceDTO {
  id: string;
  name: string;
  slug: string;
  role: Role;
}
export interface ProjectDTO {
  id: string;
  name: string;
  key: string;
  color: string;
  description: string;
  archived: boolean;
  createdAt: string;
  taskCount: number;
  doneCount: number;
}
export interface DependencyLite {
  id: string;
  title: string;
  status: TaskStatus;
}
export interface TaskDTO {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee: PersonLite | null;
  creatorId: string | null;
  estimatePoints: number | null;
  dueDate: string | null;
  position: number;
  labels: string[];
  /** @deprecated Compatibility alias for labels. */
  tags: string[];
  revision: number;
  subtaskCount: number;
  completedSubtaskCount: number;
  startedAt: string | null;
  completedAt: string | null;
  statusSince: string;
  createdAt: string;
  updatedAt: string;
  blockedBy: DependencyLite[];
  blocks: DependencyLite[];
  risk: RiskAssessment | null;
}
export interface TaskEventDTO {
  id: string;
  type: EventType;
  /** Status values for flow events; stable user ids for assignment events. */
  fromValue: string | null;
  toValue: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  createdAt: string;
  actor: PersonLite | null;
}
export interface CommentDTO {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: PersonLite | null;
  mentions: PersonLite[];
}
export interface CommentThreadDTO extends CommentDTO {
  replies: CommentDTO[];
}
export interface CommentPageDTO {
  threads: CommentThreadDTO[];
  nextCursor: string | null;
}
export interface ActivityPageDTO {
  items: ActivityDTO[];
  nextCursor: string | null;
}
export interface NotificationPageDTO {
  items: NotificationDTO[];
  nextCursor: string | null;
  unreadCount: number;
}
export interface TaskDetailDTO extends TaskDTO {
  parent: DependencyLite | null;
  subtasks: TaskDTO[];
  events: TaskEventDTO[];
  comments: CommentDTO[];
}
export interface TaskPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}
export interface TaskPageDTO {
  tasks: TaskDTO[];
  pagination: TaskPagination;
}
export interface ActivityDTO {
  id: string;
  type: EventType;
  fromValue: string | null;
  toValue: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  createdAt: string;
  taskId: string;
  taskTitle: string;
  actor: PersonLite | null;
}
export interface NotificationDTO {
  id: string;
  kind: string;
  message: string;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
  actor: PersonLite | null;
}
export interface ViewConfig {
  q: string;
  projectId: string;
  assigneeId: string;
  priority: string;
  tag: string;
  sort: string;
  layout: "board" | "list";
}
export interface SavedViewDTO {
  id: string;
  name: string;
  config: ViewConfig;
}

/* ---------- analytics ---------- */
/** Sample statistics. Every value is null when count is 0 (no data is not zero). */
export interface StatSummary {
  count: number;
  mean: number | null;
  p50: number | null;
  p85: number | null;
  min: number | null;
  max: number | null;
}
export interface DailyPoint {
  date: string;
  completed: number;
  reopened: number;
  created: number;
  ewma: number;
}
export interface CfdPoint {
  date: string;
  backlog: number;
  todo: number;
  in_progress: number;
  review: number;
  done: number;
}
export interface MemberLoad {
  userId: string;
  name: string;
  avatarHue: number;
  active: number;
  wip: number;
  completed: number;
  overload: boolean;
}
export interface ForecastDTO {
  backlog: number;
  p50Daily: number;
  p85Daily: number;
  ewmaLast: number;
  optimisticDays: number;
  conservativeDays: number;
}
/** Deadline-risk model v2 result (see src/lib/risk/model.ts and RISK.md). */
import type {
  RiskResult as RiskAssessment,
  FactorResult as RiskFactor,
  RiskBand,
  RiskConfidence,
} from "@/lib/risk/model";
export type { RiskAssessment, RiskFactor, RiskBand, RiskConfidence };

export interface RiskItem {
  taskId: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  assignee: PersonLite | null;
  score: number;
  band: RiskBand;
  confidence: RiskConfidence;
  interval: { low: number; high: number };
  topFactor: string;
}
export interface AnalyticsDTO {
  days: number;
  from: string;
  to: string;
  alpha: number;
  daily: DailyPoint[];
  cfd: CfdPoint[];
  cycle: StatSummary;
  lead: StatSummary;
  cycleSamples: { id: string; title: string; days: number; points: number | null }[];
  onTime: { onTime: number; late: number; total: number; rate: number | null };
  wip: { total: number; limitPerMember: number };
  workload: MemberLoad[];
  forecast: ForecastDTO;
  totals: {
    completed: number;
    reopened: number;
    net: number;
    created: number;
    open: number;
    highRisk: number;
  };
  prev: { completed: number; net: number; cycleP50: number | null; onTimeRate: number | null };
  riskQueue: RiskItem[];
  riskDistribution: { low: number; medium: number; high: number };
  riskModel: { version: string; revision: number };
  cycleFallbackUsed: boolean;
}
/** AI insight contracts live in src/lib/ai/types (Phase 7); re-exported for UI imports. */
export type { InsightItem, InsightsDTO, InsightKind, InsightSeverity } from "@/lib/ai/types";