/**
 * Live integration smoke test against a running server (default http://localhost:3000).
 * Exercises auth, tenant isolation, lifecycle events, dependency cycles, CSRF origin
 * checks, and analytics consistency. Run: node scripts/smoke.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
};

function jar() {
  let cookie = "";
  return {
    async req(path, method = "GET", body, headers = {}) {
      const res = await fetch(BASE + path, {
        method,
        redirect: "manual",
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const c of setCookie) {
        const pair = c.split(";")[0];
        if (pair.startsWith("cadence_session=")) cookie = pair;
      }
      let data = null;
      try {
        data = await res.json();
      } catch {}
      return { status: res.status, data };
    },
  };
}

const ava = jar();
const intruder = jar();

console.log("1. Auth");
let r = await ava.req("/api/tasks?workspaceId=00000000-0000-4000-8000-000000000000");
ok(r.status === 401, "unauthenticated API access rejected (401)");
r = await ava.req("/api/auth/login", "POST", { email: "ava@cadence.dev", password: "wrong-password" });
ok(r.status === 401, "wrong password rejected");
r = await ava.req("/api/auth/login", "POST", { email: "ava@cadence.dev", password: "demo1234" });
ok(r.status === 200 && r.data?.user?.email === "ava@cadence.dev", "demo login succeeds");
r = await ava.req("/api/auth/me");
const ws = r.data?.workspaces?.[0];
ok(r.status === 200 && !!ws?.id, "session resolves user + workspace");

console.log("2. CSRF origin check");
r = await ava.req("/api/tasks", "POST", { workspaceId: ws.id, projectId: "x", title: "x" }, { origin: "https://evil.example" });
ok(r.status === 403, "cross-origin mutation rejected (403)");

console.log("3. Data + analytics");
r = await ava.req(`/api/tasks?workspaceId=${ws.id}`);
const tasks = r.data?.tasks ?? [];
ok(r.status === 200 && tasks.length === 50 && r.data.pagination.total > 80 && r.data.pagination.hasMore, `task list paginated (50 of ${r.data?.pagination?.total})`);
const openTask = tasks.find((t) => t.status !== "done");
ok(!!openTask?.risk && openTask.risk.factors.length === 4 && openTask.risk.modelVersion === "2.0.0", "open tasks carry 4-factor v2.0.0 risk assessments");
ok(openTask.risk.interval.low <= openTask.risk.score && openTask.risk.score <= openTask.risk.interval.high, "risk interval contains the score");
ok(["high", "medium", "low"].includes(openTask.risk.confidence), "risk carries a confidence level");
const weightSum = openTask.risk.factors.reduce((a, f) => a + f.weight, 0);
ok(Math.abs(weightSum - 1) < 1e-9, "risk weights sum to 1");
const contribSum = openTask.risk.factors.reduce((a, f) => a + f.contribution, 0);
ok(Math.abs(contribSum - openTask.risk.score) < 1e-9, "risk contributions sum exactly to the score");
r = await ava.req(`/api/analytics?workspaceId=${ws.id}&days=30`);
const a = r.data?.analytics;
ok(r.status === 200 && a?.daily?.length === 30, "analytics: 30 daily buckets");
ok(a?.totals?.completed > 0 && a?.cycle?.count > 0, `analytics: completions=${a?.totals?.completed}, cycle n=${a?.cycle?.count}`);
const dailySum = a.daily.reduce((s, d) => s + d.completed, 0);
ok(dailySum === a.totals.completed, "analytics: daily sums equal totals");
ok(a.cfd.length === 30 && a.cfd.every((p) => p.backlog + p.todo + p.in_progress + p.review + p.done >= 0), "CFD reconstructed for 30 days");
// Isolated user for the rate-limited AI endpoint: the limiter is per-user and
// shared across suites, so consuming ava's budget here made this check flaky.
const smokeAiEmail = `smoke-ai-${Date.now()}@test.dev`;
const smokeAi = jar();
await smokeAi.req("/api/auth/register", "POST", { email: smokeAiEmail, name: "Smoke AI", password: "password123" });
ok((await ava.req(`/api/workspaces/${ws.id}/members`, "POST", { email: smokeAiEmail, role: "member" })).status === 201, "isolated AI user invited into workspace");
r = await smokeAi.req("/api/ai/insights", "POST", { workspaceId: ws.id, days: 30 });
ok(r.status === 200 && r.data?.mode === "deterministic" && r.data?.insights?.length >= 3, "insights: honest deterministic mode with content");

console.log("4. Task lifecycle + events");
r = await ava.req(`/api/projects?workspaceId=${ws.id}`);
const projectId = r.data.projects[0].id;
r = await ava.req("/api/tasks", "POST", { workspaceId: ws.id, projectId, title: "Smoke probe task", priority: "high", estimatePoints: 3 });
const probe = r.data?.task;
ok(r.status === 201 && !!probe?.id, "create task");
r = await ava.req(`/api/tasks/${probe.id}`, "PATCH", { status: "in_progress", expectedVersion: probe.revision });
ok(r.status === 200 && r.data.task.startedAt !== null, "start sets startedAt");
const stale = await ava.req(`/api/tasks/${probe.id}`, "PATCH", { status: "done", expectedVersion: probe.revision });
ok(stale.status === 409, "stale revision rejected (409)");
r = await ava.req(`/api/tasks/${probe.id}`, "PATCH", { status: "done", expectedVersion: r.data.task.revision });
ok(r.status === 200 && r.data.task.completedAt !== null && r.data.task.risk === null, "complete sets completedAt, clears risk");
r = await ava.req(`/api/tasks/${probe.id}`);
const types = r.data.task.events.map((e) => e.type);
ok(types.includes("created") && types.includes("status_changed") && types.includes("completed"), "event log records full lifecycle");
r = await ava.req(`/api/tasks/${probe.id}`, "PATCH", { status: "todo", expectedVersion: (await ava.req(`/api/tasks/${probe.id}`)).data.task.revision });
ok(r.data.task.completedAt === null, "reopen clears completedAt");
r = await ava.req(`/api/tasks/${probe.id}/comments`, "POST", { body: "Smoke comment" });
ok(r.status === 201, "comment created");

console.log("5. Dependency cycle prevention");
r = await ava.req("/api/tasks", "POST", { workspaceId: ws.id, projectId, title: "Smoke dep A" });
const depA = r.data.task;
r = await ava.req("/api/tasks", "POST", { workspaceId: ws.id, projectId, title: "Smoke dep B" });
const depB = r.data.task;
r = await ava.req(`/api/tasks/${depA.id}/dependencies`, "POST", { dependsOnId: depB.id });
ok(r.status === 201, "dependency A→B added");
r = await ava.req(`/api/tasks/${depB.id}/dependencies`, "POST", { dependsOnId: depA.id });
ok(r.status === 400 && /cycle/i.test(r.data.error), "cycle B→A rejected (400)");

console.log("6. Delete + undo + bulk");
const rev = async (id) => (await ava.req(`/api/tasks/${id}`)).data.task.revision;
r = await ava.req(`/api/tasks/${probe.id}`, "DELETE", { expectedVersion: await rev(probe.id) });
ok(r.status === 200, "soft delete");
r = await ava.req(`/api/tasks/${probe.id}`, "PATCH", { restore: true, expectedVersion: r.data.revision });
ok(r.status === 200, "undo restores");
const ids3 = [probe.id, depA.id, depB.id];
const expected3 = await Promise.all(ids3.map(async (id) => ({ id, revision: await rev(id) })));
r = await ava.req("/api/tasks/bulk", "POST", { workspaceId: ws.id, ids: ids3, action: "delete" });
ok(r.status === 428, "bulk without revisions rejected (428)");
r = await ava.req("/api/tasks/bulk", "POST", { workspaceId: ws.id, ids: ids3, action: "delete", expected: expected3 });
ok(r.status === 200 && r.data.affected === 3, "bulk delete affected 3");
r = await ava.req("/api/tasks/bulk", "POST", { workspaceId: ws.id, ids: ids3, action: "restore", expected: r.data.expected });
ok(r.status === 200 && r.data.affected === 3, "bulk undo restored 3");
r = await ava.req("/api/tasks/bulk", "POST", { workspaceId: ws.id, ids: ids3, action: "delete", expected: r.data.expected });
ok(r.status === 200, "cleanup: probes removed");

console.log("7. Tenant isolation");
r = await intruder.req("/api/auth/register", "POST", {
  email: `intruder-${Date.now()}@test.dev`,
  name: "Intruder",
  password: "password123",
});
ok(r.status === 201, "second tenant registered");
r = await intruder.req(`/api/analytics?workspaceId=${ws.id}`);
ok(r.status === 404, "cross-tenant analytics → 404");
r = await intruder.req(`/api/tasks/${openTask.id}`);
ok(r.status === 404, "cross-tenant task read → 404");
r = await intruder.req(`/api/tasks/${openTask.id}`, "PATCH", { title: "hijacked", expectedVersion: 0 });
ok(r.status === 404, "cross-tenant task write → 404");
r = await intruder.req(`/api/workspaces/${ws.id}/members`);
ok(r.status === 404, "cross-tenant member list → 404");
r = await intruder.req("/api/tasks/bulk", "POST", { workspaceId: ws.id, ids: [openTask.id], action: "delete", expected: [{ id: openTask.id, revision: 0 }] });
ok(r.status === 404, "cross-tenant bulk → 404");

console.log("8. Validation + notifications");
r = await ava.req("/api/tasks", "POST", { workspaceId: ws.id, projectId, title: "" });
ok(r.status === 400, "empty title rejected (Zod)");
r = await ava.req(`/api/notifications?workspaceId=${ws.id}`);
const unreadBefore = (r.data?.notifications ?? []).filter((n) => !n.readAt).length;
ok(r.status === 200, `notifications list (unread=${unreadBefore})`);
r = await ava.req("/api/notifications", "PATCH", { workspaceId: ws.id });
ok(r.status === 200, "mark all read");
r = await ava.req(`/api/notifications?workspaceId=${ws.id}`);
ok((r.data?.notifications ?? []).every((n) => n.readAt), "all notifications now read");

console.log("9. Pages");
const login = await fetch(BASE + "/login");
ok(login.status === 200 && (await login.text()).includes("FactoVision"), "login page renders");
const health = await fetch(BASE + "/api/health");
ok(health.status === 200, "health endpoint ok");

console.log(`\nSMOKE RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);