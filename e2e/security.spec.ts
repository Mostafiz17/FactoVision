import { expect, request, test } from "@playwright/test";

/**
 * Phase 2 security suite — negative authorization tests against the live API.
 * Covers: unauthenticated access, unauthorized roles (member/PM/admin limits),
 * cross-workspace reads and mutations (must 404, never leak), input validation,
 * CSRF origin rejection, and the full auth → workspace → membership lifecycle.
 */
const NIL = "00000000-0000-4000-8000-000000000000";
const runId = Date.now();

async function newSession() {
  return request.newContext({ baseURL: (process.env.E2E_BASE_URL ?? "http://localhost:3000") });
}

async function login(email: string, password: string) {
  const ctx = await newSession();
  const res = await ctx.post("/api/auth/login", { data: { email, password } });
  expect(res.status(), `login ${email}`).toBe(200);
  return ctx;
}

async function register(email: string, name: string, password = "password123") {
  const ctx = await newSession();
  const res = await ctx.post("/api/auth/register", { data: { email, name, password } });
  expect(res.status(), `register ${email}`).toBe(201);
  const me = await ctx.get("/api/auth/me");
  const body = await me.json();
  return { ctx, workspaces: body.workspaces as { id: string; name: string; role: string }[] };
}

test.describe("unauthenticated access is rejected everywhere", () => {
  test("every protected route returns 401 without a session", async () => {
    const anon = await newSession();
    const probes: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; data?: unknown }[] = [
      { method: "GET", path: "/api/auth/me" },
      { method: "GET", path: "/api/workspaces" },
      { method: "POST", path: "/api/workspaces", data: { name: "x" } },
      { method: "PATCH", path: `/api/workspaces/${NIL}`, data: { name: "x" } },
      { method: "GET", path: `/api/workspaces/${NIL}/members` },
      { method: "POST", path: `/api/workspaces/${NIL}/members`, data: { email: "a@b.co", role: "member" } },
      { method: "PATCH", path: `/api/workspaces/${NIL}/members`, data: { userId: NIL, role: "admin" } },
      { method: "DELETE", path: `/api/workspaces/${NIL}/members`, data: { userId: NIL } },
      { method: "GET", path: `/api/projects?workspaceId=${NIL}` },
      { method: "POST", path: "/api/projects", data: { workspaceId: NIL, name: "p", color: "#123456" } },
      { method: "PATCH", path: `/api/projects/${NIL}`, data: { name: "p" } },
      { method: "DELETE", path: `/api/projects/${NIL}` },
      { method: "GET", path: `/api/tasks?workspaceId=${NIL}` },
      { method: "POST", path: "/api/tasks", data: { workspaceId: NIL, projectId: NIL, title: "t" } },
      { method: "GET", path: `/api/tasks/${NIL}` },
      { method: "PATCH", path: `/api/tasks/${NIL}`, data: { title: "t", expectedVersion: 0 } },
      { method: "DELETE", path: `/api/tasks/${NIL}`, data: { expectedVersion: 0 } },
      { method: "POST", path: "/api/tasks/bulk", data: { workspaceId: NIL, ids: [NIL], action: "delete" } },
      { method: "GET", path: `/api/tasks/${NIL}/comments` },
      { method: "POST", path: `/api/tasks/${NIL}/comments`, data: { body: "hi" } },
      { method: "POST", path: `/api/tasks/${NIL}/dependencies`, data: { dependsOnId: NIL } },
      { method: "DELETE", path: `/api/tasks/${NIL}/dependencies`, data: { dependsOnId: NIL } },
      { method: "GET", path: `/api/activity?workspaceId=${NIL}` },
      { method: "GET", path: `/api/notifications?workspaceId=${NIL}` },
      { method: "PATCH", path: "/api/notifications", data: { workspaceId: NIL } },
      { method: "GET", path: `/api/views?workspaceId=${NIL}` },
      { method: "POST", path: "/api/views", data: { workspaceId: NIL, name: "v", config: { q: "", projectId: "", assigneeId: "", priority: "", tag: "", sort: "risk", layout: "board" } } },
      { method: "DELETE", path: "/api/views", data: { workspaceId: NIL, id: NIL } },
      { method: "GET", path: `/api/analytics?workspaceId=${NIL}&days=30` },
      { method: "POST", path: "/api/ai/insights", data: { workspaceId: NIL, days: 30 } },
      // NOTE: /api/auth/logout is intentionally idempotent without a session
      // (clears any cookie, returns 200) — standard logout semantics.
    ];
    for (const p of probes) {
      const res = await anon.fetch(p.path, { method: p.method, data: p.data });
      expect(res.status(), `${p.method} ${p.path} must be 401`).toBe(401);
    }
    await anon.dispose();
  });
});

