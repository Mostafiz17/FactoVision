import { encodeCursor } from "@/lib/domain/notifications";
import { cache } from "react";
import { store, memberUsers, insertNotifications, workspaceTransaction } from "@/db/repository";
import type { Filter, Sort } from "mongodb";
import type { DbMembership, DbTask } from "@/db/schema";
import { wouldCreateCycle, type Edge } from "@/lib/domain/graph";
import { workspaceRisk } from "@/server/modules/risk/service";
import { canTransition, normalizeLabels } from "@/lib/domain/lifecycle";
import type {
  CommentDTO,
  DependencyLite,
  EventType,
  PersonLite,
  RiskAssessment,
  TaskDetailDTO,
  TaskDTO,
  TaskEventDTO,
  TaskPageDTO,
  TaskPagination,
  TaskStatus,
} from "@/lib/domain/types";
import { ensureCan, requireMembership } from "@/server/auth/guard";
import type { Capability } from "@/server/auth/permissions";
import { ApiError } from "@/server/http";
import type { z } from "zod";
import type {
  taskBulkSchema,
  taskCreateSchema,
  taskDeleteSchema,
  taskListQuerySchema,
  taskPatchSchema,
} from "@/server/validation";

type TaskListQuery = z.infer<typeof taskListQuerySchema>;
type TaskPatch = z.infer<typeof taskPatchSchema>;

export async function listTaskLabels(userId: string, workspaceId: string): Promise<string[]> {
  await requireMembership(userId, workspaceId);
  const rows = await store.tasks.aggregate<{ label: string }>([
    { $match: { workspaceId, deletedAt: null } }, { $unwind: "$tags" },
    { $group: { _id: "$tags" } }, { $sort: { _id: 1 } }, { $project: { _id: 0, label: "$_id" } },
  ]);
  return rows.map((r) => r.label);
}

interface EventRow {
  workspaceId: string;
  taskId: string;
  actorId: string;
  type: EventType;
  fromValue?: string | null;
  toValue?: string | null;
  createdAt?: Date;
}

async function recordEvents(rows: EventRow[]): Promise<void> {
  if (rows.length) await store.taskEvents.insertMany(rows.map((r) => ({ ...r, createdAt: r.createdAt ?? new Date() })));
}

interface NotificationRow {
  workspaceId: string;
  userId: string;
  actorId: string;
  taskId: string;
  kind: string;
  message: string;
  /** Unique per (user, key): repeated writes of the same fact are no-ops. */
  dedupeKey: string;
}

async function notifyUsers(rows: NotificationRow[]): Promise<void> {
  await insertNotifications(rows.filter((r) => r.userId !== r.actorId));
}



async function memberMap(workspaceId: string): Promise<Map<string, PersonLite>> {
  return new Map((await memberUsers(workspaceId)).map(({ u }) => [u.id, { id: u.id, name: u.name, avatarHue: u.avatarHue }]));
}

/**
 * No task data leaves this service before its workspace membership is checked.
 * Cross-tenant IDs return the same 404 as nonexistent IDs.
 */
async function loadTask(userId: string, taskId: string, capability: Capability | null = null, allowDeleted = false): Promise<DbTask> {
  const task = await store.tasks.one({ id: taskId, ...(!allowDeleted ? { deletedAt: null } : {}) });
  if (!task) throw new ApiError(404, "Task not found");
  const membership = await requireMembership(userId, task.workspaceId);
  if (capability) ensureCan(membership.role, capability);
  return task;
}

/** Rechecks membership inside the workspace-serialized mutation transaction. */
async function lockAuthorizedTask(userId: string, taskId: string, allowDeleted: boolean, capability: Capability): Promise<{ task: DbTask; membershipRole: DbMembership["role"] }> {
  const task = await loadTask(userId, taskId, capability, allowDeleted);
  const membership = await requireMembership(userId, task.workspaceId);
  return { task, membershipRole: membership.role };
}

/** Risk results for the workspace's open tasks (model v2, shared with analytics and the dashboard). */
type RiskCtx = Map<string, RiskAssessment>;

const buildRiskContext = cache(async (workspaceId: string): Promise<RiskCtx> => {
  return (await workspaceRisk(workspaceId)).results;
});

interface DepIndex {
  blockedBy: Map<string, DependencyLite[]>;
  blocks: Map<string, DependencyLite[]>;
}

