import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/db";
import { store } from "@/db/repository";
import { register, login } from "@/server/modules/auth/service";
import { inviteMember, listWorkspaces, removeMember } from "@/server/modules/workspaces/service";
import { createProject, updateProject } from "@/server/modules/projects/service";
import { bulkAction, createTask, deleteTask, getTaskDetail, listTaskPage, updateTask } from "@/server/modules/tasks/service";
import { addComment, listComments, listNotificationPage, setReadState } from "@/server/modules/collaboration/service";
import { taskCreateSchema, taskPatchSchema, taskListQuerySchema } from "@/server/validation";
import { enforceAuthLimit, clientAddress } from "@/server/auth/limits";
import { demoEnabled } from "@/server/auth/demo";
import { changePassword } from "@/server/auth/credentials";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { hashToken } from "@/server/auth/tokens";
import { forecast } from "@/lib/domain/analytics";
import { buildAnalyticsReport } from "@/lib/analytics/report";
import { buildDashboard } from "@/lib/dashboard/model";
import { assessWorkspaceRisk } from "@/lib/risk/assess";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/model";
import { AS_OF, FIXTURE_SOURCE } from "@/lib/analytics/__tests__/fixture";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => jar.has(key) ? { value: jar.get(key)! } : undefined, set: (key: string, value: string) => jar.set(key, value) }) }));
const password = "test-only-password";
const account = () => register({ email: randomUUID() + "@test.dev", name: "Synthetic account", password });
beforeEach(() => jar.clear());
afterAll(closeDatabase);
async function fixture() {
  const owner = await account();
  const workspace = (await listWorkspaces(owner.id))[0];
  const member = await account();
  await inviteMember(owner.id, workspace.id, { email: member.email, role: "member" });
  const project = await createProject(owner.id, { workspaceId: workspace.id, name: "Audit fixture", color: "#123456" });
  return { owner, workspace, member, project };
}

