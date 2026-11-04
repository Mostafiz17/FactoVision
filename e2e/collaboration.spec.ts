import { expect, request, test, type APIRequestContext, type APIResponse } from "@playwright/test";

interface Page<T> { nextCursor: string | null; threads: T[]; items: T[] }

/**
 * Phase 4 integration suite (live API): comment/reply/mention notification
 * triggers, deadline alerts + dedupe, read/unread, visibility, keyset
 * pagination and failure handling.
 */
test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3000";
const run = Date.now();

interface Actor { ctx: APIRequestContext; id: string; workspaceId: string; }
interface Notif { id: string; kind: string; taskId: string | null; readAt: string | null; message: string }

async function register(tag: string): Promise<Actor> {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.post("/api/auth/register", { data: { email: `${tag}-${run}@collab.dev`, name: `${tag} ${run}`, password: "password123" } });
  expect(res.status(), `register ${tag}`).toBe(201);
  const me = await (await ctx.get("/api/auth/me")).json();
  return { ctx, id: me.user.id, workspaceId: me.workspaces[0].id };
}

async function notifs(a: Actor, ws: string, extra = ""): Promise<{ items: Notif[]; nextCursor: string | null; unreadCount: number }> {
  const res = await a.ctx.get(`/api/notifications?workspaceId=${ws}&limit=50${extra}`);
  expect(res.status()).toBe(200);
  return res.json();
}

let owner: Actor;
let bob: Actor;
let cat: Actor;
let intruder: Actor;
let ws: string;
let projectId: string;
let taskId: string;
let ownerCommentId: string;

test.beforeAll(async () => {
  owner = await register("owner");
  bob = await register("bob");
  cat = await register("cat");
  intruder = await register("intruder");
  ws = owner.workspaceId;
  for (const m of [bob, cat]) {
    const me = await (await m.ctx.get("/api/auth/me")).json();
    const res = await owner.ctx.post(`/api/workspaces/${ws}/members`, { data: { email: me.user.email, role: "member" } });
    expect(res.status()).toBe(201);
  }
  const p = await owner.ctx.post("/api/projects", { data: { workspaceId: ws, name: "Collab", color: "#7c5cff" } });
  projectId = (await p.json()).project.id;
  const t = await owner.ctx.post("/api/tasks", { data: { workspaceId: ws, projectId, title: "Threaded task", assigneeId: bob.id } });
  expect(t.status()).toBe(201);
  taskId = (await t.json()).task.id;
});

test.afterAll(async () => {
  for (const a of [owner, bob, cat, intruder]) await a?.ctx.dispose();
});

test("triggers: assignment, mention outranks comment, reply to parent author, never self", async () => {
  // assignment on create
  let b = await notifs(bob, ws);
  expect(b.items.filter((n) => n.kind === "assigned" && n.taskId === taskId)).toHaveLength(1);

  // owner comments mentioning bob (assignee) and cat
  const c = await owner.ctx.post(`/api/tasks/${taskId}/comments`, { data: { body: "Please review @bob and @cat", mentionIds: [bob.id, cat.id, bob.id] } });
  expect(c.status()).toBe(201);
  const comment = (await c.json()).comment;
  ownerCommentId = comment.id;
  expect(comment.mentions.map((m: { id: string }) => m.id).sort()).toEqual([bob.id, cat.id].sort());

  b = await notifs(bob, ws);
  const bobForComment = b.items.filter((n) => n.taskId === taskId && ["mention", "comment"].includes(n.kind));
  expect(bobForComment.map((n) => n.kind)).toEqual(["mention"]); // one notification, most specific reason
  const cc = await notifs(cat, ws);
  expect(cc.items.filter((n) => n.kind === "mention" && n.taskId === taskId)).toHaveLength(1);
  const o = await notifs(owner, ws);
  expect(o.items.filter((n) => n.taskId === taskId)).toHaveLength(0); // actor never self-notified

  // bob replies → owner (parent author + creator) gets exactly one "reply"
  const r = await bob.ctx.post(`/api/tasks/${taskId}/comments`, { data: { body: "On it", parentId: ownerCommentId } });
  expect(r.status()).toBe(201);
  expect((await r.json()).comment.parentId).toBe(ownerCommentId);
  const o2 = await notifs(owner, ws);
  expect(o2.items.filter((n) => n.taskId === taskId).map((n) => n.kind)).toEqual(["reply"]);
});