/** Every dependency read is explicitly workspace-scoped in the database. */
async function dependencyIndex(workspaceId: string, visibleIds?: string[]): Promise<DepIndex> {
  const blockedBy = new Map<string, DependencyLite[]>();
  const blocks = new Map<string, DependencyLite[]>();
  if (visibleIds?.length === 0) return { blockedBy, blocks };
  const rows = await store.taskDependencies.find({ workspaceId, ...(visibleIds ? { $or: [{ taskId: { $in: visibleIds } }, { dependsOnId: { $in: visibleIds } }] } : {}) });
  const endpointIds = [...new Set(rows.flatMap((r) => [r.taskId, r.dependsOnId]))];
  const byId = new Map((await store.tasks.find({ workspaceId, deletedAt: null, id: { $in: endpointIds } })).map((t) => [t.id, t]));
  for (const row of rows) {
    const blocked = byId.get(row.taskId), blocker = byId.get(row.dependsOnId);
    if (!blocked || !blocker) continue;
    const a = blockedBy.get(row.taskId) ?? [];
    a.push({ id: blocker.id, title: blocker.title, status: blocker.status });
    blockedBy.set(row.taskId, a);
    const b = blocks.get(row.dependsOnId) ?? [];
    b.push({ id: blocked.id, title: blocked.title, status: blocked.status });
    blocks.set(row.dependsOnId, b);
  }
  return { blockedBy, blocks };
}

interface SubtaskCounts {
  total: number;
  done: number;
}

async function subtaskCounts(workspaceId: string, parentIds: string[]): Promise<Map<string, SubtaskCounts>> {
  const result = new Map<string, SubtaskCounts>();
  if (!parentIds.length) return result;
  const rows = await store.tasks.aggregate<{ _id: { parentTaskId: string; status: TaskStatus }; total: number }>([
    { $match: { workspaceId, deletedAt: null, parentTaskId: { $in: parentIds } } },
    { $group: { _id: { parentTaskId: "$parentTaskId", status: "$status" }, total: { $sum: 1 } } },
  ]);
  for (const row of rows) {
    const current = result.get(row._id.parentTaskId) ?? { total: 0, done: 0 };
    current.total += row.total;
    if (row._id.status === "done") current.done += row.total;
    result.set(row._id.parentTaskId, current);
  }
  return result;
}

function toDTO(
  t: DbTask,
  members: Map<string, PersonLite>,
  deps: DepIndex,
  ctx: RiskCtx,
  children: Map<string, SubtaskCounts>,
): TaskDTO {
  const blockedBy = deps.blockedBy.get(t.id) ?? [];
  const risk = t.status === "done" || t.deletedAt ? null : (ctx.get(t.id) ?? null);
  const labels = t.tags;
  const childCounts = children.get(t.id) ?? { total: 0, done: 0 };
  return {
    id: t.id,
    projectId: t.projectId,
    parentTaskId: t.parentTaskId,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assignee: t.assigneeId ? (members.get(t.assigneeId) ?? null) : null,
    creatorId: t.creatorId,
    estimatePoints: t.estimatePoints,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    position: t.position,
    labels,
    tags: labels,
    revision: t.version,
    subtaskCount: childCounts.total,
    completedSubtaskCount: childCounts.done,
    startedAt: t.startedAt ? t.startedAt.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    statusSince: t.statusSince.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    blockedBy,
    blocks: deps.blocks.get(t.id) ?? [],
    risk,
  };
}

async function decorateTasks(workspaceId: string, rows: DbTask[], riskContext?: RiskCtx): Promise<TaskDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((t) => t.id);
  const [members, deps, ctx, children] = await Promise.all([
    memberMap(workspaceId),
    dependencyIndex(workspaceId, ids),
    riskContext ?? buildRiskContext(workspaceId),
    subtaskCounts(workspaceId, ids),
  ]);
  return rows.map((t) => toDTO(t, members, deps, ctx, children));
}

export async function listTasks(userId: string, workspaceId: string): Promise<TaskDTO[]> {
  await requireMembership(userId, workspaceId);
  return decorateTasks(workspaceId, await store.tasks.find({ workspaceId, deletedAt: null }, { sort: { position: 1, createdAt: 1 } }));
}

