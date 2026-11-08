import { expect, request, test, type APIRequestContext } from "@playwright/test";

/**
 * Phase 8 audit E2E. Fresh tenants per run (no reliance on seeded demo data),
 * so every assertion is about behaviour, not fixture numbers.
 */
test.describe.configure({ mode: "serial" });

const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000");
const RUN = Date.now();
const NIL = "00000000-0000-4000-8000-000000000000";
const cred = (tag: string) => ({ email: `audit-${tag}-${RUN}@test.dev`, name: `Audit ${tag} ${RUN}`, password: "password123" });

interface Actor { ctx: APIRequestContext; id: string; ws: string; }
const actors: Record<string, Actor> = {};

async function register(tag: string): Promise<Actor> {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.post("/api/auth/register", { data: cred(tag) });
  expect(res.status(), `register ${tag}`).toBe(201);
  const me = await (await ctx.get("/api/auth/me")).json();
  return { ctx, id: me.user.id, ws: me.workspaces[0].id };
}

/** Cookie token from a response, so rotation can be verified explicitly. */
function sessionToken(res: Awaited<ReturnType<APIRequestContext["post"]>>): string {
  const raw = res.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "";
  const token = /cadence_session=([^;]+)/.exec(raw)?.[1];
  if (!token) throw new Error(`no session cookie in: ${raw}`);
  return token;
}

let projectId: string;
let taskA: { id: string; revision: number };
let taskB: string;

test.beforeAll(async () => {
  actors.a = await register("owner");
  actors.b = await register("intruder");
  actors.c = await register("member");
  actors.d = await register("journey");

  const p = await actors.a.ctx.post("/api/projects", { data: { workspaceId: actors.a.ws, name: "Audit project", color: "#7c5cff" } });
  expect(p.status()).toBe(201);
  projectId = (await p.json()).project.id;

  const invite = await actors.a.ctx.post(`/api/workspaces/${actors.a.ws}/members`, { data: { email: cred("member").email, role: "member" } });
  expect(invite.status()).toBe(201);

  const t1 = await actors.a.ctx.post("/api/tasks", { data: { workspaceId: actors.a.ws, projectId, title: "Audit task one" } });
  const t2 = await actors.a.ctx.post("/api/tasks", { data: { workspaceId: actors.a.ws, projectId, title: "Audit task two" } });
  expect(t1.status()).toBe(201);
  expect(t2.status()).toBe(201);
  const first = (await t1.json()).task;
  taskA = { id: first.id, revision: first.revision };
  taskB = (await t2.json()).task.id;
});

test.afterAll(async () => {
  for (const actor of Object.values(actors)) await actor?.ctx.dispose();
});

test.describe("authentication", () => {
  test("login rotates the session: the pre-login token stops working", async () => {
    const ctx = await request.newContext({ baseURL: BASE });
    const res = await ctx.post("/api/auth/register", { data: cred("rotation") });
    expect(res.status()).toBe(201);
    const oldToken = sessionToken(res);
    const fresh = await ctx.post("/api/auth/login", { data: { email: cred("rotation").email, password: cred("rotation").password } });
    expect(fresh.status()).toBe(200);
    expect(sessionToken(fresh)).not.toBe(oldToken);
    const stale = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: `cadence_session=${oldToken}` } });
    expect((await stale.get("/api/auth/me")).status()).toBe(401);
    expect((await ctx.get("/api/auth/me")).status()).toBe(200); // new token still works
    await stale.dispose();
    await ctx.dispose();
  });

  test("concurrent duplicate registration: one 201, one 409, no 500 or orphan workspace", async () => {
    const body = cred("race");
    const ctx1 = await request.newContext({ baseURL: BASE });
    const ctx2 = await request.newContext({ baseURL: BASE });
    const [r1, r2] = await Promise.all([
      ctx1.post("/api/auth/register", { data: body }),
      ctx2.post("/api/auth/register", { data: body }),
    ]);
    const statuses = [r1.status(), r2.status()].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = r1.status() === 201 ? ctx1 : ctx2;
    const me = await (await winner.get("/api/auth/me")).json();
    expect(me.workspaces).toHaveLength(1);
    expect((await winner.post("/api/auth/register", { data: body })).status()).toBe(409);
    await ctx1.dispose();
    await ctx2.dispose();
  });

  test("logout revokes the session", async () => {
    const ctx = await request.newContext({ baseURL: BASE });
    const res = await ctx.post("/api/auth/register", { data: cred("logout") });
    const token = sessionToken(res);
    expect((await ctx.post("/api/auth/logout")).status()).toBe(200);
    const stale = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: `cadence_session=${token}` } });
    expect((await stale.get("/api/auth/me")).status()).toBe(401);
    await stale.dispose();
    await ctx.dispose();
  });
});

