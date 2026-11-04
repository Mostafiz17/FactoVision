/**
 * Pure notification planning (no IO). The server persists what these functions
 * return; dedupe keys + a unique (user_id, dedupe_key) index make every planned
 * notification idempotent, so retries and repeated polls never duplicate.
 */
export type NotificationKind =
  | "assigned"
  | "mention"
  | "reply"
  | "comment"
  | "status"
  | "deadline_soon"
  | "overdue";

export const MAX_MENTIONS = 10;
export const DEADLINE_SOON_HOURS = 24;

export interface CommentRecipientInput {
  actorId: string;
  assigneeId: string | null;
  creatorId: string | null;
  /** Author of the parent comment when this comment is a reply. */
  parentAuthorId: string | null;
  mentionIds: readonly string[];
  /** Current workspace members — non-members are never notified. */
  memberIds: ReadonlySet<string>;
}

export interface PlannedRecipient {
  userId: string;
  kind: Extract<NotificationKind, "mention" | "reply" | "comment">;
}

const COMMENT_PRECEDENCE: Record<PlannedRecipient["kind"], number> = { mention: 3, reply: 2, comment: 1 };

/**
 * One notification per person per comment, with the most specific reason:
 * mention > reply (to their comment) > comment (on a task they own/were assigned).
 * The actor is never notified about their own comment.
 */
export function planCommentRecipients(input: CommentRecipientInput): PlannedRecipient[] {
  const best = new Map<string, PlannedRecipient["kind"]>();
  const offer = (userId: string | null, kind: PlannedRecipient["kind"]) => {
    if (!userId || userId === input.actorId || !input.memberIds.has(userId)) return;
    const current = best.get(userId);
    if (!current || COMMENT_PRECEDENCE[kind] > COMMENT_PRECEDENCE[current]) best.set(userId, kind);
  };
  for (const id of input.mentionIds) offer(id, "mention");
  offer(input.parentAuthorId, "reply");
  offer(input.assigneeId, "comment");
  offer(input.creatorId, "comment");
  return [...best.entries()]
    .map(([userId, kind]) => ({ userId, kind }))
    .sort((a, b) => COMMENT_PRECEDENCE[b.kind] - COMMENT_PRECEDENCE[a.kind] || a.userId.localeCompare(b.userId));
}

export interface DeadlineTaskInput {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  dueDate: Date | null;
}

export interface PlannedDeadlineAlert {
  taskId: string;
  userId: string;
  kind: Extract<NotificationKind, "deadline_soon" | "overdue">;
  dedupeKey: string;
  message: string;
}

/**
 * Deadline alerts for open, assigned tasks:
 * - overdue: dueDate < now
 * - deadline_soon: now ≤ dueDate ≤ now + windowHours
 * Keys embed the due instant, so moving a due date legitimately re-alerts,
 * while repeated sweeps for the same deadline are no-ops.
 */
export function planDeadlineAlerts(
  tasks: readonly DeadlineTaskInput[],
  now: Date,
  windowHours = DEADLINE_SOON_HOURS,
): PlannedDeadlineAlert[] {
  const horizon = now.getTime() + windowHours * 3_600_000;
  const out: PlannedDeadlineAlert[] = [];
  for (const t of tasks) {
    if (!t.dueDate || !t.assigneeId || t.status === "done") continue;
    const due = t.dueDate.getTime();
    if (due > horizon) continue;
    const kind = due < now.getTime() ? "overdue" : "deadline_soon";
    out.push({
      taskId: t.id,
      userId: t.assigneeId,
      kind,
      dedupeKey: `${kind}:${t.id}:${t.dueDate.toISOString()}`,
      message: kind === "overdue" ? `“${t.title}” is overdue` : `“${t.title}” is due within ${windowHours}h`,
    });
  }
  return out;
}

/**
 * Idempotency key for a comment's notifications. It depends on the *content and
 * the minute*, not on the new comment row id: a retried/duplicate POST then
 * cannot notify the same people twice (ON CONFLICT DO NOTHING). A deliberately
 * repeated identical comment in a later minute still notifies.
 * FNV-1a keeps this pure and portable (no node:crypto in the domain layer).
 */
export function commentDedupeKey(input: {
  taskId: string;
  actorId: string;
  parentId: string | null;
  body: string;
  at: Date;
}): string {
  const minute = Math.floor(input.at.getTime() / 60_000);
  const payload = `${input.taskId}\u0000${input.actorId}\u0000${input.parentId ?? ""}\u0000${input.body}\u0000${minute}`;
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `comment:${(hash >>> 0).toString(16)}:${minute}`;
}

/** Opaque keyset cursor over (createdAt DESC/ASC, id) — stable under concurrent inserts. */
export interface Cursor {
  createdAt: Date;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, "utf8").toString("base64url");
}

/** Returns null for any malformed cursor; callers translate that into a 400. */
export function decodeCursor(raw: string): Cursor | null {
  let text: string;
  try {
    text = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [iso, id, extra] = text.split("|");
  if (!iso || !id || extra !== undefined || !UUID_RE.test(id)) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return null;
  return { createdAt, id };
}