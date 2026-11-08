import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase, withTransaction } from "@/db";
import { store, insertNotifications } from "@/db/repository";
import { INDEXES } from "@/db/setup";
import { importSnapshot, normalizeSnapshot } from "@/db/import";
import { createSession, destroySession, getSessionUser, SESSION_COOKIE } from "@/server/auth/session";
import { hashToken } from "@/server/auth/tokens";
import { register, login } from "@/server/modules/auth/service";
import { changeMemberRole, createWorkspace, inviteMember, listWorkspaces, removeMember, createView, deleteView, listViews } from "@/server/modules/workspaces/service";
import { createProject, deleteProject } from "@/server/modules/projects/service";
import { addDependency, bulkAction, createTask, deleteTask, getTaskDetail, listTaskPage, updateTask } from "@/server/modules/tasks/service";
import { addComment, listComments, listActivityPage, listNotificationPage, runDeadlineSweep, setReadState } from "@/server/modules/collaboration/service";
import { getRiskConfig, updateRiskConfig } from "@/server/modules/risk/service";
import { taskListQuerySchema } from "@/server/validation";
import { getDashboard } from "@/server/modules/dashboard/service";

const { jar, cookieOptions } = vi.hoisted(() => ({ jar: new Map<string, string>(), cookieOptions: new Map<string, unknown>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
  set: (name: string, value: string, options: unknown) => { jar.set(name, value); cookieOptions.set(name, options); },
}) }));
const email = () => randomUUID() + "@test.dev";
const account = () => register({ email: email(), name: "Test user", password: "correct-password" });
beforeEach(() => { jar.clear(); cookieOptions.clear(); });
afterAll(closeDatabase);

async function fixture() {
  const owner = await account();
  const ws = (await listWorkspaces(owner.id))[0];
  const project = await createProject(owner.id, { workspaceId: ws.id, name: "Project", color: "#123456" });
  const recipient = await account();
  const member = await inviteMember(owner.id, ws.id, { email: recipient.email, role: "member" });
  return { owner, ws, project, member: member.member! };
}

describe("native MongoDB repositories and indexes", () => {
  it("creates declared indexes, including unique membership and session TTL", async () => {
    const db = await getDatabase();
    for (const [name, indexes] of Object.entries(INDEXES)) {
      const actual = await db.collection(name).listIndexes().toArray();
      for (const index of indexes) {
        const found = actual.find((item) => JSON.stringify(item.key) === JSON.stringify(index.key));
        expect(found, name).toBeDefined();
        if (index.unique) expect(found?.unique).toBe(true);
        if (index.expireAfterSeconds !== undefined) expect(found?.expireAfterSeconds).toBe(index.expireAfterSeconds);
      }
    }
  });
  it("stores UUID strings consistently and rejects ObjectId/reference mismatches", async () => {
    const { owner, ws, project } = await fixture();
    const task = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "IDs" });
    const raw = await (await getDatabase()).collection("tasks").findOne({ id: task.id });
    expect(raw?._id).toBe(task.id);
    expect(raw?.workspaceId).toBe(ws.id);
    expect(task).not.toHaveProperty("_id");
    await expect(store.tasks.insert({ workspaceId: "invalid", projectId: project.id, title: "Bad" })).rejects.toMatchObject({ code: 121 });
  });
  it("enforces unique emails and memberships and partial notification dedupe", async () => {
    const { owner, ws } = await fixture();
    const original = (await store.users.one({ id: owner.id }))!;
    await expect(store.users.insert({ ...original, id: randomUUID() })).rejects.toMatchObject({ code: 11000 });
    await expect(store.memberships.insert({ workspaceId: ws.id, userId: owner.id, role: "member" })).rejects.toMatchObject({ code: 11000 });
    const note = { workspaceId: ws.id, userId: owner.id, kind: "test", message: "test" };
    expect(await insertNotifications([{ ...note, dedupeKey: "key" }, { ...note, dedupeKey: "key" }])).toBe(1);
    expect(await insertNotifications([note, note])).toBe(2);
  });
  it("rolls back multiple collection writes on error", async () => {
    const id = randomUUID();
    await expect(withTransaction(async () => {
      await store.users.insert({ id, email: email(), name: "Rollback", passwordHash: "unused" });
      throw new Error("injected failure");
    })).rejects.toThrow("injected failure");
    expect(await store.users.one({ id })).toBeNull();
  });
  it("refuses to import over an existing database without changing accounts", async () => {
    const user = await account();
    const empty = normalizeSnapshot(Object.fromEntries(Object.keys(INDEXES).map((name) => [name, []])));
    await expect(importSnapshot(empty)).rejects.toThrow("empty target");
    expect(await store.users.one({ id: user.id })).not.toBeNull();
  });
  it("uses the declared index for a workspace/status task query", async () => {
    const { owner, ws, project } = await fixture();
    await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "Index" });
    const plan = await (await getDatabase()).collection("tasks").find({ workspaceId: ws.id, deletedAt: null, status: "backlog" }).sort({ position: 1, createdAt: 1, id: 1 }).explain("queryPlanner");
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain("tasks_board");
  });
});