test.describe("tenant isolation", () => {
  test("all read endpoints deny another workspace (404, not data)", async () => {
    const paths = [
      `/api/tasks?workspaceId=${actors.a.ws}`,
      `/api/projects?workspaceId=${actors.a.ws}`,
      `/api/activity?workspaceId=${actors.a.ws}`,
      `/api/notifications?workspaceId=${actors.a.ws}`,
      `/api/views?workspaceId=${actors.a.ws}`,
      `/api/dashboard?workspaceId=${actors.a.ws}`,
      `/api/analytics/report?workspaceId=${actors.a.ws}`,
      `/api/risk/config?workspaceId=${actors.a.ws}`,
      `/api/tasks/${taskA.id}`,
      `/api/tasks/${taskA.id}/comments`,
    ];
    for (const p of paths) {
      const res = await actors.b.ctx.get(p);
      expect(res.status(), p).toBe(404);
    }
  });

  test("all write endpoints deny another workspace", async () => {
    const writes: [string, string, object][] = [
      ["POST", "/api/ai/insights", { workspaceId: actors.a.ws, days: 30 }],
      ["POST", "/api/tasks", { workspaceId: actors.a.ws, projectId, title: "intrusion" }],
      ["POST", `/api/tasks/${taskA.id}/comments`, { body: "intrusion" }],
      ["PATCH", "/api/notifications", { workspaceId: actors.a.ws }],
      ["PUT", "/api/risk/config", { workspaceId: actors.a.ws, expectedRevision: 0, config: {} }],
    ];
    for (const [method, path, data] of writes) {
      const res = await actors.b.ctx.fetch(path, { method, data });
      expect(res.status(), `${method} ${path}`).toBe(404);
    }
  });

  test("a foreign project id used with the caller's own workspace is 404, never a leak", async () => {
    expect((await actors.b.ctx.get(`/api/analytics/report?workspaceId=${actors.b.ws}&projectId=${projectId}`)).status()).toBe(404);
    expect((await actors.b.ctx.get(`/api/dashboard?workspaceId=${actors.b.ws}&projectId=${projectId}`)).status()).toBe(404);
  });

  test("unauthenticated access to the newer endpoints is 401", async () => {
    const anon = await request.newContext({ baseURL: BASE });
    for (const p of [`/api/dashboard?workspaceId=${NIL}`, `/api/analytics/report?workspaceId=${NIL}`, `/api/risk/config?workspaceId=${NIL}`]) {
      expect((await anon.get(p)).status(), p).toBe(401);
    }
    await anon.dispose();
  });
});

test.describe("empty datasets", () => {
  test("a brand-new workspace: 200 with nulls/empties, never NaN or 500", async () => {
    const report = await actors.d.ctx.get(`/api/analytics/report?workspaceId=${actors.d.ws}&days=30`);
    expect(report.status()).toBe(200);
    const r = (await report.json()).report;
    expect(r.population).toEqual({ tasks: 0, open: 0 });
    expect(r.completionRate.rate).toBeNull();
    expect(r.timing.cycle).toMatchObject({ count: 0, mean: null, p50: null, p85: null });
    expect(r.onTime.rate).toBeNull();
    expect(r.overdue.share).toBeNull();
    expect(r.blocked.share).toBeNull();
    expect(r.workload.active.coverage).toBeNull();
    expect(r.daily).toHaveLength(30);
    expect(r.daily.every((d: { created: number; completed: number }) => d.created === 0 && d.completed === 0)).toBe(true);

    const dashboard = await actors.d.ctx.get(`/api/dashboard?workspaceId=${actors.d.ws}`);
    expect(dashboard.status()).toBe(200);
    const d = (await dashboard.json()).dashboard;
    expect(d.summary.openTasks).toBe(0);
    expect(d.risk.items).toEqual([]);
    expect(d.projectProgress.every((p: { completionShare: number | null }) => p.completionShare === null)).toBe(true);

    for (const p of [`/api/tasks?workspaceId=${actors.d.ws}`, `/api/activity?workspaceId=${actors.d.ws}`, `/api/notifications?workspaceId=${actors.d.ws}`]) {
      const res = await actors.d.ctx.get(p);
      expect(res.status(), p).toBe(200);
      const body = await res.json();
      const list = body.tasks ?? body.items;
      expect(Array.isArray(list)).toBe(true);
    }
  });

  test("a replay instant before any data yields an empty, well-formed report", async () => {
    const res = await actors.a.ctx.get(`/api/analytics/report?workspaceId=${actors.a.ws}&days=30&asOf=2020-01-01T00:00:00.000Z`);
    expect(res.status()).toBe(200);
    const r = (await res.json()).report;
    expect(r.population.tasks).toBe(0);
    expect(r.completionRate.rate).toBeNull();
    expect(r.throughput).toEqual({ created: 0, completed: 0, reopened: 0, net: 0 });
  });
});