describe("security and data-integrity remediation", () => {
  it("never provisions a password for an invite; recipient chooses it during registration", async () => {
    const { owner, workspace } = await fixture();
    const email = randomUUID() + "@test.dev";
    const invitation = await inviteMember(owner.id, workspace.id, { email, role: "member" });
    expect(invitation).toMatchObject({ pending: true, member: null });
    expect(invitation).not.toHaveProperty("tempPassword");
    expect(await store.users.one({ email })).toBeNull();
    const recipient = await register({ email, name: "Recipient", password });
    expect(await store.memberships.one({ userId: recipient.id, workspaceId: workspace.id })).not.toBeNull();
    expect(await store.invitations.count({ email })).toBe(0);
    await expect(login({ email, password: "inviter-cannot-know" }, "internal")).rejects.toMatchObject({ status: 401 });
    await expect(login({ email, password }, "internal")).resolves.toMatchObject({ id: recipient.id });
  });
  it("does not accept expired invitations", async () => {
    const { owner, workspace } = await fixture();
    const email = randomUUID() + "@test.dev";
    await inviteMember(owner.id, workspace.id, { email, role: "admin" });
    await store.invitations.update({ email }, { expiresAt: new Date(0) });
    const recipient = await register({ email, name: "Recipient", password });
    expect(await store.memberships.one({ userId: recipient.id, workspaceId: workspace.id })).toBeNull();
  });
  it("password rotation rejects a wrong password, invalidates other sessions and keeps a fresh session", async () => {
    const user = await account();
    const oldToken = jar.get(SESSION_COOKIE)!;
    await createSession(user.id);
    await expect(changePassword(user.id, "wrong", "private-new-password")).rejects.toMatchObject({ status: 401 });
    await changePassword(user.id, password, "private-new-password");
    expect(await store.sessions.one({ id: hashToken(oldToken) })).toBeNull();
    expect(await store.sessions.count({ userId: user.id })).toBe(1);
    expect(await store.sessions.one({ id: hashToken(jar.get(SESSION_COOKIE)!) })).not.toBeNull();
    await expect(login({ email: user.email, password }, "internal")).rejects.toMatchObject({ status: 401 });
    await expect(login({ email: user.email, password: "private-new-password" }, "internal")).resolves.toMatchObject({ id: user.id });
  });
  it("blocks unauthorized invitations", async () => {
    const { member, workspace } = await fixture();
    await expect(inviteMember(member.id, workspace.id, { email: randomUUID() + "@test.dev", role: "admin" })).rejects.toMatchObject({ status: 403 });
  });
  it("production cannot enable demo access", () => {
    expect(demoEnabled({ NODE_ENV: "production", ENABLE_DEMO: "true" })).toBe(false);
    expect(demoEnabled({ NODE_ENV: "development", ENABLE_DEMO: "true" })).toBe(true);
    expect(demoEnabled({ NODE_ENV: "development" })).toBe(false);
  });
  it("uses atomic shared rate counters and separate expiring windows", async () => {
    const key = randomUUID();
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => enforceAuthLimit(key, 3, 1000000)));
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(5);
    await expect(enforceAuthLimit(key, 3, 2000000)).resolves.toBeUndefined();
  });
  it("does not trust a caller-supplied forwarded IP by default", () => {
    expect(clientAddress(new Request("http://localhost", { headers: { "x-forwarded-for": "spoofed" } }))).toBe("untrusted");
  });
  it("empty notification IDs do not mark all records; GET does not generate deadline writes", async () => {
    const { owner, workspace, member, project } = await fixture();
    await createTask(owner.id, { workspaceId: workspace.id, projectId: project.id, title: "Overdue", assigneeId: member.id, dueDate: new Date(Date.now() - 86400000).toISOString() });
    const before = await store.workspaces.one({ id: workspace.id });
    const page = await listNotificationPage(member.id, { workspaceId: workspace.id, limit: 20, unreadOnly: false });
    expect(page.items.some((n) => n.kind === "overdue")).toBe(false);
    expect((await store.workspaces.one({ id: workspace.id }))?.mutationVersion).toBe(before?.mutationVersion);
    expect(await setReadState(member.id, workspace.id, [], true)).toEqual({ updated: 0 });
    expect((await listNotificationPage(member.id, { workspaceId: workspace.id, limit: 20, unreadOnly: false })).unreadCount).toBe(page.unreadCount);
    expect((await setReadState(member.id, workspace.id, undefined, true)).updated).toBe(page.unreadCount);
  });
  it("bulk assignment and status changes notify the assignee", async () => {
    const { owner, workspace, member, project } = await fixture();
    const task = await createTask(owner.id, { workspaceId: workspace.id, projectId: project.id, title: "Bulk" });
    await bulkAction(owner.id, { workspaceId: workspace.id, ids: [task.id], action: "assign", assigneeId: member.id, expected: [{ id: task.id, revision: 0 }] });
    await bulkAction(owner.id, { workspaceId: workspace.id, ids: [task.id], action: "status", status: "in_progress", expected: [{ id: task.id, revision: 1 }] });
    const notes = await store.notifications.find({ workspaceId: workspace.id, userId: member.id, taskId: task.id });
    expect(notes.map((n) => n.kind).sort()).toEqual(["assigned", "status"]);
  });
  it("removing a member unassigns tasks with a revision and event", async () => {
    const { owner, workspace, member, project } = await fixture();
    const task = await createTask(owner.id, { workspaceId: workspace.id, projectId: project.id, title: "Assigned", assigneeId: member.id });
    await removeMember(owner.id, workspace.id, member.id);
    expect(await store.tasks.one({ id: task.id })).toMatchObject({ assigneeId: null, version: 1 });
    const page = await listTaskPage(owner.id, taskListQuerySchema.parse({ workspaceId: workspace.id, assigneeId: "none" }));
    expect(page.tasks.map((t) => t.id)).toContain(task.id);
    expect(await store.taskEvents.count({ taskId: task.id, type: "assigned", toValue: null })).toBe(1);
  });
  it("restore rejects children whose parent moved to another project", async () => {
    const { owner, workspace, project } = await fixture();
    const other = await createProject(owner.id, { workspaceId: workspace.id, name: "Other", color: "#abcdef" });
    const parent = await createTask(owner.id, { workspaceId: workspace.id, projectId: project.id, title: "Parent" });
    const child = await createTask(owner.id, { workspaceId: workspace.id, projectId: project.id, parentTaskId: parent.id, title: "Child" });
    await deleteTask(owner.id, child.id, { expectedVersion: 0 });
    await updateTask(owner.id, parent.id, { expectedVersion: 0, projectId: other.id });
    await expect(updateTask(owner.id, child.id, { expectedVersion: 1, restore: true })).rejects.toMatchObject({ status: 400 });
    await expect(bulkAction(owner.id, { workspaceId: workspace.id, ids: [child.id], action: "restore", expected: [{ id: child.id, revision: 1 }] })).rejects.toMatchObject({ status: 400 });
    expect((await store.tasks.one({ id: child.id }))?.deletedAt).not.toBeNull();
  });
  it("filters before pagination and preserves real project counts after updates", async () => {
    const { owner, workspace, project } = await fixture();
    for (let i = 0; i < 55; i++) await store.tasks.insert({ workspaceId: workspace.id, projectId: project.id, title: i === 54 ? "Needle" : "Other", tags: i === 54 ? ["find-me"] : [] });
    const page = await listTaskPage(owner.id, taskListQuerySchema.parse({ workspaceId: workspace.id, q: "Needle", pageSize: 1 }));
    expect(page.pagination.total).toBe(1);
    expect(page.tasks[0].title).toBe("Needle");
    const labels = await listTaskPage(owner.id, taskListQuerySchema.parse({ workspaceId: workspace.id, q: "find-me" }));
    expect(labels.tasks).toHaveLength(1);
    expect((await updateProject(owner.id, project.id, { name: "Updated" })).taskCount).toBe(55);
  });
  it("paginates task-detail comments without losing replies", async () => {
    const { owner, workspace, project } = await fixture();
    const task = await createTask(owner.id, { workspaceId: workspace.id, projectId: project.id, title: "Comments" });
    for (let i = 0; i < 25; i++) await addComment(owner.id, task.id, { body: "Comment " + i, mentionIds: [] });
    const detail = await getTaskDetail(owner.id, task.id);
    expect(detail.comments).toHaveLength(20);
    const next = await listComments(owner.id, task.id, { limit: 20, cursor: detail.commentsNextCursor! });
    expect(next.threads).toHaveLength(5);
    expect(next.nextCursor).toBeNull();
  });
  it("orders risk globally before selecting a page", async () => {
    const { owner, workspace, project } = await fixture();
    await createTask(owner.id, { workspaceId: workspace.id, projectId: project.id, title: "No deadline" });
    const overdue = await createTask(owner.id, { workspaceId: workspace.id, projectId: project.id, title: "Highest risk", dueDate: new Date(Date.now() - 86400000).toISOString(), estimatePoints: 20 });
    const first = await listTaskPage(owner.id, taskListQuerySchema.parse({ workspaceId: workspace.id, sort: "risk", pageSize: 1 }));
    const second = await listTaskPage(owner.id, taskListQuerySchema.parse({ workspaceId: workspace.id, sort: "risk", pageSize: 1, page: 2 }));
    expect(first.tasks[0].id).toBe(overdue.id);
    expect(second.tasks[0].id).not.toBe(overdue.id);
    expect(first.pagination.total).toBe(2);
  });
});