test.describe("full auth → workspace → membership lifecycle", () => {
  test.setTimeout(120_000);

  test("register auto-provisions a workspace; create/switch/rename; role ladder enforced; leave & remove", async () => {
    /* ---- owner flow ---- */
    const ownerEmail = `owner-${runId}@test.dev`;
    const { ctx: owner, workspaces } = await register(ownerEmail, "Owner One");
    expect(workspaces.length).toBe(1);
    expect(workspaces[0].role).toBe("owner");
    const wsA = workspaces[0].id;

    // create a second workspace and verify both are listed
    const created = await owner.post("/api/workspaces", { data: { name: "Second Lab" } });
    expect(created.status()).toBe(201);
    const wsB = (await created.json()).workspace.id;
    const me = await (await owner.get("/api/auth/me")).json();
    expect(me.workspaces.map((w: { id: string }) => w.id).sort()).toEqual([wsA, wsB].sort());

    // rename (owner ≥ admin)
    expect((await owner.patch(`/api/workspaces/${wsA}`, { data: { name: "Renamed Lab" } })).status()).toBe(200);

    /* ---- invite an existing account as member ---- */
    const memberEmail = `member-${runId}@test.dev`;
    const member = await register(memberEmail, "Member One");
    expect(member.workspaces.length).toBe(1); // own workspace, isolated
    const invite = await owner.post(`/api/workspaces/${wsA}/members`, {
      data: { email: memberEmail, role: "member" },
    });
    expect(invite.status()).toBe(201);
    const tempForExisting = (await invite.json()).tempPassword;
    expect(tempForExisting).toBeUndefined(); // existing accounts keep their own credentials

    const memberLogin = await login(memberEmail, "password123");

    /* ---- member: allowed vs forbidden ---- */
    const projects = await memberLogin.get(`/api/projects?workspaceId=${wsA}`);
    expect(projects.status()).toBe(200);
    const members = await memberLogin.get(`/api/workspaces/${wsA}/members`);
    expect(members.status()).toBe(200);
    expect((await members.json()).members.length).toBe(2);

    expect((await memberLogin.post(`/api/workspaces/${wsA}/members`, { data: { email: `x-${runId}@test.dev`, role: "member" } })).status()).toBe(403);
    expect((await memberLogin.patch(`/api/workspaces/${wsA}`, { data: { name: "Hijack" } })).status()).toBe(403);
    expect((await memberLogin.post("/api/projects", { data: { workspaceId: wsA, name: "Sneaky", color: "#123456" } })).status()).toBe(403);

    // member CAN work on tasks
    const ownerProjects = await (await owner.get(`/api/projects?workspaceId=${wsA}`)).json();
    let projectId = ownerProjects.projects[0]?.id as string | undefined;
    if (!projectId) {
      const p = await owner.post("/api/projects", { data: { workspaceId: wsA, name: "Guild", color: "#7c5cff" } });
      projectId = (await p.json()).project.id;
    }
    const taskRes = await memberLogin.post("/api/tasks", { data: { workspaceId: wsA, projectId, title: "Member task" } });
    expect(taskRes.status()).toBe(201);
    const memberTaskId = (await taskRes.json()).task.id;
    const memberTaskRev = (await taskRes.json()).task.revision;
    expect((await memberLogin.patch(`/api/tasks/${memberTaskId}`, { data: { status: "in_progress", expectedVersion: memberTaskRev } })).status()).toBe(200);

    /* ---- owner promotes member → project_manager ---- */
    const memberId = (await invite.json()).member.id;
    expect((await owner.patch(`/api/workspaces/${wsA}/members`, { data: { userId: memberId, role: "project_manager" } })).status()).toBe(200);
    // PM can now create/edit projects but still not invite
    const pmProject = await memberLogin.post("/api/projects", { data: { workspaceId: wsA, name: "PM Project", color: "#22d3ee" } });
    expect(pmProject.status()).toBe(201);
    const pmProjectId = (await pmProject.json()).project.id;
    expect((await memberLogin.patch(`/api/projects/${pmProjectId}`, { data: { archived: true } })).status()).toBe(200);
    expect((await memberLogin.post(`/api/workspaces/${wsA}/members`, { data: { email: `y-${runId}@test.dev`, role: "member" } })).status()).toBe(403);
    // PM cannot delete projects (admin+)
    expect((await memberLogin.delete(`/api/projects/${pmProjectId}`)).status()).toBe(403);

    /* ---- owner promotes PM → admin ---- */
    expect((await owner.patch(`/api/workspaces/${wsA}/members`, { data: { userId: memberId, role: "admin" } })).status()).toBe(200);
    // admin can delete projects and invite, but NOT change roles (owner-only)
    expect((await memberLogin.delete(`/api/projects/${pmProjectId}`)).status()).toBe(200);
    expect((await owner.patch(`/api/workspaces/${wsA}/members`, { data: { userId: memberId, role: "admin" } })).status()).toBe(200); // owner re-affirms
    // admin invites a brand-new account → one-time credential issued
    const newEmail = `fresh-${runId}@test.dev`;
    const freshInvite = await memberLogin.post(`/api/workspaces/${wsA}/members`, { data: { email: newEmail, name: "Fresh Four", role: "member" } });
    expect(freshInvite.status()).toBe(201);
    const freshBody = await freshInvite.json();
    expect(freshBody.tempPassword).toBeUndefined();
    expect(freshBody.pending).toBe(true);
    expect(freshBody.member).toBeNull();
    const freshLogin = await newSession();
    const registration = await freshLogin.post("/api/auth/register", { data: { email: newEmail, name: "Recipient", password: "recipient-password" } });
    expect(registration.status()).toBe(201);
    const freshId = (await registration.json()).user.id;
    expect((await freshLogin.get(`/api/tasks?workspaceId=${wsA}`)).status()).toBe(200);

    /* ---- owner protection & rank rules ---- */
    const ownerId = me.user.id;
    // admin cannot remove or demote the owner
    expect((await memberLogin.patch(`/api/workspaces/${wsA}/members`, { data: { userId: ownerId, role: "member" } })).status()).toBe(403); // changeRole is owner-only
    expect((await memberLogin.delete(`/api/workspaces/${wsA}/members`, { data: { userId: ownerId } })).status()).toBe(400);
    // admin cannot remove an equal rank (another admin == themselves is leave; test vs owner covered)
    // owner cannot be changed by owner either
    expect((await owner.patch(`/api/workspaces/${wsA}/members`, { data: { userId: ownerId, role: "member" } })).status()).toBe(400);
    // owner cannot leave (workspace must not be orphaned)
    expect((await owner.delete(`/api/workspaces/${wsA}/members`, { data: { userId: ownerId } })).status()).toBe(400);

    /* ---- leave (self-removal) revokes access immediately ---- */
    expect((await freshLogin.delete(`/api/workspaces/${wsA}/members`, { data: { userId: freshId } })).status()).toBe(200);
    expect((await freshLogin.get(`/api/tasks?workspaceId=${wsA}`)).status()).toBe(404);
    expect((await freshLogin.get(`/api/analytics?workspaceId=${wsA}`)).status()).toBe(404);

    /* ---- owner removes admin; access revoked ---- */
    expect((await owner.delete(`/api/workspaces/${wsA}/members`, { data: { userId: memberId } })).status()).toBe(200);
    expect((await memberLogin.get(`/api/tasks?workspaceId=${wsA}`)).status()).toBe(404);
    expect((await memberLogin.get(`/api/workspaces/${wsA}/members`)).status()).toBe(404);
    // former member still owns their OWN workspace (tenants are independent)
    expect((await memberLogin.get(`/api/tasks?workspaceId=${member.workspaces[0].id}`)).status()).toBe(200);

    /* ---- cleanup ---- */
    const latest = await (await owner.get(`/api/tasks/${memberTaskId}`)).json();
    expect((await owner.delete(`/api/tasks/${memberTaskId}`, { data: { expectedVersion: latest.task.revision } })).status()).toBe(200);
    for (const c of [owner, memberLogin, freshLogin]) await c.dispose();
  });
});