test.describe("date boundaries and validation", () => {
  test("days=1 and days=366 are valid; 0, 367 and non-integers are 400", async () => {
    for (const days of [1, 366]) {
      const res = await actors.a.ctx.get(`/api/analytics/report?workspaceId=${actors.a.ws}&days=${days}`);
      expect(res.status(), `days=${days}`).toBe(200);
      expect((await res.json()).report.daily).toHaveLength(days);
    }
    for (const days of [0, 367, 2.5]) {
      expect((await actors.a.ctx.get(`/api/analytics/report?workspaceId=${actors.a.ws}&days=${days}`)).status(), `days=${days}`).toBe(400);
    }
  });

  test("DST: a New York two-day window spanning spring-forward is 47 hours", async () => {
    const res = await actors.a.ctx.get(`/api/analytics/report?workspaceId=${actors.a.ws}&days=2&tz=America/New_York&asOf=2026-03-09T15:00:00.000Z`);
    expect(res.status()).toBe(200);
    const w = (await res.json()).report.window;
    expect(w.startDay).toBe("2026-03-08");
    expect(w.endDay).toBe("2026-03-09");
    expect((Date.parse(w.endExclusive) - Date.parse(w.start)) / 3_600_000).toBe(47);
  });

  test("future asOf, unknown zone and malformed filters are rejected", async () => {
    const future = encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString());
    for (const qs of [`asOf=${future}`, "tz=Mars/Olympus", "assigneeId=not-a-uuid", "priority=critical", "label="]) {
      expect((await actors.a.ctx.get(`/api/analytics/report?workspaceId=${actors.a.ws}&${qs}`)).status(), qs).toBe(400);
    }
  });
});

test.describe("duplicate requests", () => {
  test("adding the same dependency twice is a no-op", async () => {
    const body = { dependsOnId: taskB };
    expect((await actors.a.ctx.post(`/api/tasks/${taskA.id}/dependencies`, { data: body })).status()).toBe(201);
    expect((await actors.a.ctx.post(`/api/tasks/${taskA.id}/dependencies`, { data: body })).status()).toBe(201);
    const detail = await (await actors.a.ctx.get(`/api/tasks/${taskA.id}`)).json();
    expect(detail.task.blockedBy.filter((d: { id: string }) => d.id === taskB)).toHaveLength(1);
  });

  test("duplicate comment POSTs do not duplicate notifications for the same person", async () => {
    const t = await actors.a.ctx.post("/api/tasks", { data: { workspaceId: actors.a.ws, projectId, title: "Notify target", assigneeId: actors.c.id } });
    expect(t.status()).toBe(201);
    const id = (await t.json()).task.id;
    for (let i = 0; i < 2; i++) {
      expect((await actors.a.ctx.post(`/api/tasks/${id}/comments`, { data: { body: `duplicate body ${RUN}` } })).status()).toBe(201);
    }
    const n = await (await actors.c.ctx.get(`/api/notifications?workspaceId=${actors.a.ws}&limit=50`)).json();
    const commentNotifs = n.items.filter((x: { taskId: string; kind: string }) => x.taskId === id && x.kind === "comment");
    expect(commentNotifs).toHaveLength(1);
    expect((await actors.c.ctx.patch("/api/notifications", { data: { workspaceId: actors.a.ws } })).status()).toBe(200);
    const again = await (await actors.c.ctx.patch("/api/notifications", { data: { workspaceId: actors.a.ws } })).json();
    expect(again.updated).toBe(0);
  });

  test("stale duplicate writes fail loudly (409) instead of silently applying", async () => {
    const rev = (await (await actors.a.ctx.get(`/api/tasks/${taskA.id}`)).json()).task.revision;
    const bulk = { workspaceId: actors.a.ws, ids: [taskA.id], action: "delete", expected: [{ id: taskA.id, revision: rev }] };
    expect((await actors.a.ctx.post("/api/tasks/bulk", { data: bulk })).status()).toBe(200);
    expect((await actors.a.ctx.post("/api/tasks/bulk", { data: bulk })).status()).toBe(409);
    const cfg = (await (await actors.a.ctx.get(`/api/risk/config?workspaceId=${actors.a.ws}`)).json()).riskConfig;
    const put = { workspaceId: actors.a.ws, expectedRevision: cfg.revision, config: cfg.config };
    expect((await actors.a.ctx.put("/api/risk/config", { data: put })).status()).toBe(200);
    expect((await actors.a.ctx.put("/api/risk/config", { data: put })).status()).toBe(409);
  });
});