test("deadline alerts: overdue and due-soon are generated on poll and deduplicated", async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const od = await owner.ctx.post("/api/tasks", { data: { workspaceId: ws, projectId, title: "Overdue thing", assigneeId: bob.id, dueDate: yesterday } });
  const sn = await owner.ctx.post("/api/tasks", { data: { workspaceId: ws, projectId, title: "Soon thing", assigneeId: bob.id, dueDate: soon } });
  const overdueId = (await od.json()).task.id;
  const soonId = (await sn.json()).task.id;

  for (let i = 0; i < 3; i++) await notifs(bob, ws); // repeated polls = repeated sweeps
  const b = await notifs(bob, ws);
  expect(b.items.filter((n) => n.kind === "overdue" && n.taskId === overdueId)).toHaveLength(1);
  expect(b.items.filter((n) => n.kind === "deadline_soon" && n.taskId === soonId)).toHaveLength(1);
  // Not delivered to non-assignees
  const o = await notifs(owner, ws);
  expect(o.items.some((n) => n.taskId === overdueId && n.kind === "overdue")).toBe(false);

  // Completing the task stops further alerts; existing one is preserved (no deletes)
  const detail = await (await bob.ctx.get(`/api/tasks/${overdueId}`)).json();
  expect((await bob.ctx.patch(`/api/tasks/${overdueId}`, { data: { status: "in_progress", expectedVersion: detail.task.revision } })).status()).toBe(200);
});

test("read/unread state with owner-only scope", async () => {
  let b = await notifs(bob, ws);
  const target = b.items.find((n) => !n.readAt);
  expect(target).toBeDefined();
  const before = b.unreadCount;
  expect(before).toBe(b.items.filter((n) => !n.readAt).length);

  // cat cannot touch bob's notifications (scoped update ⇒ 0 rows)
  const foreign = await cat.ctx.patch("/api/notifications", { data: { workspaceId: ws, ids: [target!.id], read: true } });
  expect((await foreign.json()).updated).toBe(0);
  expect((await notifs(bob, ws)).unreadCount).toBe(before);

  expect((await (await bob.ctx.patch("/api/notifications", { data: { workspaceId: ws, ids: [target!.id], read: true } })).json()).updated).toBe(1);
  expect((await notifs(bob, ws)).unreadCount).toBe(before - 1);
  expect((await (await bob.ctx.patch("/api/notifications", { data: { workspaceId: ws, ids: [target!.id], read: false } })).json()).updated).toBe(1);
  expect((await notifs(bob, ws)).unreadCount).toBe(before);
  // idempotent: marking an already-unread notification unread changes nothing
  expect((await (await bob.ctx.patch("/api/notifications", { data: { workspaceId: ws, ids: [target!.id], read: false } })).json()).updated).toBe(0);

  await bob.ctx.patch("/api/notifications", { data: { workspaceId: ws } });
  b = await notifs(bob, ws, "&unreadOnly=true");
  expect(b.unreadCount).toBe(0);
  expect(b.items).toHaveLength(0);
});

test("visibility: per-user inboxes, tenant isolation, unauthenticated access", async () => {
  const bobIds = new Set((await notifs(bob, ws)).items.map((n) => n.id));
  const catItems = (await notifs(cat, ws)).items;
  expect(catItems.some((n) => bobIds.has(n.id))).toBe(false);

  const iws = intruder.workspaceId;
  expect((await intruder.ctx.get(`/api/tasks/${taskId}/comments`)).status()).toBe(404);
  expect((await intruder.ctx.post(`/api/tasks/${taskId}/comments`, { data: { body: "spy" } })).status()).toBe(404);
  expect((await intruder.ctx.get(`/api/activity?workspaceId=${ws}`)).status()).toBe(404);
  expect((await intruder.ctx.get(`/api/activity?workspaceId=${iws}&projectId=${projectId}`)).status()).toBe(404); // foreign project via own workspace
  expect((await intruder.ctx.get(`/api/notifications?workspaceId=${ws}`)).status()).toBe(404);
  expect((await intruder.ctx.patch("/api/notifications", { data: { workspaceId: ws } })).status()).toBe(404);

  const anon = await request.newContext({ baseURL: BASE });
  expect((await anon.get(`/api/tasks/${taskId}/comments`)).status()).toBe(401);
  expect((await anon.post(`/api/tasks/${taskId}/comments`, { data: { body: "x" } })).status()).toBe(401);
  expect((await anon.get(`/api/activity?workspaceId=${ws}`)).status()).toBe(401);
  expect((await anon.get(`/api/notifications?workspaceId=${ws}`)).status()).toBe(401);
  await anon.dispose();
});