export function queryPredicates(query: TaskListQuery): Filter<DbTask> {
  const filter: Filter<DbTask> = { workspaceId: query.workspaceId, deletedAt: null };
  if (query.projectId) filter.projectId = query.projectId;
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.assigneeId) filter.assigneeId = query.assigneeId === "none" ? null : query.assigneeId;
  if (query.label) filter.tags = query.label.toLowerCase();
  if (query.q) {
    const expression = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ title: { $regex: expression, $options: "i" } }, { description: { $regex: expression, $options: "i" } }, { tags: { $regex: expression, $options: "i" } }];
  }
  return filter;
}

function listOrder(sort: TaskListQuery["sort"]): Sort {
  switch (sort) {
    case "due": return { dueDate: 1, position: 1, id: 1 };
    case "created": return { createdAt: -1, id: 1 };
    case "updated": return { updatedAt: -1, id: 1 };
    case "title": return { title: 1, id: 1 };
    default: return { position: 1, createdAt: 1, id: 1 };
  }
}

export async function listTaskPage(userId: string, query: TaskListQuery): Promise<TaskPageDTO> {
  await requireMembership(userId, query.workspaceId);
  const filter = queryPredicates(query);
  const total = await store.tasks.count(filter);
  if (query.sort === "risk") {
    const context = await buildRiskContext(query.workspaceId);
    const matches = await store.tasks.aggregate<{ id: string }>([{ $match: filter }, { $project: { _id: 0, id: 1 } }]);
    matches.sort((a, b) => (context.get(b.id)?.score ?? -1) - (context.get(a.id)?.score ?? -1) || a.id.localeCompare(b.id));
    const ids = matches.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((t) => t.id);
    const rows = await store.tasks.find({ workspaceId: query.workspaceId, id: { $in: ids } });
    const byId = new Map(rows.map((t) => [t.id, t]));
    const totalPages = Math.ceil(total / query.pageSize);
    return { tasks: await decorateTasks(query.workspaceId, ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), context), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages, hasMore: query.page < totalPages } };
  }
  // Mongo string ordering differs from the former enum ordering. Explicit ranks
  // preserve board columns and urgent > high > medium > low priority ordering.
  const order = query.sort === "priority" || query.sort === "position" || query.sort === "due";
  const rows = order ? await store.tasks.aggregate<DbTask>([
    { $match: filter },
    { $set: { sortRank: query.sort === "due" ? { $cond: [{ $eq: ["$dueDate", null] }, 1, 0] } : { $indexOfArray: [query.sort === "priority" ? ["urgent", "high", "medium", "low"] : ["backlog", "todo", "in_progress", "review", "done"], query.sort === "priority" ? "$priority" : "$status"] } } },
    { $sort: query.sort === "due" ? { sortRank: 1, dueDate: 1, position: 1, id: 1 } : query.sort === "priority" ? { sortRank: 1, position: 1, id: 1 } : { sortRank: 1, position: 1, createdAt: 1, id: 1 } },
    { $skip: (query.page - 1) * query.pageSize }, { $limit: query.pageSize },
    { $unset: ["_id", "sortRank"] },
  ]) : await store.tasks.find(filter, { sort: listOrder(query.sort), skip: (query.page - 1) * query.pageSize, limit: query.pageSize });
  const totalPages = Math.ceil(total / query.pageSize);
  const pagination: TaskPagination = { page: query.page, pageSize: query.pageSize, total, totalPages, hasMore: query.page < totalPages };
  return { tasks: await decorateTasks(query.workspaceId, rows), pagination };
}

function displayEventValue(
  type: EventType,
  value: string | null,
  members: Map<string, PersonLite>,
  taskTitles: Map<string, string>,
): string | null {
  if (value === null) return type === "assigned" ? "Unassigned" : type === "parent_changed" ? "No parent" : null;
  if (type === "assigned") return members.get(value)?.name ?? "Former member";
  if (type === "parent_changed") return taskTitles.get(value) ?? "Parent task";
  return value;
}

