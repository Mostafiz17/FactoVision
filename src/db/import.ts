import { randomUUID } from "node:crypto";
import { getDatabase, sessionOptions, withTransaction } from ".";
import { repository } from "./repository";
import { INDEXES } from "./setup";
import type { Collections } from "./schema";
import { wouldCreateCycle, type Edge } from "@/lib/domain/graph";

type Snapshot = Record<keyof Collections, Record<string, unknown>[]>;
const names = Object.keys(INDEXES) as (keyof Collections)[];
const dates = new Set(["createdAt", "updatedAt", "expiresAt", "dueDate", "startedAt", "completedAt", "statusSince", "deletedAt", "readAt"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Offline snapshot adapter: accepts snake_case legacy keys or camelCase keys.
 * No database access, passwords are already hashes, IDs are never remapped.
 */
export function normalizeSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an object containing all collection arrays");
  const source = input as Record<string, unknown>;
  const result = {} as Snapshot;
  for (const name of names) {
    const rows = source[name];
    if (!Array.isArray(rows)) throw new Error("Snapshot must include array: " + name);
    result[name] = rows.map((raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid document in " + name);
      const row: Record<string, unknown> = {};
      for (const [key, original] of Object.entries(raw)) {
        const field = key === "_id" ? key : key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
        if (key.startsWith("$") || key.includes(".") || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid document field");
        if (Object.hasOwn(row, field)) throw new Error("Duplicate normalized field");
        let value = original;
        if (dates.has(field) && value !== null) {
          if (typeof value !== "string" && !(value instanceof Date)) throw new Error("Expected date: " + field);
          value = new Date(value);
          if (Number.isNaN((value as Date).getTime())) throw new Error("Invalid date: " + field);
        }
        row[field] = value;
      }
      if (name === "task_dependencies" && !row.id) row.id = randomUUID();
      if (name === "risk_configs" && !row.id) row.id = row.workspaceId;
      if (name === "risk_configs" && !row.createdAt) row.createdAt = row.updatedAt;
      const pattern = name === "sessions" ? /^[0-9a-f]{64}$/ : uuid;
      if (typeof row.id !== "string" || !pattern.test(row.id)) throw new Error("Invalid ID in " + name);
      if (!(row.createdAt instanceof Date)) throw new Error("Missing createdAt in " + name);
      if (row._id !== undefined && row._id !== row.id) throw new Error("ID mismatch in " + name);
      delete row._id;
      return row;
    });
    if (new Set(result[name].map((row) => row.id)).size !== rows.length) throw new Error("Duplicate IDs in " + name);
  }
  const byId = (name: keyof Collections, id: unknown) => result[name].find((row) => row.id === id);
  const references: Record<string, keyof Collections> = {
    userId: "users", assigneeId: "users", creatorId: "users", authorId: "users", actorId: "users", createdBy: "users", updatedBy: "users",
    workspaceId: "workspaces", projectId: "projects", taskId: "tasks", dependsOnId: "tasks", parentTaskId: "tasks", parentCommentId: "comments",
  };
  for (const [name, rows] of Object.entries(result)) for (const row of rows) {
    for (const [field, target] of Object.entries(references)) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      const referenced = byId(target, value);
      if (!referenced) throw new Error("Dangling " + field + " in " + name);
      if (row.workspaceId && referenced.workspaceId && referenced.workspaceId !== row.workspaceId) throw new Error("Cross-workspace reference in " + name);
    }
    if (Array.isArray(row.mentions) && row.mentions.some((id) => !byId("users", id))) throw new Error("Dangling comment mention");
  }
  for (const workspace of result.workspaces) {
    const owners = result.memberships.filter((m) => m.workspaceId === workspace.id && m.role === "owner");
    if (owners.length !== 1) throw new Error("Each workspace must have exactly one owner");
    const edges: Edge[] = [];
    for (const row of result.task_dependencies.filter((edge) => edge.workspaceId === workspace.id)) {
      const edge = { from: String(row.taskId), to: String(row.dependsOnId) };
      if (wouldCreateCycle(edges, edge)) throw new Error("Dependency cycle in snapshot");
      edges.push(edge);
    }
  }
  for (const task of result.tasks) if (task.parentTaskId) {
    const parent = byId("tasks", task.parentTaskId)!;
    if (parent.id === task.id || parent.parentTaskId || parent.projectId !== task.projectId) throw new Error("Invalid subtask hierarchy");
  }
  for (const comment of result.comments) if (comment.parentCommentId) {
    const parent = byId("comments", comment.parentCommentId)!;
    if (parent.parentCommentId || parent.taskId !== comment.taskId) throw new Error("Invalid comment thread");
  }
  return result;
}

/** Explicit apply only, empty target only, one transaction. Never dual-writes. */
export async function importSnapshot(snapshot: Snapshot): Promise<void> {
  await withTransaction(async () => {
    const database = await getDatabase();
    await database.collection<{ _id: string; revision: number }>("_bootstrap").updateOne(
      { _id: "snapshot-import" }, { $inc: { revision: 1 } }, { ...sessionOptions(), upsert: true },
    );
    for (const name of names) if (await repository(name).count({}) > 0) throw new Error("Import requires an empty target database");
    for (const name of names) await repository(name).insertMany(snapshot[name]);
  });
}
