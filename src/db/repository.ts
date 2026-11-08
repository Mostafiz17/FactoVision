import { randomUUID } from "node:crypto";
import type { Document, Filter, OptionalUnlessRequiredId, Sort, UpdateFilter } from "mongodb";
import { getDatabase, sessionOptions, withTransaction } from ".";
import type { Collections, Entity } from "./schema";
import { ApiError } from "@/lib/domain/errors";

type Stored<T> = T & { _id: string };
const defaults = {
  invitations: {}, auth_limits: {},
  users: { avatarHue: 258 }, workspaces: { createdBy: null, mutationVersion: 0 }, memberships: { role: "member" },
  projects: { color: "#7c5cff", description: "", archived: 0 },
  tasks: { description: "", status: "backlog", priority: "medium", assigneeId: null, creatorId: null, parentTaskId: null, estimatePoints: null, dueDate: null, position: 0, tags: [], version: 0, startedAt: null, completedAt: null, deletedAt: null },
  task_events: { actorId: null, fromValue: null, toValue: null },
  comments: { authorId: null, parentCommentId: null, mentions: [] },
  notifications: { actorId: null, taskId: null, dedupeKey: null, readAt: null },
  sessions: {}, task_dependencies: {}, saved_views: {}, risk_configs: {},
};
function withoutMongoId<T extends Entity>(row: Stored<T>): T {
  const { _id, ...value } = row;
  void _id;
  return value as unknown as T;
}
/** Typed native-driver boundary. Public DTOs never contain MongoDB _id. */
export function repository<K extends keyof Collections>(name: K) {
  type Row = Collections[K];
  const collection = async () => (await getDatabase()).collection<Stored<Row>>(name);
  return {
    async find(filter: Filter<Row> = {}, options: { sort?: Sort; limit?: number; skip?: number } = {}): Promise<Row[]> {
      const cursor = (await collection()).find(filter as Filter<Stored<Row>>, sessionOptions());
      if (options.sort) cursor.sort(options.sort);
      if (options.skip) cursor.skip(options.skip);
      if (options.limit !== undefined) cursor.limit(options.limit);
      return (await cursor.toArray()).map((row) => withoutMongoId(row as Stored<Row>));
    },
    async one(filter: Filter<Row>): Promise<Row | null> {
      const row = await (await collection()).findOne(filter as Filter<Stored<Row>>, sessionOptions());
      return row ? withoutMongoId(row as Stored<Row>) : null;
    },
    async count(filter: Filter<Row>): Promise<number> { return (await collection()).countDocuments(filter as Filter<Stored<Row>>, sessionOptions()); },
    async insert(input: Partial<Row>): Promise<Row> {
      const now = new Date();
      const row = { createdAt: now, ...(name === "tasks" ? { statusSince: now, updatedAt: now } : {}), ...defaults[name], ...input, id: input.id ?? randomUUID() } as unknown as Row;
      await (await collection()).insertOne({ ...row, _id: row.id } as OptionalUnlessRequiredId<Stored<Row>>, sessionOptions());
      return row;
    },
    async insertMany(inputs: Partial<Row>[]): Promise<Row[]> {
      const rows: Row[] = [];
      for (const input of inputs) rows.push(await this.insert(input));
      return rows;
    },
    async update(filter: Filter<Row>, changes: Partial<Row>, increments?: Record<string, number>): Promise<Row | null> {
      const update = { $set: changes, ...(increments ? { $inc: increments } : {}) } as UpdateFilter<Stored<Row>>;
      const row = await (await collection()).findOneAndUpdate(filter as Filter<Stored<Row>>, update, { ...sessionOptions(), returnDocument: "after" });
      return row ? withoutMongoId(row as Stored<Row>) : null;
    },
    async updateMany(filter: Filter<Row>, changes: Partial<Row>): Promise<number> {
      return (await (await collection()).updateMany(filter as Filter<Stored<Row>>, { $set: changes } as UpdateFilter<Stored<Row>>, sessionOptions())).modifiedCount;
    },
    async remove(filter: Filter<Row>): Promise<number> { return (await (await collection()).deleteMany(filter as Filter<Stored<Row>>, sessionOptions())).deletedCount; },
    async aggregate<T extends Document>(pipeline: Document[]): Promise<T[]> { return (await collection()).aggregate<T>(pipeline, sessionOptions()).toArray(); },
  };
}
export const store = {
  invitations: repository("invitations"), authLimits: repository("auth_limits"),
  users: repository("users"), sessions: repository("sessions"), workspaces: repository("workspaces"), memberships: repository("memberships"),
  projects: repository("projects"), tasks: repository("tasks"), taskDependencies: repository("task_dependencies"), taskEvents: repository("task_events"),
  comments: repository("comments"), notifications: repository("notifications"), savedViews: repository("saved_views"), riskConfigs: repository("risk_configs"),
};
/** Real coordination writes replace row locks. Conflicting workspace mutations
 * retry from a fresh snapshot, protecting authorization and dependency graphs.
 */
export async function lockWorkspace(workspaceId: string) {
  const updated = await store.workspaces.update({ id: workspaceId }, {}, { mutationVersion: 1 });
  if (!updated) throw new ApiError(404, "Workspace not found");
}
export function workspaceTransaction<T>(workspaceId: string, work: () => Promise<T>) {
  return withTransaction(async () => { await lockWorkspace(workspaceId); return work(); });
}
export async function memberUsers(workspaceId: string) {
  const memberships = await store.memberships.find({ workspaceId }, { sort: { createdAt: 1 } });
  const users = await store.users.find({ id: { $in: memberships.map((m) => m.userId) } });
  return memberships.flatMap((m) => { const u = users.find((user) => user.id === m.userId); return u ? [{ u, role: m.role }] : []; });
}
/** Upserts avoid duplicate-key errors that would abort a transaction. */
export async function insertNotifications(rows: Partial<Collections["notifications"]>[]): Promise<number> {
  let inserted = 0;
  const collection = (await getDatabase()).collection<Stored<Collections["notifications"]>>("notifications");
  for (const input of rows) {
    const id = input.id ?? randomUUID();
    const document = { actorId: null, taskId: null, dedupeKey: null, readAt: null, createdAt: new Date(), ...input, id, _id: id } as Stored<Collections["notifications"]>;
    const filter = input.dedupeKey ? { userId: input.userId, dedupeKey: input.dedupeKey } : { _id: id };
    const result = await collection.updateOne(filter, { $setOnInsert: document }, { ...sessionOptions(), upsert: true });
    inserted += result.upsertedCount;
  }
  return inserted;
}