export async function getTaskDetail(userId: string, taskId: string): Promise<TaskDetailDTO> {
  const task = await loadTask(userId, taskId, null, true);
  const ws = task.workspaceId;
  const [subtasks, parentRows, eventRows, topComments] = await Promise.all([
    store.tasks.find({ workspaceId: ws, parentTaskId: taskId, deletedAt: null }, { sort: { position: 1, createdAt: 1 } }),
    task.parentTaskId ? store.tasks.find({ id: task.parentTaskId, workspaceId: ws }, { limit: 1 }) : Promise.resolve([]),
    store.taskEvents.find({ workspaceId: ws, taskId }, { sort: { createdAt: -1, id: -1 }, limit: 120 }),
    store.comments.find({ workspaceId: ws, taskId, parentCommentId: null }, { sort: { createdAt: 1, id: 1 }, limit: 21 }),
  ]);
  const roots = topComments.slice(0, 20);
  const replies = await store.comments.find({ workspaceId: ws, taskId, parentCommentId: { $in: roots.map((c) => c.id) } }, { sort: { createdAt: 1, id: 1 } });
  const commentRows = [...roots, ...replies];
  const lastComment = roots[roots.length - 1];
  const allRelevant = [task, ...subtasks];
  const visibleIds = allRelevant.map((t) => t.id);
  if (task.parentTaskId) visibleIds.push(task.parentTaskId);
  const [members, deps, ctx, counts] = await Promise.all([
    memberMap(ws),
    dependencyIndex(ws, visibleIds),
    buildRiskContext(ws),
    subtaskCounts(ws, visibleIds),
  ]);
  const taskTitles = new Map<string, string>([
    [task.id, task.title],
    ...subtasks.map((t) => [t.id, t.title] as const),
    ...parentRows.map((t) => [t.id, t.title] as const),
  ]);
  const base = toDTO(task, members, deps, ctx, counts);
  const commentsDTO: CommentDTO[] = commentRows.map((c) => ({
    id: c.id,
    parentId: c.parentCommentId,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    author: c.authorId ? (members.get(c.authorId) ?? null) : null,
    mentions: c.mentions.flatMap((id) => {
      const person = members.get(id);
      return person ? [person] : [];
    }),
  }));
  const events: TaskEventDTO[] = eventRows.map((e) => ({
    id: e.id,
    type: e.type,
    fromValue: e.fromValue,
    toValue: e.toValue,
    fromLabel: displayEventValue(e.type, e.fromValue, members, taskTitles),
    toLabel: displayEventValue(e.type, e.toValue, members, taskTitles),
    createdAt: e.createdAt.toISOString(),
    actor: e.actorId ? (members.get(e.actorId) ?? null) : null,
  }));
  const parentRow = parentRows[0];
  return {
    ...base,
    parent: parentRow ? { id: parentRow.id, title: parentRow.title, status: parentRow.status } : null,
    subtasks: subtasks.map((t) => toDTO(t, members, deps, ctx, counts)),
    events,
    comments: commentsDTO,
    commentsNextCursor: topComments.length > 20 && lastComment ? encodeCursor({ createdAt: lastComment.createdAt, id: lastComment.id }) : null,
  };
}

async function assertProject(workspaceId: string, projectId: string): Promise<void> {
  if (!await store.projects.one({ id: projectId, workspaceId })) throw new ApiError(400, "Project does not belong to this workspace");
}

async function assertAssignee(workspaceId: string, assigneeId: string | null): Promise<void> {
  if (assigneeId && !await store.memberships.one({ workspaceId, userId: assigneeId })) throw new ApiError(400, "Assignee must be a member of this workspace");
}

async function assertParentTask(workspaceId: string, projectId: string, parentTaskId: string | null, taskId?: string): Promise<void> {
  if (!parentTaskId) return;
  if (parentTaskId === taskId) throw new ApiError(400, "A task cannot be its own parent");
  const parent = await store.tasks.one({ id: parentTaskId, workspaceId, deletedAt: null });
  if (!parent) throw new ApiError(400, "Parent task must be an active task in this workspace");
  if (parent.projectId !== projectId) throw new ApiError(400, "Parent and subtask must belong to the same project");
  if (parent.parentTaskId !== null) throw new ApiError(400, "Subtasks can only be one level deep");
  if (taskId && await store.tasks.one({ workspaceId, parentTaskId: taskId, deletedAt: null })) throw new ApiError(400, "A task with subtasks cannot become a subtask");
}