test("pagination: comments, activity and notifications pages are disjoint and complete", async () => {
  const t = await owner.ctx.post("/api/tasks", { data: { workspaceId: ws, projectId, title: "Paged task", assigneeId: cat.id } });
  const pagedId = (await t.json()).task.id;
  for (let i = 0; i < 7; i++) {
    expect((await owner.ctx.post(`/api/tasks/${pagedId}/comments`, { data: { body: `note ${i}` } })).status()).toBe(201);
  }
  // comments: 3 + 3 + 1, oldest first, nested replies stay inside their thread
  const seen: string[] = [];
  let cursor: string | null = null;
  const sizes: number[] = [];
  do {
    const res: APIResponse = await cat.ctx.get(`/api/tasks/${pagedId}/comments?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(res.status()).toBe(200);
    const page: Page<{ body: string }> = await res.json();
    sizes.push(page.threads.length);
    seen.push(...page.threads.map((c) => c.body));
    cursor = page.nextCursor;
  } while (cursor);
  expect(sizes).toEqual([3, 3, 1]);
  expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => `note ${i}`));

  const threaded = await (await bob.ctx.get(`/api/tasks/${taskId}/comments?limit=10`)).json();
  expect(threaded.threads[0].replies.map((r: { body: string }) => r.body)).toEqual(["On it"]);

  // activity, project-scoped, newest first
  const actIds: string[] = [];
  cursor = null;
  let pages = 0;
  do {
    const res: APIResponse = await owner.ctx.get(`/api/activity?workspaceId=${ws}&projectId=${projectId}&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const page: Page<{ id: string }> = await res.json();
    actIds.push(...page.items.map((a) => a.id));
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 20);
  expect(new Set(actIds).size).toBe(actIds.length);
  const all = await (await owner.ctx.get(`/api/activity?workspaceId=${ws}&projectId=${projectId}&limit=100`)).json();
  expect(actIds).toEqual(all.items.map((a: { id: string }) => a.id));

  // notifications for cat (assignment + 7 comments ⇒ dedup per comment)
  const full = await notifs(cat, ws);
  const ids: string[] = [];
  cursor = null;
  do {
    const res: APIResponse = await cat.ctx.get(`/api/notifications?workspaceId=${ws}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const page: Page<Notif> = await res.json();
    expect(page.items.length).toBeLessThanOrEqual(2);
    ids.push(...page.items.map((n) => n.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toEqual(full.items.map((n) => n.id));
  expect(full.items.filter((n) => n.taskId === pagedId && n.kind === "comment")).toHaveLength(7);
});

test("failure handling: invalid mentions, replies, cursors and bodies are rejected without side effects", async () => {
  const count = async () => (await (await owner.ctx.get(`/api/tasks/${taskId}/comments?limit=50`)).json()).threads.length;
  const before = await count();

  const outsider = await owner.ctx.post(`/api/tasks/${taskId}/comments`, { data: { body: "hey @intruder", mentionIds: [intruder.id] } });
  expect(outsider.status()).toBe(400);
  expect((await notifs(intruder, intruder.workspaceId)).items.some((n) => n.taskId === taskId)).toBe(false);

  const firstReply = (await (await owner.ctx.get(`/api/tasks/${taskId}/comments?limit=50`)).json()).threads[0].replies[0];
  expect((await owner.ctx.post(`/api/tasks/${taskId}/comments`, { data: { body: "nested", parentId: firstReply.id } })).status()).toBe(400);

  const other = await owner.ctx.post("/api/tasks", { data: { workspaceId: ws, projectId, title: "Other task" } });
  const otherId = (await other.json()).task.id;
  expect((await owner.ctx.post(`/api/tasks/${otherId}/comments`, { data: { body: "wrong thread", parentId: ownerCommentId } })).status()).toBe(400);

  expect((await owner.ctx.post(`/api/tasks/${taskId}/comments`, { data: { body: "   " } })).status()).toBe(400);
  expect((await owner.ctx.post(`/api/tasks/${taskId}/comments`, { data: { body: "x", mentionIds: Array(11).fill(bob.id) } })).status()).toBe(400);
  expect((await owner.ctx.post(`/api/tasks/${taskId}/comments`, { data: { body: "x", mentionIds: ["not-a-uuid"] } })).status()).toBe(400);

  for (const path of [`/api/tasks/${taskId}/comments?cursor=bogus`, `/api/activity?workspaceId=${ws}&cursor=bogus`, `/api/notifications?workspaceId=${ws}&cursor=bogus`]) {
    expect((await owner.ctx.get(path)).status(), path).toBe(400);
  }
  expect((await owner.ctx.get(`/api/notifications?workspaceId=${ws}&limit=500`)).status()).toBe(400);

  expect(await count()).toBe(before); // nothing persisted by rejected writes
});