test.describe("cross-workspace isolation (tenant B vs seeded tenant A)", () => {
  test.setTimeout(90_000);

  test("reads and mutations against another tenant's workspace are 404", async () => {
    const ava = await login("ava@e2e.test", "demo1234");
    const me = await (await ava.get("/api/auth/me")).json();
    const wsA = me.workspaces[0].id;
    const tasksA = await (await ava.get(`/api/tasks?workspaceId=${wsA}`)).json();
    const taskA = tasksA.tasks[0].id;
    const projectsA = await (await ava.get(`/api/projects?workspaceId=${wsA}`)).json();
    const projectA = projectsA.projects[0].id;

    const intruder = (await register(`intruder-${runId}@test.dev`, "Tenant B")).ctx;
    const wsB = (await (await intruder.get("/api/auth/me")).json()).workspaces[0].id;
    expect(wsB).not.toBe(wsA);

    // ---- cross-workspace READS → 404 ----
    const reads = [
      `/api/tasks?workspaceId=${wsA}`,
      `/api/projects?workspaceId=${wsA}`,
      `/api/analytics?workspaceId=${wsA}`,
      `/api/activity?workspaceId=${wsA}`,
      `/api/notifications?workspaceId=${wsA}`,
      `/api/views?workspaceId=${wsA}`,
      `/api/workspaces/${wsA}/members`,
      `/api/tasks/${taskA}`,
      `/api/tasks/${taskA}/comments`,
    ];
    for (const path of reads) {
      expect((await intruder.get(path)).status(), `GET ${path} must be 404`).toBe(404);
    }

    // ---- cross-workspace MUTATIONS → 404 ----
    const mutations: { method: "POST" | "PATCH" | "DELETE"; path: string; data?: unknown }[] = [
      { method: "POST", path: "/api/tasks", data: { workspaceId: wsA, projectId: projectA, title: "injected" } },
      { method: "PATCH", path: `/api/tasks/${taskA}`, data: { title: "hijacked", expectedVersion: 0 } },
      { method: "DELETE", path: `/api/tasks/${taskA}`, data: { expectedVersion: 0 } },
      { method: "POST", path: "/api/tasks/bulk", data: { workspaceId: wsA, ids: [taskA], action: "delete", expected: [{ id: taskA, revision: 0 }] } },
      { method: "POST", path: `/api/tasks/${taskA}/comments`, data: { body: "cross-tenant comment" } },
      { method: "POST", path: `/api/tasks/${taskA}/dependencies`, data: { dependsOnId: taskA } },
      { method: "POST", path: "/api/projects", data: { workspaceId: wsA, name: "injected", color: "#123456" } },
      { method: "PATCH", path: `/api/projects/${projectA}`, data: { name: "hijacked" } },
      { method: "DELETE", path: `/api/projects/${projectA}` },
      { method: "PATCH", path: `/api/workspaces/${wsA}`, data: { name: "hijacked" } },
      { method: "POST", path: `/api/workspaces/${wsA}/members`, data: { email: `spy-${runId}@test.dev`, role: "member" } },
      { method: "PATCH", path: "/api/notifications", data: { workspaceId: wsA } },
      { method: "POST", path: "/api/ai/insights", data: { workspaceId: wsA, days: 30 } },
      { method: "POST", path: "/api/views", data: { workspaceId: wsA, name: "spy view", config: { q: "", projectId: "", assigneeId: "", priority: "", tag: "", sort: "risk", layout: "board" } } },
      { method: "DELETE", path: "/api/views", data: { workspaceId: wsA, id: taskA } },
    ];
    for (const m of mutations) {
      const res = await intruder.fetch(m.path, { method: m.method, data: m.data });
      expect(res.status(), `${m.method} ${m.path} must be 404`).toBe(404);
    }

    // tenant B's own workspace still works (isolation is not a global lockout)
    expect((await intruder.get(`/api/tasks?workspaceId=${wsB}`)).status()).toBe(200);

    await ava.dispose();
    await intruder.dispose();
  });
});