export async function createTask(
  userId: string,
  input: z.infer<typeof taskCreateSchema>,
): Promise<TaskDTO> {
  const membership = await requireMembership(userId, input.workspaceId);
  ensureCan(membership.role, "task.create");
  await assertProject(input.workspaceId, input.projectId);
  await assertAssignee(input.workspaceId, input.assigneeId ?? null);
  await assertParentTask(input.workspaceId, input.projectId, input.parentTaskId ?? null);
  const now = new Date();
  const status: TaskStatus = input.status ?? "backlog";
  const labels = normalizeLabels(input.labels ?? input.tags ?? []);
  const dueDate = input.dueDate ? new Date(input.dueDate) : null;

  const task = await workspaceTransaction(input.workspaceId, async () => {
    const membership = await requireMembership(userId, input.workspaceId);
    ensureCan(membership.role, "task.create");
    await assertProject(input.workspaceId, input.projectId);
    await assertAssignee(input.workspaceId, input.assigneeId ?? null);
    await assertParentTask(input.workspaceId, input.projectId, input.parentTaskId ?? null);
    const siblings = await store.tasks.find({ workspaceId: input.workspaceId, status, deletedAt: null });
    const position = siblings.reduce((m, s) => Math.max(m, s.position), -1) + 1;
    const task = await store.tasks.insert({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        parentTaskId: input.parentTaskId ?? null,
        title: input.title,
        description: input.description ?? "",
        status,
        priority: input.priority ?? "medium",
        assigneeId: input.assigneeId ?? null,
        creatorId: userId,
        estimatePoints: input.estimatePoints ?? null,
        dueDate,
        position,
        tags: labels,
        version: 0,
        startedAt: status === "in_progress" || status === "review" || status === "done" ? now : null,
        completedAt: status === "done" ? now : null,
        statusSince: now,
        createdAt: now,
        updatedAt: now,
      });
    const events: EventRow[] = [
      { workspaceId: task.workspaceId, taskId: task.id, actorId: userId, type: "created", toValue: status, createdAt: now },
    ];
    if (status === "done") {
      events.push({ workspaceId: task.workspaceId, taskId: task.id, actorId: userId, type: "completed", fromValue: status, toValue: "done", createdAt: now });
    }
    if (task.assigneeId) {
      events.push({ workspaceId: task.workspaceId, taskId: task.id, actorId: userId, type: "assigned", toValue: task.assigneeId, createdAt: now });
    }
    if (task.parentTaskId) {
      events.push({ workspaceId: task.workspaceId, taskId: task.id, actorId: userId, type: "parent_changed", toValue: task.parentTaskId, createdAt: now });
    }
    await recordEvents(events);
    if (task.assigneeId) {
      await notifyUsers([
        { workspaceId: task.workspaceId, userId: task.assigneeId, actorId: userId, taskId: task.id, kind: "assigned", message: `assigned you “${task.title}”`, dedupeKey: `assigned:${task.id}:${task.assigneeId}:0` },
      ]);
    }
    return task;
  });
  const [dto] = await decorateTasks(task.workspaceId, [task]);
  return dto;
}

interface TransitionResult {
  updates: Partial<DbTask>;
  events: EventRow[];
}

/** Applies a validated lifecycle edge and keeps projection timestamps aligned with the event. */
function statusTransition(task: DbTask, to: TaskStatus, now: Date, actorId: string): TransitionResult {
  if (!canTransition(task.status, to) || task.status === to) {
    throw new ApiError(400, `Illegal task status transition: ${task.status} → ${to}`);
  }
  const updates: Partial<DbTask> = { status: to, statusSince: now };
  const event: EventRow = {
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorId,
    fromValue: task.status,
    toValue: to,
    createdAt: now,
    type: "status_changed",
  };
  if (to === "done") {
    updates.completedAt = now;
    updates.startedAt = task.startedAt ?? now;
    event.type = "completed";
  } else if (task.status === "done") {
    updates.completedAt = null;
    updates.startedAt = null;
    event.type = "reopened";
  } else {
    if (to === "in_progress" || to === "review") {
      updates.startedAt = task.startedAt ?? now;
    } else if (to === "todo") {
      updates.startedAt = null;
    }
  }
  return { updates, events: [event] };
}

