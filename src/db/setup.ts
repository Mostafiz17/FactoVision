import { isDeepStrictEqual } from "node:util";
import { MongoInitializationError } from "./errors";
import type { Db, IndexDescription } from "mongodb";
import type { Collections } from "./schema";

export const INDEXES: Record<keyof Collections, IndexDescription[]> = {
  users: [{ key: { email: 1 }, name: "users_email_unique", unique: true }],
  sessions: [{ key: { expiresAt: 1 }, name: "sessions_expiry", expireAfterSeconds: 0 }, { key: { userId: 1 } }],
  workspaces: [{ key: { slug: 1 }, name: "workspaces_slug_unique", unique: true }],
  memberships: [{ key: { workspaceId: 1, userId: 1 }, name: "memberships_workspace_user_unique", unique: true }, { key: { userId: 1, createdAt: 1 } }],
  projects: [{ key: { workspaceId: 1, createdAt: 1 } }],
  tasks: [
    { key: { workspaceId: 1, deletedAt: 1, status: 1, position: 1, createdAt: 1, id: 1 }, name: "tasks_board" },
    { key: { workspaceId: 1, projectId: 1, status: 1 } },
    { key: { workspaceId: 1, assigneeId: 1, dueDate: 1 } },
    { key: { workspaceId: 1, parentTaskId: 1, deletedAt: 1 } },
    { key: { workspaceId: 1, tags: 1 } },
  ],
  task_dependencies: [{ key: { workspaceId: 1, taskId: 1, dependsOnId: 1 }, unique: true, name: "dependencies_unique" }, { key: { workspaceId: 1, dependsOnId: 1 } }],
  task_events: [{ key: { workspaceId: 1, type: 1, createdAt: 1 }, name: "events_daily" }, { key: { workspaceId: 1, createdAt: -1, id: -1 } }, { key: { workspaceId: 1, taskId: 1, createdAt: -1, id: -1 } }],
  comments: [{ key: { workspaceId: 1, taskId: 1, parentCommentId: 1, createdAt: 1, id: 1 } }],
  notifications: [
    { key: { userId: 1, dedupeKey: 1 }, name: "notifications_dedupe", unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
    { key: { workspaceId: 1, userId: 1, createdAt: -1, id: -1 } },
    { key: { workspaceId: 1, userId: 1, readAt: 1 } },
  ],
  saved_views: [{ key: { workspaceId: 1, userId: 1, createdAt: 1 } }],
  risk_configs: [{ key: { workspaceId: 1 }, unique: true, name: "risk_workspace_unique" }],
};
const UUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const required: Record<keyof Collections, string[]> = {
  users: ["email", "name", "passwordHash"], sessions: ["userId", "expiresAt"], workspaces: ["name", "slug"],
  memberships: ["workspaceId", "userId", "role"], projects: ["workspaceId", "name", "key"],
  tasks: ["workspaceId", "projectId", "title", "status", "priority", "version"],
  task_dependencies: ["workspaceId", "taskId", "dependsOnId"], task_events: ["workspaceId", "taskId", "type"],
  comments: ["workspaceId", "taskId", "body"], notifications: ["workspaceId", "userId", "kind", "message"],
  saved_views: ["workspaceId", "userId", "name", "config"], risk_configs: ["workspaceId", "revision", "config", "modelVersion"],
};
function collectionValidator(name: keyof Collections) {
  const properties: Record<string, unknown> = {
    _id: { bsonType: "string", pattern: name === "sessions" ? "^[0-9a-f]{64}$" : UUID },
    id: { bsonType: "string" }, createdAt: { bsonType: "date" },
  };
  for (const field of ["workspaceId", "userId", "projectId", "taskId", "dependsOnId", "assigneeId", "creatorId", "authorId", "actorId", "parentTaskId", "parentCommentId", "createdBy", "updatedBy"]) {
    properties[field] = { bsonType: ["string", "null"], pattern: UUID };
  }
  for (const field of ["dueDate", "startedAt", "completedAt", "deletedAt", "readAt"]) properties[field] = { bsonType: ["date", "null"] };
  for (const field of ["updatedAt", "statusSince"]) properties[field] = { bsonType: "date" };
  for (const field of required[name].filter((field) => /Id$/.test(field))) properties[field] = { bsonType: "string", pattern: UUID };
  if (name === "sessions") properties.expiresAt = { bsonType: "date" };
  if (name === "memberships") properties.role = { enum: ["owner", "admin", "project_manager", "member"] };
  if (name === "tasks") {
    properties.status = { enum: ["backlog", "todo", "in_progress", "review", "done"] };
    properties.priority = { enum: ["low", "medium", "high", "urgent"] };
    properties.version = { bsonType: ["int", "long", "double"], minimum: 0 };
    properties.tags = { bsonType: "array", items: { bsonType: "string" } };
  }
  return { $and: [{ $jsonSchema: { bsonType: "object", required: ["_id", "id", "createdAt", ...required[name]], properties } }, { $expr: { $eq: ["$_id", "$id"] } }] };
}

/** Existing schemas are never silently replaced. An empty, unvalidated collection
 * may receive the application's declared validator; populated collections need review.
 */
async function ensureCollection(db: Db, name: keyof Collections) {
  const validator = collectionValidator(name);
  let metadata = await db.listCollections({ name }, { nameOnly: false }).next();
  if (!metadata) {
    try { await db.createCollection(name, { validator }); return; }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 48)) throw error;
    }
    metadata = await db.listCollections({ name }, { nameOnly: false }).next();
    if (!metadata) throw new Error("Collection disappeared during initialization; retry setup.");
  }
  const options = metadata.options;
  const existingValidator = options?.validator ?? {};
  if (isDeepStrictEqual(existingValidator, validator)
    && (options?.validationLevel ?? "strict") === "strict"
    && (options?.validationAction ?? "error") === "error") return;

  const unvalidated = Object.keys(existingValidator).length === 0;
  if (unvalidated && await db.collection(name).countDocuments({}, { limit: 1 }) === 0) {
    await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
    return;
  }
  throw new Error("Existing collection schema differs from the application schema. Setup will not overwrite it; review an explicit schema migration.");
}