describe("MongoDB authentication and membership", () => {
  it("registers an account, owner membership, and hashed session; logs in and rotates", async () => {
    const credentials = { email: email(), name: "Auth", password: "correct-password" };
    const user = await register(credentials);
    const previous = jar.get(SESSION_COOKIE)!;
    expect(await getSessionUser()).toMatchObject({ id: user.id });
    expect(cookieOptions.get(SESSION_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const session = await store.sessions.one({ id: hashToken(previous) });
    expect(session?.userId).toBe(user.id);
    expect(JSON.stringify(session)).not.toContain(previous);
    expect((await listWorkspaces(user.id))[0].role).toBe("owner");
    await expect(login({ email: credentials.email, password: "wrong" }, randomUUID())).rejects.toMatchObject({ status: 401 });
    await login(credentials, randomUUID());
    expect(jar.get(SESSION_COOKIE)).not.toBe(previous);
    expect(await store.sessions.one({ id: hashToken(previous) })).toBeNull();
    await destroySession();
    expect(await getSessionUser()).toBeNull();
  });
  it("does not authenticate expired sessions while awaiting TTL cleanup", async () => {
    const user = await account();
    const id = hashToken(jar.get(SESSION_COOKIE)!);
    await store.sessions.update({ id }, { expiresAt: new Date(0) });
    expect(await getSessionUser()).toBeNull();
    expect(await store.users.one({ id: user.id })).not.toBeNull();
  });
  it("does not orphan a registration if workspace creation fails", async () => {
    const targetEmail = email();
    const spy = vi.spyOn(store.workspaces, "insert").mockRejectedValueOnce(new Error("workspace failed"));
    try { await expect(register({ email: targetEmail, name: "Fail", password: "correct-password" })).rejects.toThrow("workspace failed"); }
    finally { spy.mockRestore(); }
    expect(await store.users.one({ email: targetEmail })).toBeNull();
  });
  it("session rotation failure preserves the previous session atomically", async () => {
    const user = await account();
    const previous = jar.get(SESSION_COOKIE)!;
    const spy = vi.spyOn(store.sessions, "insert").mockRejectedValueOnce(new Error("session failed"));
    try { await expect(createSession(user.id)).rejects.toThrow("session failed"); } finally { spy.mockRestore(); }
    expect(jar.get(SESSION_COOKIE)).toBe(previous);
    expect(await store.sessions.one({ id: hashToken(previous) })).not.toBeNull();
  });
  it("keeps role changes owner-only and revokes access when membership is removed", async () => {
    const { owner, ws, member } = await fixture();
    const adminAccount = await account();
    const admin = (await inviteMember(owner.id, ws.id, { email: adminAccount.email, role: "admin" })).member!;
    await expect(changeMemberRole(member.id, ws.id, member.id, "admin")).rejects.toMatchObject({ status: 403 });
    await expect(changeMemberRole(admin.id, ws.id, member.id, "admin")).rejects.toMatchObject({ status: 403 });
    await changeMemberRole(owner.id, ws.id, member.id, "project_manager");
    expect(await store.memberships.one({ workspaceId: ws.id, userId: member.id })).toMatchObject({ role: "project_manager" });
    await expect(removeMember(owner.id, ws.id, owner.id)).rejects.toMatchObject({ status: 400 });
    await removeMember(owner.id, ws.id, member.id);
    await expect(getDashboard(member.id, ws.id, { days: 7, timeZone: "UTC", filters: {} })).rejects.toMatchObject({ status: 404 });
  });
  it("returns 404 for a missing workspace during a coordinated mutation", async () => {
    const user = await account();
    await expect(createProject(user.id, { workspaceId: randomUUID(), name: "Missing", color: "#123456" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("MongoDB task workflows, concurrency, collaboration, and analytics", () => {
  it("preserves task lifecycle, revisions, events, delete and restore", async () => {
    const { owner, ws, project } = await fixture();
    let task = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "Lifecycle", status: "todo" });
    task = await updateTask(owner.id, task.id, { expectedVersion: task.revision, status: "in_progress" });
    task = await updateTask(owner.id, task.id, { expectedVersion: task.revision, status: "done" });
    await expect(updateTask(owner.id, task.id, { expectedVersion: task.revision, status: "review" })).rejects.toMatchObject({ status: 400 });
    task = await updateTask(owner.id, task.id, { expectedVersion: task.revision, status: "todo" });
    const deleted = await deleteTask(owner.id, task.id, { expectedVersion: task.revision });
    await updateTask(owner.id, task.id, { expectedVersion: deleted.revision, restore: true });
    const detail = await getTaskDetail(owner.id, task.id);
    expect(detail.events.map((e) => e.type)).toEqual(expect.arrayContaining(["created", "completed", "reopened", "deleted", "restored"]));
    const dashboard = await getDashboard(owner.id, ws.id, { days: 7, timeZone: "UTC", filters: {} });
    expect(dashboard.summary.openTasks).toBe(1);
  });
  it("rejects cross-tenant task reads, project references, and assignments", async () => {
    const { owner, ws, project } = await fixture();
    const outsider = await account();
    const otherWs = (await listWorkspaces(outsider.id))[0];
    const foreignProject = await createProject(outsider.id, { workspaceId: otherWs.id, name: "Foreign", color: "#123456" });
    const task = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "Private" });
    await expect(getTaskDetail(outsider.id, task.id)).rejects.toMatchObject({ status: 404 });
    await expect(createTask(owner.id, { workspaceId: ws.id, projectId: foreignProject.id, title: "Bad" })).rejects.toMatchObject({ status: 400 });
    await expect(updateTask(owner.id, task.id, { expectedVersion: 0, assigneeId: outsider.id })).rejects.toMatchObject({ status: 400 });
  });
  it("allows exactly one concurrent edit at a given revision", async () => {
    const { owner, ws, project } = await fixture();
    const task = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "CAS" });
    const results = await Promise.allSettled(["A", "B"].map((title) => updateTask(owner.id, task.id, { expectedVersion: 0, title })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toMatchObject({ status: 409 });
    expect(await store.tasks.one({ id: task.id })).toMatchObject({ version: 1 });
    expect(await store.taskEvents.count({ taskId: task.id, type: "edited" })).toBe(1);
  });
  it("serializes concurrent dependency changes to prevent cycles", async () => {
    const { owner, ws, project } = await fixture();
    const a = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "A" });
    const b = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "B" });
    const result = await Promise.allSettled([addDependency(owner.id, a.id, b.id), addDependency(owner.id, b.id, a.id)]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await store.taskDependencies.count({ workspaceId: ws.id })).toBe(1);
  });
  it("rolls back the entire bulk operation on a stale task", async () => {
    const { owner, ws, project } = await fixture();
    const a = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "A" });
    const b = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "B" });
    await expect(bulkAction(owner.id, { workspaceId: ws.id, ids: [a.id, b.id], action: "delete", expected: [{ id: a.id, revision: 0 }, { id: b.id, revision: 99 }] })).rejects.toMatchObject({ status: 409 });
    expect(await store.tasks.one({ id: a.id })).toMatchObject({ deletedAt: null, version: 0 });
    expect(await store.taskEvents.count({ workspaceId: ws.id, type: "deleted" })).toBe(0);
  });
  it("keeps subtasks and ordering consistent, and treats search text literally", async () => {
    const { owner, ws, project } = await fixture();
    const parent = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "Parent [x]", priority: "urgent" });
    const child = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, parentTaskId: parent.id, title: "Child", priority: "low" });
    await expect(createTask(owner.id, { workspaceId: ws.id, projectId: project.id, parentTaskId: child.id, title: "Too deep" })).rejects.toMatchObject({ status: 400 });
    expect((await getTaskDetail(owner.id, parent.id)).subtaskCount).toBe(1);
    const result = await listTaskPage(owner.id, taskListQuerySchema.parse({ workspaceId: ws.id, q: "[x]" }));
    expect(result.tasks.map((t) => t.id)).toEqual([parent.id]);
    const priority = await listTaskPage(owner.id, taskListQuerySchema.parse({ workspaceId: ws.id, sort: "priority" }));
    expect(priority.tasks.map((t) => t.id)).toEqual([parent.id, child.id]);
    const moved = await updateTask(owner.id, child.id, { expectedVersion: 0, position: 0 });
    expect(moved.position).toBe(0);
    expect(await store.tasks.one({ id: parent.id })).toMatchObject({ position: 1, version: 1 });
  });
  it("preserves comment threads, mentions, activity cursors, and notification ownership", async () => {
    const { owner, ws, project, member } = await fixture();
    const task = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "Comments", assigneeId: member.id });
    const top = await addComment(owner.id, task.id, { body: "Mention", mentionIds: [member.id] });
    const reply = await addComment(member.id, task.id, { body: "Reply", parentId: top.id, mentionIds: [] });
    await expect(addComment(owner.id, task.id, { body: "Too deep", parentId: reply.id, mentionIds: [] })).rejects.toMatchObject({ status: 400 });
    expect((await listComments(owner.id, task.id, { limit: 1 })).threads[0].replies).toHaveLength(1);
    const first = await listActivityPage(owner.id, { workspaceId: ws.id, limit: 1 });
    const second = await listActivityPage(owner.id, { workspaceId: ws.id, limit: 1, cursor: first.nextCursor! });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const feed = await listNotificationPage(member.id, { workspaceId: ws.id, limit: 50, unreadOnly: false });
    expect(feed.items.some((n) => n.kind === "mention")).toBe(true);
    expect((await setReadState(owner.id, ws.id, feed.items.map((n) => n.id), true)).updated).toBe(0);
    expect((await setReadState(member.id, ws.id, feed.items.map((n) => n.id), true)).updated).toBe(feed.items.length);
  });
  it("deduplicates repeated deadline sweeps", async () => {
    const { owner, ws, project, member } = await fixture();
    await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "Due", assigneeId: member.id, dueDate: new Date(Date.now() - 10000).toISOString() });
    expect(await runDeadlineSweep(member.id, ws.id)).toBe(1);
    expect(await runDeadlineSweep(member.id, ws.id)).toBe(0);
  });
  it("protects saved views and risk revisions", async () => {
    const { owner, ws, member } = await fixture();
    const config = { q: "", projectId: "", assigneeId: "", priority: "", tag: "", sort: "position", layout: "board" as const };
    const view = await createView(owner.id, ws.id, "View", config);
    await deleteView(member.id, ws.id, view.id);
    expect(await listViews(owner.id, ws.id)).toHaveLength(1);
    const risk = await getRiskConfig(owner.id, ws.id);
    await expect(updateRiskConfig(member.id, ws.id, { config: risk.config, expectedRevision: 0 })).rejects.toMatchObject({ status: 403 });
    expect((await updateRiskConfig(owner.id, ws.id, { config: risk.config, expectedRevision: 0 })).revision).toBe(1);
    await expect(updateRiskConfig(owner.id, ws.id, { config: risk.config, expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
  });
  it("cascades project deletion across related collections atomically", async () => {
    const { owner, ws, project, member } = await fixture();
    const task = await createTask(owner.id, { workspaceId: ws.id, projectId: project.id, title: "Delete", assigneeId: member.id });
    const otherProject = await createProject(owner.id, { workspaceId: ws.id, name: "Other", color: "#123456" });
    const other = await createTask(owner.id, { workspaceId: ws.id, projectId: otherProject.id, title: "Keep" });
    await addDependency(owner.id, other.id, task.id);
    await addComment(owner.id, task.id, { body: "Cascade", mentionIds: [] });
    await deleteProject(owner.id, project.id);
    expect(await store.tasks.one({ id: task.id })).toBeNull();
    expect(await store.tasks.one({ id: other.id })).not.toBeNull();
    expect(await store.taskDependencies.count({ workspaceId: ws.id })).toBe(0);
    for (const repo of [store.taskEvents, store.comments, store.notifications]) expect(await repo.count({ workspaceId: ws.id, taskId: task.id })).toBe(0);
  });
});