test.describe("failed external services", () => {
  test("no AI credentials: deterministic mode, cited evidence, no secret in the body", async () => {
    const res = await actors.d.ctx.post("/api/ai/insights", { data: { workspaceId: actors.d.ws, days: 30 } });
    expect(res.status()).toBe(200);
    const dto = await res.json();
    expect(dto.mode).toBe("deterministic");
    expect(dto.evidenceCount).toBeGreaterThan(5);
    expect(dto.insights.every((i: { evidenceRefs: string[] }) => i.evidenceRefs.length > 0)).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("sk-");
    // Core analytics remain available in the same request window
    expect((await actors.d.ctx.get(`/api/analytics/report?workspaceId=${actors.d.ws}`)).status()).toBe(200);
  });

  test("UI shows an explicit error state when the insights request fails, dashboard still renders", async ({ page }) => {
    await page.route("**/api/ai/insights", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Provider unavailable" }) }));
    await page.goto("/login");
    await page.fill('input[type="email"]', cred("journey").email);
    await page.fill('input[type="password"]', cred("journey").password);
    await page.getByRole("button", { name: "Sign in" }).last().click();
    await page.waitForURL("**/app");
    await expect(page.getByTestId("ai-panel").getByRole("alert")).toContainText("Provider unavailable", { timeout: 25_000 });
    await expect(page.getByTestId("kpi-completed-value")).toBeVisible();
  });
});

test.describe("critical journey", () => {
  test("create project → task → comment → legal status flow → completion shows up in dashboard, report and activity", async () => {
    const j = actors.d;
    const p = await j.ctx.post("/api/projects", { data: { workspaceId: j.ws, name: "Journey", color: "#22d3ee" } });
    expect(p.status()).toBe(201);
    const pid = (await p.json()).project.id;
    const t = await j.ctx.post("/api/tasks", { data: { workspaceId: j.ws, projectId: pid, title: `Journey task ${RUN}`, estimatePoints: 3, labels: ["audit"] } });
    expect(t.status()).toBe(201);
    const task = (await t.json()).task;
    expect(task.labels).toEqual(["audit"]);

    expect((await j.ctx.post(`/api/tasks/${task.id}/comments`, { data: { body: "acceptance criteria attached" } })).status()).toBe(201);
    // Illegal backlog → done is rejected; legal backlog → in_progress → done succeeds.
    expect((await j.ctx.patch(`/api/tasks/${task.id}`, { data: { status: "done", expectedVersion: task.revision } })).status()).toBe(400);
    const started = await j.ctx.patch(`/api/tasks/${task.id}`, { data: { status: "in_progress", expectedVersion: task.revision } });
    expect(started.status()).toBe(200);
    const rev2 = (await started.json()).task.revision;
    expect((await j.ctx.patch(`/api/tasks/${task.id}`, { data: { status: "done", expectedVersion: rev2 } })).status()).toBe(200);

    const detail = await (await j.ctx.get(`/api/tasks/${task.id}`)).json();
    const types = detail.task.events.map((e: { type: string }) => e.type);
    expect(types).toContain("created");
    expect(types).toContain("status_changed");
    expect(types).toContain("completed");
    expect(types).toContain("commented");
    expect(detail.task.comments).toHaveLength(1);

    const report = await (await j.ctx.get(`/api/analytics/report?workspaceId=${j.ws}&days=7`)).json();
    expect(report.report.throughput.completed).toBe(1);
    expect(report.report.timing.lead.count).toBe(1);
    const dashboard = await (await j.ctx.get(`/api/dashboard?workspaceId=${j.ws}&days=7`)).json();
    expect(dashboard.dashboard.summary.completed).toBe(1);
    const activity = await (await j.ctx.get(`/api/activity?workspaceId=${j.ws}&limit=20`)).json();
    expect(activity.items.some((a: { type: string; taskId: string }) => a.type === "completed" && a.taskId === task.id)).toBe(true);
  });
});