test.describe("input validation & CSRF", () => {
  test("Zod rejects malformed input with 400 and cross-origin mutations with 403", async () => {
    const ava = await login("ava@e2e.test", "demo1234");
    const me = await (await ava.get("/api/auth/me")).json();
    const wsA = me.workspaces[0].id;
    const projectsA = await (await ava.get(`/api/projects?workspaceId=${wsA}`)).json();
    const projectA = projectsA.projects[0].id;

    expect((await ava.post("/api/tasks", { data: { workspaceId: wsA, projectId: projectA, title: "" } })).status()).toBe(400);
    expect((await ava.post("/api/tasks", { data: { workspaceId: wsA, projectId: projectA, title: "x", status: "shipped" } })).status()).toBe(400);
    expect((await ava.post("/api/projects", { data: { workspaceId: wsA, name: "x", color: "red" } })).status()).toBe(400);
    expect((await ava.post(`/api/workspaces/${wsA}/members`, { data: { email: "not-an-email", role: "member" } })).status()).toBe(400);
    expect((await ava.post(`/api/workspaces/${wsA}/members`, { data: { email: `z-${runId}@test.dev`, role: "owner" } })).status()).toBe(400);
    expect((await ava.get(`/api/analytics?workspaceId=${wsA}&days=9999`)).status()).toBe(400);
    expect((await ava.post("/api/tasks/bulk", { data: { workspaceId: wsA, ids: [], action: "delete" } })).status()).toBe(400);

    // CSRF: same session, foreign Origin → 403
    const csrf = await ava.fetch("/api/tasks", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      data: { workspaceId: wsA, projectId: projectA, title: "csrf probe" },
    });
    expect(csrf.status()).toBe(403);

    await ava.dispose();
  });
});
