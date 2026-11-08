import { z } from "zod";
import { PRIORITIES, STATUSES } from "@/lib/domain/types";
import { isValidTimeZone } from "@/lib/analytics";

const uuid = z.string().uuid();
const email = z.string().trim().toLowerCase().email().max(254);
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().max(8000);

export const registerSchema = z.object({
  email,
  name: shortText,
  password: z.string().min(8).max(128),
  workspaceName: z.string().trim().min(1).max(80).optional(),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });

export const workspaceCreateSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const workspacePatchSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const memberInviteSchema = z.object({
  email,
  name: z.string().trim().min(1).max(80).optional(),
  // "owner" is intentionally not assignable — ownership transfers are out of scope.
  role: z.enum(["admin", "project_manager", "member"]),
});
export const memberPatchSchema = z.object({
  userId: uuid,
  role: z.enum(["admin", "project_manager", "member"]),
});
export const memberRemoveSchema = z.object({ userId: uuid });

export const projectCreateSchema = z.object({
  workspaceId: uuid,
  name: shortText,
  key: z.string().trim().min(2).max(6).toUpperCase().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: longText.optional(),
});
export const projectPatchSchema = z.object({
  name: shortText.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  description: longText.optional(),
  archived: z.boolean().optional(),
});

const isoDate = z.string().datetime({ offset: true }).or(z.iso.date());

const labelArray = z.array(z.string().trim().min(1).max(32)).max(8);
const revision = z.number().int().min(0).max(2_147_483_646);

export const taskCreateSchema = z.object({
  workspaceId: uuid,
  projectId: uuid,
  parentTaskId: uuid.nullable().optional(),
  title: shortText,
  description: longText.optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: uuid.nullable().optional(),
  estimatePoints: z.number().min(0).max(100).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  labels: labelArray.optional(),
  /** Deprecated API alias; labels is canonical. */
  tags: labelArray.optional(),
}).refine((x) => x.labels === undefined || x.tags === undefined, {
  message: "Use labels; do not send both labels and tags",
  path: ["labels"],
});

export const taskPatchSchema = z.object({
  expectedVersion: revision,
  title: shortText.optional(),
  description: longText.optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: uuid.nullable().optional(),
  estimatePoints: z.number().min(0).max(100).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  labels: labelArray.optional(),
  /** Deprecated API alias; labels is canonical. */
  tags: labelArray.optional(),
  projectId: uuid.optional(),
  parentTaskId: uuid.nullable().optional(),
  position: z.number().int().min(0).max(10000).optional(),
  restore: z.boolean().optional(),
}).refine((x) => x.labels === undefined || x.tags === undefined, {
  message: "Use labels; do not send both labels and tags",
  path: ["labels"],
});

export const taskDeleteSchema = z.object({ expectedVersion: revision });

export const taskBulkSchema = z.object({
  workspaceId: uuid,
  ids: z.array(uuid).min(1).max(100),
  action: z.enum(["status", "assign", "delete", "restore"]),
  expected: z.array(z.object({ id: uuid, revision })).min(1).max(100).optional(),
  status: z.enum(STATUSES).optional(),
  assigneeId: uuid.nullable().optional(),
});

export const taskListQuerySchema = z.object({
  workspaceId: uuid,
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(200).default(""),
  projectId: uuid.optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: uuid.or(z.literal("none")).optional(),
  label: z.string().trim().min(1).max(32).optional(),
  sort: z.enum(["position", "due", "priority", "created", "updated", "title", "risk"]).default("position"),
});

export const dependencySchema = z.object({ dependsOnId: uuid });
export const commentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  parentId: uuid.nullable().optional(),
  mentionIds: z.array(uuid).max(10).default([]),
});

const cursorParam = z.string().min(1).max(200).optional();
const pageLimit = (max: number, dflt: number) => z.coerce.number().int().min(1).max(max).default(dflt);

export const commentListQuerySchema = z.object({ cursor: cursorParam, limit: pageLimit(50, 20) });

export const activityQuerySchema = z.object({
  workspaceId: uuid,
  projectId: uuid.optional(),
  taskId: uuid.optional(),
  cursor: cursorParam,
  limit: pageLimit(100, 30),
});

export const notificationsQuerySchema = z.object({
  workspaceId: uuid,
  cursor: cursorParam,
  limit: pageLimit(50, 20),
  unreadOnly: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export const viewConfigSchema = z.object({
  q: z.string().max(200),
  projectId: z.string().max(64),
  assigneeId: z.string().max(64),
  priority: z.string().max(16),
  tag: z.string().max(32),
  sort: z.string().max(24),
  layout: z.enum(["board", "list"]),
});
export const viewCreateSchema = z.object({
  workspaceId: uuid,
  name: z.string().trim().min(1).max(40),
  config: viewConfigSchema,
});
export const viewDeleteSchema = z.object({ workspaceId: uuid, id: uuid });

export const analyticsQuerySchema = z.object({
  workspaceId: uuid,
  days: z.coerce.number().int().min(7).max(120).default(30),
});

export const notificationsPatchSchema = z.object({
  workspaceId: uuid,
  ids: z.array(uuid).max(100).optional(), // omitted ⇒ applies to all of the caller's notifications
  read: z.boolean().default(true), // false ⇒ mark unread
});

export const analyticsReportQuerySchema = z.object({
  workspaceId: uuid,
  days: z.coerce.number().int().min(1).max(366).default(30),
  tz: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .default("UTC")
    .refine(isValidTimeZone, { message: "tz must be an IANA time zone such as Europe/Berlin" }),
  asOf: z.string().datetime({ offset: true }).optional(),
  projectId: uuid.optional(),
  assigneeId: uuid.or(z.literal("none")).optional(),
  priority: z.enum(PRIORITIES).optional(),
  label: z.string().trim().min(1).max(32).optional(),
});

export const aiInsightsSchema = analyticsReportQuerySchema.omit({ asOf: true }).extend({ days: z.number().int().min(1).max(366).default(30) });