async function reorderColumn(workspaceId: string, status: TaskStatus, taskId: string, index: number): Promise<void> {
  const rows = await store.tasks.find({ workspaceId, status, deletedAt: null }, { sort: { position: 1, createdAt: 1, id: 1 } });
  const ids = rows.map((r) => r.id).filter((id) => id !== taskId);
  ids.splice(Math.min(Math.max(0, index), ids.length), 0, taskId);
  const previous = new Map(rows.map((r) => [r.id, r]));
  for (let i = 0; i < ids.length; i++) {
    const old = previous.get(ids[i]);
    if (old?.position === i) continue;
    await store.tasks.update({ id: ids[i], workspaceId }, ids[i] === taskId ? { position: i } : { position: i, version: (old?.version ?? 0) + 1, updatedAt: new Date() });
  }
}

function toEventRow(
  task: DbTask,
  actorId: string,
  type: EventType,
  fromValue: string | null,
  toValue: string | null,
  now: Date,
): EventRow {
  return { workspaceId: task.workspaceId, taskId: task.id, actorId, type, fromValue, toValue, createdAt: now };
}

export async function updateTask(
  userId: string,
  taskId: string,
  input: TaskPatch,
): Promise<TaskDTO> {
  const original = await loadTask(userId, taskId, "task.update", true);
  if (original.version !== input.expectedVersion) {
    throw new ApiError(409, "Task changed since you opened it; refresh and retry");
  }
  const now = new Date();
  const result = await workspaceTransaction(original.workspaceId, async () => {
    const { task } = await lockAuthorizedTask(userId, taskId, true, "task.update");
    if (task.version !== input.expectedVersion) {
      throw new ApiError(409, "Task changed since you opened it; refresh and retry");
    }
    if (task.deletedAt && !input.restore) throw new ApiError(404, "Task not found");
    if (input.restore && !task.deletedAt) throw new ApiError(409, "Task is already active");

    const updates: Partial<DbTask> = { updatedAt: now, version: task.version + 1 };
    const events: EventRow[] = [];
    const notes: NotificationRow[] = [];
    const ev = (type: EventType, from: string | null, to: string | null) =>
      events.push(toEventRow(task, userId, type, from, to, now));

    if (input.restore && task.deletedAt) {
      await assertProject(task.workspaceId, input.projectId ?? task.projectId);
      await assertParentTask(task.workspaceId, input.projectId ?? task.projectId, input.parentTaskId !== undefined ? input.parentTaskId : task.parentTaskId, task.id);
      updates.deletedAt = null;
      ev("restored", null, null);
    }
    if (input.title !== undefined && input.title !== task.title) {
      updates.title = input.title;
      ev("edited", task.title, input.title);
    }
    if (input.description !== undefined && input.description !== task.description) {
      updates.description = input.description;
      ev("edited", "details", "details updated");
    }
    if (input.priority !== undefined && input.priority !== task.priority) {
      updates.priority = input.priority;
      ev("priority_changed", task.priority, input.priority);
    }
    if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId) {
      await assertAssignee(task.workspaceId, input.assigneeId);
      updates.assigneeId = input.assigneeId;
      ev("assigned", task.assigneeId, input.assigneeId);
      if (input.assigneeId) {
        notes.push({ workspaceId: task.workspaceId, userId: input.assigneeId, actorId: userId, taskId, kind: "assigned", message: `assigned you “${input.title ?? task.title}”`, dedupeKey: `assigned:${taskId}:${input.assigneeId}:${task.version + 1}` });
      }
    }
    if (input.dueDate !== undefined) {
      const next = input.dueDate ? new Date(input.dueDate) : null;
      if ((next?.getTime() ?? null) !== (task.dueDate?.getTime() ?? null)) {
        updates.dueDate = next;
        ev("due_changed", task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null, next ? next.toISOString().slice(0, 10) : null);
      }
    }
    if (input.estimatePoints !== undefined && input.estimatePoints !== task.estimatePoints) {
      updates.estimatePoints = input.estimatePoints;
      ev("estimate_changed", task.estimatePoints === null ? null : String(task.estimatePoints), input.estimatePoints === null ? null : String(input.estimatePoints));
    }
    const nextLabels = input.labels ?? input.tags;
    if (nextLabels !== undefined) {
      const labels = normalizeLabels(nextLabels);
      if (labels.join("\u0000") !== task.tags.join("\u0000")) {
        updates.tags = labels;
        ev("labels_changed", task.tags.join(", ") || null, labels.join(", ") || null);
      }
    }
    if (input.projectId !== undefined && input.projectId !== task.projectId) {
      await assertProject(task.workspaceId, input.projectId);
      if (task.parentTaskId) throw new ApiError(400, "Move a subtask by changing its parent project first");
      const children = await store.tasks.find({ workspaceId: task.workspaceId, parentTaskId: taskId, deletedAt: null }, { limit: 1 });
      if (children.length > 0) throw new ApiError(400, "Move or detach subtasks before changing this project's task");
      updates.projectId = input.projectId;
      ev("edited", "project", input.projectId);
    }
    if (input.parentTaskId !== undefined && input.parentTaskId !== task.parentTaskId) {
      const finalProjectId = updates.projectId ?? task.projectId;
      await assertParentTask(task.workspaceId, finalProjectId, input.parentTaskId, taskId);
      updates.parentTaskId = input.parentTaskId;
      ev("parent_changed", task.parentTaskId, input.parentTaskId);
    }
    if (input.status !== undefined && input.status !== task.status) {
      const { updates: statusUpdates, events: statusEvents } = statusTransition(task, input.status, now, userId);
      Object.assign(updates, statusUpdates);
      events.push(...statusEvents);
      const assigneeId = updates.assigneeId !== undefined ? updates.assigneeId : task.assigneeId;
      if (assigneeId) {
        notes.push({ workspaceId: task.workspaceId, userId: assigneeId, actorId: userId, taskId, kind: "status", message: `moved “${input.title ?? task.title}” to ${input.status.replace("_", " ")}`, dedupeKey: `status:${taskId}:${task.version + 1}` });
      }
    }

    const saved = await store.tasks.update({ id: taskId, workspaceId: task.workspaceId, version: input.expectedVersion }, updates);
    if (!saved) throw new ApiError(409, "Task changed concurrently; refresh and retry");
    await recordEvents(events);
    await notifyUsers(notes);

    if (input.position !== undefined || (input.status !== undefined && input.status !== task.status)) {
      const finalStatus = (updates.status ?? task.status) as TaskStatus;
      let requestedPosition = input.position;
      if (requestedPosition === undefined) {
        const rows = await store.tasks.find({ workspaceId: task.workspaceId, status: finalStatus, deletedAt: null });
        requestedPosition = Math.max(0, rows.reduce((m, r) => Math.max(m, r.position), -1));
      }
      await reorderColumn(task.workspaceId, finalStatus, taskId, requestedPosition);
    }
    return (await store.tasks.one({ id: taskId, workspaceId: task.workspaceId }))!;
  });
  const [dto] = await decorateTasks(result.workspaceId, [result]);
  return dto;
}