/** Additive setup only: no collection/index drops and no document writes. */
export async function setupDatabase(db: Db): Promise<void> {
  for (const name of Object.keys(INDEXES) as (keyof Collections)[]) {
    try {
      await ensureCollection(db, name);
      const expected: IndexDescription[] = [{ key: { id: 1 }, unique: true, name: "id_unique" }, ...INDEXES[name]];
      const actual = await db.collection(name).listIndexes().toArray();
      const missing = expected.filter((index) => !actual.some((existing) => sameIndex(existing, index)));
      if (missing.length) await db.collection(name).createIndexes(missing);
    } catch (error) { throw new MongoInitializationError("setup", name, error); }
  }
}

function sameIndex(actual: IndexDescription, expected: IndexDescription): boolean {
  return JSON.stringify(actual.key) === JSON.stringify(expected.key)
    && Boolean(actual.unique) === Boolean(expected.unique)
    && actual.expireAfterSeconds === expected.expireAfterSeconds
    && isDeepStrictEqual(actual.partialFilterExpression, expected.partialFilterExpression);
}

/** Application startup only verifies metadata; schema changes require db:setup. */
export async function verifyDatabase(db: Db): Promise<void> {
  for (const [name, indexes] of Object.entries(INDEXES)) {
    try {
      const actual = await db.collection(name).listIndexes().toArray();
      const expectedIndexes: IndexDescription[] = [{ key: { id: 1 }, unique: true }, ...indexes];
      for (const expected of expectedIndexes) {
        if (!actual.some((index) => sameIndex(index, expected))) {
          throw new Error("MongoDB indexes are missing or incompatible; run npm run db:setup");
        }
      }
    } catch (error) { throw new MongoInitializationError("verify", name, error); }
  }
}
