import type { Filter } from "mongodb";
import { memberUsers, store, workspaceTransaction, insertNotifications } from "@/db/repository";
import type { DbComment, DbNotification, DbTask, DbTaskEvent } from "@/db/schema";
import { commentDedupeKey, decodeCursor, encodeCursor, planCommentRecipients, planDeadlineAlerts, DEADLINE_SOON_HOURS, type Cursor } from "@/lib/domain/notifications";
import type { ActivityDTO, ActivityPageDTO, CommentDTO, CommentPageDTO, CommentThreadDTO, NotificationDTO, NotificationPageDTO, PersonLite } from "@/lib/domain/types";
import { ensureCan, requireMembership } from "@/server/auth/guard";
import type { Capability } from "@/server/auth/permissions";
import { ApiError } from "@/server/http";

function parseCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined) return null;
  const c = decodeCursor(raw);
  if (!c) throw new ApiError(400, "Invalid pagination cursor");
  return c;
}
/** Millisecond Date + UUID tie-breaker preserves the existing cursor contract. */
function cursorFilter(cursor: Cursor, direction: "older" | "newer") {
  const op = direction === "older" ? "$lt" : "$gt";
  return { $or: [{ createdAt: { [op]: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { [op]: cursor.id } }] };
}
async function memberMap(workspaceId: string): Promise<Map<string, PersonLite>> {
  return new Map((await memberUsers(workspaceId)).map(({ u }) => [u.id, { id: u.id, name: u.name, avatarHue: u.avatarHue }]));
}
async function authorizeTask(userId: string, taskId: string, capability: Capability | null): Promise<DbTask> {
  const task = await store.tasks.one({ id: taskId, deletedAt: null });
  if (!task) throw new ApiError(404, "Task not found");
  const membership = await requireMembership(userId, task.workspaceId);
  if (capability) ensureCan(membership.role, capability);
  return task;
}
function toCommentDTO(c: DbComment, members: Map<string, PersonLite>): CommentDTO {
  return { id: c.id, parentId: c.parentCommentId, body: c.body, createdAt: c.createdAt.toISOString(),
    author: c.authorId ? members.get(c.authorId) ?? null : null,
    mentions: c.mentions.flatMap((id) => { const p = members.get(id); return p ? [p] : []; }) };
}
export interface AddCommentInput { body: string; parentId?: string | null; mentionIds: string[] }
export async function addComment(userId: string, taskId: string, input: AddCommentInput): Promise<CommentDTO> {
  const original = await authorizeTask(userId, taskId, "task.comment");
  return workspaceTransaction(original.workspaceId, async () => {
    const task = await authorizeTask(userId, taskId, "task.comment");
    const members = await memberMap(task.workspaceId);
    const mentionIds = [...new Set(input.mentionIds)];
    if (mentionIds.some((id) => !members.has(id))) throw new ApiError(400, "Mentions must reference members of this workspace");
    const parentId = input.parentId ?? null;
    let parentAuthorId: string | null = null;
    if (parentId) {
      const parent = await store.comments.one({ id: parentId, workspaceId: task.workspaceId, taskId });
      if (!parent) throw new ApiError(400, "Reply target must be a comment on this task");
      if (parent.parentCommentId) throw new ApiError(400, "Replies are one level deep ? reply to the top-level comment");
      parentAuthorId = parent.authorId;
    }
    const now = new Date();
    const row = await store.comments.insert({ workspaceId: task.workspaceId, taskId, authorId: userId, parentCommentId: parentId, mentions: mentionIds, body: input.body, createdAt: now });
    await store.taskEvents.insert({ workspaceId: task.workspaceId, taskId, actorId: userId, type: "commented", fromValue: parentId ? "reply" : null, toValue: input.body.slice(0, 80), createdAt: now });
    const recipients = planCommentRecipients({ actorId: userId, assigneeId: task.assigneeId, creatorId: task.creatorId, parentAuthorId, mentionIds, memberIds: new Set(members.keys()) });
    const verb = { mention: "mentioned you in", reply: "replied to your comment on", comment: "commented on" } as const;
    await insertNotifications(recipients.map((r) => ({
      workspaceId: task.workspaceId, userId: r.userId, actorId: userId, taskId, kind: r.kind,
      message: verb[r.kind] + " ?" + task.title + "?",
      dedupeKey: commentDedupeKey({ taskId, actorId: userId, parentId, body: input.body, at: now }), createdAt: now,
    })));
    return toCommentDTO(row, members);
  });
}
export async function listComments(userId: string, taskId: string, page: { cursor?: string; limit: number }): Promise<CommentPageDTO> {
  const task = await authorizeTask(userId, taskId, null);
  const cursor = parseCursor(page.cursor);
  const filter: Filter<DbComment> = { workspaceId: task.workspaceId, taskId, parentCommentId: null, ...(cursor ? cursorFilter(cursor, "newer") : {}) };
  const tops = await store.comments.find(filter, { sort: { createdAt: 1, id: 1 }, limit: page.limit + 1 });
  const pageRows = tops.slice(0, page.limit);
  const replies = await store.comments.find({ workspaceId: task.workspaceId, taskId, parentCommentId: { $in: pageRows.map((c) => c.id) } }, { sort: { createdAt: 1, id: 1 } });
  const members = await memberMap(task.workspaceId);
  const threads: CommentThreadDTO[] = pageRows.map((c) => ({ ...toCommentDTO(c, members), replies: replies.filter((r) => r.parentCommentId === c.id).map((r) => toCommentDTO(r, members)) }));
  const last = pageRows[pageRows.length - 1];
  return { threads, nextCursor: tops.length > page.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null };
}
export interface ActivityQuery { workspaceId: string; projectId?: string; taskId?: string; cursor?: string; limit: number }
export async function listActivityPage(userId: string, q: ActivityQuery): Promise<ActivityPageDTO> {
  const membership = await requireMembership(userId, q.workspaceId);
  ensureCan(membership.role, "analytics.read");
  if (q.projectId && !await store.projects.one({ id: q.projectId, workspaceId: q.workspaceId })) throw new ApiError(404, "Project not found");
  const cursor = parseCursor(q.cursor);
  const filter: Filter<DbTaskEvent> = { workspaceId: q.workspaceId, ...(q.taskId ? { taskId: q.taskId } : {}), ...(cursor ? cursorFilter(cursor, "older") : {}) };
  const rows = await store.taskEvents.aggregate<{ e: DbTaskEvent; taskTitle: string }>([
    { $match: filter },
    { $lookup: { from: "tasks", let: { taskId: "$taskId" }, pipeline: [
      { $match: { workspaceId: q.workspaceId, ...(q.projectId ? { projectId: q.projectId } : {}), $expr: { $eq: ["$id", "$$taskId"] } } },
      { $project: { title: 1 } },
    ], as: "task" } },
    { $unwind: "$task" }, { $sort: { createdAt: -1, id: -1 } }, { $limit: q.limit + 1 },
    { $project: { _id: 0, e: "$$ROOT", taskTitle: "$task.title" } },
  ]);
  const pageRows = rows.slice(0, q.limit);
  const members = await memberMap(q.workspaceId);
  const label = (type: string, v: string | null) => type === "assigned" ? (v ? members.get(v)?.name ?? v : "Unassigned") : v;
  const items: ActivityDTO[] = pageRows.map(({ e, taskTitle }) => ({
    id: e.id, type: e.type, fromValue: e.fromValue, toValue: e.toValue, fromLabel: label(e.type, e.fromValue), toLabel: label(e.type, e.toValue),
    createdAt: e.createdAt.toISOString(), taskId: e.taskId, taskTitle, actor: e.actorId ? members.get(e.actorId) ?? null : null,
  }));
  const last = pageRows[pageRows.length - 1];
  return { items, nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.e.createdAt, id: last.e.id }) : null };
}
export async function listActivity(userId: string, workspaceId: string, limit = 80): Promise<ActivityDTO[]> {
  return (await listActivityPage(userId, { workspaceId, limit: Math.min(100, limit) })).items;
}
export async function runDeadlineSweep(userId: string, workspaceId: string, now = new Date()): Promise<number> {
  return workspaceTransaction(workspaceId, async () => {
    await requireMembership(userId, workspaceId);
    const horizon = new Date(now.getTime() + DEADLINE_SOON_HOURS * 3_600_000);
    const due = await store.tasks.find({ workspaceId, assigneeId: userId, deletedAt: null, status: { $ne: "done" }, dueDate: { $ne: null, $lte: horizon } });
    return insertNotifications(planDeadlineAlerts(due, now).map((a) => ({ workspaceId, userId: a.userId, actorId: null, taskId: a.taskId, kind: a.kind, message: a.message, dedupeKey: a.dedupeKey, createdAt: now })));
  });
}
export interface NotificationQuery { workspaceId: string; cursor?: string; limit: number; unreadOnly: boolean }
export async function listNotificationPage(userId: string, q: NotificationQuery): Promise<NotificationPageDTO> {
  await requireMembership(userId, q.workspaceId);
  const cursor = parseCursor(q.cursor);
  try { await runDeadlineSweep(userId, q.workspaceId); } catch { console.error("[notifications] deadline sweep failed"); }
  const scope = { workspaceId: q.workspaceId, userId };
  const filter: Filter<DbNotification> = { ...scope, ...(q.unreadOnly ? { readAt: null } : {}), ...(cursor ? cursorFilter(cursor, "older") : {}) };
  const rows = await store.notifications.find(filter, { sort: { createdAt: -1, id: -1 }, limit: q.limit + 1 });
  const unreadCount = await store.notifications.count({ ...scope, readAt: null });
  const pageRows = rows.slice(0, q.limit);
  const actors = await store.users.find({ id: { $in: pageRows.flatMap((r) => r.actorId ? [r.actorId] : []) } });
  const items: NotificationDTO[] = pageRows.map((r) => {
    const actor = actors.find((a) => a.id === r.actorId);
    return { id: r.id, kind: r.kind, message: r.message, taskId: r.taskId, readAt: r.readAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), actor: actor ? { id: actor.id, name: actor.name, avatarHue: actor.avatarHue } : null };
  });
  const last = pageRows[pageRows.length - 1];
  return { items, nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null, unreadCount };
}
export async function listNotifications(userId: string, workspaceId: string): Promise<NotificationDTO[]> {
  return (await listNotificationPage(userId, { workspaceId, limit: 20, unreadOnly: false })).items;
}
export async function setReadState(userId: string, workspaceId: string, ids: string[] | undefined, read: boolean): Promise<{ updated: number }> {
  return workspaceTransaction(workspaceId, async () => {
    await requireMembership(userId, workspaceId);
    const filter: Filter<DbNotification> = { workspaceId, userId, readAt: read ? null : { $ne: null }, ...(ids?.length ? { id: { $in: ids } } : {}) };
    return { updated: await store.notifications.updateMany(filter, { readAt: read ? new Date() : null }) };
  });
}