export async function deleteTask(userId: string, taskId: string, input: z.infer<typeof taskDeleteSchema>): Promise<{ revision: number }> {
  const original = await loadTask(userId, taskId, "task.delete");
  return workspaceTransaction(original.workspaceId, async () => {
    const task = await loadTask(userId, taskId, "task.delete");
    if (task.version !== input.expectedVersion) throw new ApiError(409, "Task changed since you opened it; refresh and retry");
    const now = new Date();
    const saved = await store.tasks.update({ id: taskId, workspaceId: task.workspaceId, version: input.expectedVersion }, { deletedAt: now, updatedAt: now, version: task.version + 1 });
    if (!saved) throw new ApiError(409, "Task changed concurrently; refresh and retry");
    await recordEvents([toEventRow(task, userId, "deleted", null, null, now)]);
    return { revision: saved.version };
  });
}

export async function bulkAction(
  userId: string,
  input: z.infer<typeof taskBulkSchema>,
): Promise<{ affected: number; expected: { id: string; revision: number }[] }> {
  const membership = await requireMembership(userId, input.workspaceId);
  ensureCan(membership.role, "task.bulk");
  const revisions = new Map((input.expected ?? []).map((entry) => [entry.id, entry.revision]));
  if (input.ids.some((id) => !revisions.has(id))) {
    throw new ApiError(428, "Task revisions are required for a concurrency-safe bulk action");
  }
  if (input.action === "assign") await assertAssignee(input.workspaceId, input.assigneeId ?? null);
  const now = new Date();
  return workspaceTransaction(input.workspaceId, async () => {
    const membership = await requireMembership(userId, input.workspaceId);
    ensureCan(membership.role, "task.bulk");
    if (input.action === "assign") await assertAssignee(input.workspaceId, input.assigneeId ?? null);
    let affected = 0;
    const expected: { id: string; revision: number }[] = [];
    for (const id of input.ids) {
      const task = await store.tasks.one({ id, workspaceId: input.workspaceId });
      if (!task) continue;
      if (task.version !== revisions.get(id)) throw new ApiError(409, `Task ${id} changed concurrently; refresh and retry`);
      const events: EventRow[] = [];
      let updates: Partial<DbTask> | null = null;
      if (input.action === "delete" && !task.deletedAt) {
        updates = { deletedAt: now };
        events.push(toEventRow(task, userId, "deleted", null, null, now));
      } else if (input.action === "restore" && task.deletedAt) {
        await assertProject(task.workspaceId, task.projectId);
        await assertParentTask(task.workspaceId, task.projectId, task.parentTaskId, task.id);
        updates = { deletedAt: null };
        events.push(toEventRow(task, userId, "restored", null, null, now));
      } else if (input.action === "status" && input.status && input.status !== task.status && !task.deletedAt) {
        const transition = statusTransition(task, input.status, now, userId);
        updates = transition.updates;
        events.push(...transition.events);
      } else if (input.action === "assign" && input.assigneeId !== undefined && input.assigneeId !== task.assigneeId && !task.deletedAt) {
        updates = { assigneeId: input.assigneeId };
        events.push(toEventRow(task, userId, "assigned", task.assigneeId, input.assigneeId, now));
      }
      if (!updates) continue;
      const saved = await store.tasks.update({ id, workspaceId: input.workspaceId, version: task.version }, { ...updates, updatedAt: now, version: task.version + 1 });
      if (!saved) throw new ApiError(409, "Task changed concurrently; refresh and retry");
      await recordEvents(events);
      const recipient = updates.assigneeId !== undefined ? updates.assigneeId : task.assigneeId;
      if (recipient && (input.action === "assign" || input.action === "status")) {
        await notifyUsers([{ workspaceId: task.workspaceId, userId: recipient, actorId: userId, taskId: id,
          kind: input.action === "assign" ? "assigned" : "status",
          message: input.action === "assign" ? 'assigned you “' + task.title + '”' : 'moved “' + task.title + '” to ' + input.status?.replace("_", " "),
          dedupeKey: input.action === "assign" ? 'assigned:' + id + ':' + recipient + ':' + saved.version : 'status:' + id + ':' + saved.version }]);
      }
      expected.push({ id, revision: task.version + 1 });
      affected++;
    }
    return { affected, expected };
  });
}