describe("calculation contracts", () => {
  it("rejects impossible dates on create and patch while accepting leap day", () => {
    for (const date of ["2026-02-31", "2026-13-01", "2026-02-29"]) {
      expect(taskPatchSchema.safeParse({ expectedVersion: 0, dueDate: date }).success).toBe(false);
      expect(taskCreateSchema.safeParse({ workspaceId: randomUUID(), projectId: randomUUID(), title: "Date", dueDate: date }).success).toBe(false);
    }
    expect(taskPatchSchema.safeParse({ expectedVersion: 0, dueDate: "2028-02-29" }).success).toBe(true);
  });
  it("keeps no-pace and zero-backlog forecasts stable through JSON", () => {
    expect(JSON.parse(JSON.stringify(forecast(5, [0, 0, 0], 0.3))).conservativeDays).toBeNull();
    expect(forecast(0, [0, 0], 0.3).conservativeDays).toBe(0);
    expect(forecast(6, [2, 2], 0.3).conservativeDays).toBe(3);
  });
  it("report and dashboard agree when dependencies were added after asOf", () => {
    const source = { ...FIXTURE_SOURCE, edges: FIXTURE_SOURCE.edges.map((e) => ({ ...e, createdAt: new Date(AS_OF.getTime() + 1000) })) };
    const options = { asOf: AS_OF, timeZone: "UTC", days: 7 };
    const report = buildAnalyticsReport(source, options);
    const dashboard = buildDashboard(source, options, { results: assessWorkspaceRisk(source, AS_OF, DEFAULT_RISK_CONFIG, 0), meta: { modelVersion: "2.0.0", revision: 0, fingerprint: "test", capacityPoints: 8 } }, [], []);
    expect(report.blocked.blocked).toBe(0);
    expect(dashboard.blocked.count).toBe(dashboard.blocked.tasks.length);
  });
});