export async function addDependency(userId: string, taskId: string, dependsOnId: string): Promise<void> {
  const original = await loadTask(userId, taskId, "task.dependency");
  await workspaceTransaction(original.workspaceId, async () => {
    const task = await loadTask(userId, taskId, "task.dependency");
    const dependency = await loadTask(userId, dependsOnId, "task.dependency");
    if (dependency.workspaceId !== task.workspaceId) throw new ApiError(400, "Dependencies must stay inside the workspace");
    const existing = await store.taskDependencies.find({ workspaceId: task.workspaceId });
    const edges: Edge[] = existing.map((e) => ({ from: e.taskId, to: e.dependsOnId }));
    if (edges.some((e) => e.from === taskId && e.to === dependsOnId)) return;
    if (wouldCreateCycle(edges, { from: taskId, to: dependsOnId })) throw new ApiError(400, "That dependency would create a cycle");
    await store.taskDependencies.insert({ workspaceId: task.workspaceId, taskId, dependsOnId });
    await recordEvents([toEventRow(task, userId, "dependency_added", null, dependency.title, new Date())]);
  });
}

export async function removeDependency(userId: string, taskId: string, dependsOnId: string): Promise<void> {
  const original = await loadTask(userId, taskId, "task.dependency");
  await workspaceTransaction(original.workspaceId, async () => {
    const task = await loadTask(userId, taskId, "task.dependency");
    const dependency = await loadTask(userId, dependsOnId, "task.dependency");
    if (dependency.workspaceId !== task.workspaceId) throw new ApiError(400, "Dependencies must stay inside the workspace");
    const removed = await store.taskDependencies.remove({ workspaceId: task.workspaceId, taskId, dependsOnId });
    if (removed) await recordEvents([toEventRow(task, userId, "dependency_removed", dependency.title, null, new Date())]);
  });
}

// Comments, replies and mention notifications live in modules/collaboration (Phase 4).
