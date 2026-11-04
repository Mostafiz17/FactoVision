/**
 * Phase 5 live verification against a running, seeded server (default http://localhost:3000).
 * Checks the report endpoint: authentication, tenant isolation, validation, filter scope,
 * as-of determinism, and internal consistency of totals against daily and weekly series.
 * Run: node scripts/analytics-live.mjs
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

function client() {
  let cookie = "";
  return {
    async get(path) {
      const res = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const pair = c.split(";")[0];
        if (pair.startsWith("cadence_session=")) cookie = pair;
      }
      let data = null;
      try {
        data = await res.json();
      } catch {}
      return { status: res.status, data };
    },
    async post(path, body) {
      const res = await fetch(BASE + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
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

const ava = client();
const mira = client();
const intruder = client();
const anon = client();

console.log("1. Authentication and tenancy");
let r = await ava.post("/api/auth/login", { email: "ava@cadence.dev", password: "demo1234" });
ok(r.status === 200, "owner login");
await mira.post("/api/auth/login", { email: "mira@cadence.dev", password: "demo1234" });
r = await ava.get("/api/auth/me");
const ws = r.data.workspaces[0].id;
r = await anon.get(`/api/analytics/report?workspaceId=${ws}`);
ok(r.status === 401, "unauthenticated report → 401");
const reg = await intruder.post("/api/auth/register", { email: `live-analytics-${Date.now()}@test.dev`, name: "Intruder", password: "password123" });
ok(reg.status === 201, "second tenant registered");
r = await intruder.get(`/api/analytics/report?workspaceId=${ws}`);
ok(r.status === 404, "cross-tenant report → 404");
r = await mira.get(`/api/analytics/report?workspaceId=${ws}&days=7`);
ok(r.status === 200, "member (analytics.read) may read the report");

console.log("2. Validation");
r = await ava.get(`/api/analytics/report?workspaceId=${ws}&tz=Mars/Olympus`);
ok(r.status === 400, "unknown time zone → 400");
r = await ava.get(`/api/analytics/report?workspaceId=${ws}&days=0`);
ok(r.status === 400, "days=0 → 400");
r = await ava.get(`/api/analytics/report?workspaceId=${ws}&days=367`);
ok(r.status === 400, "days=367 → 400");
r = await ava.get(`/api/analytics/report?workspaceId=${ws}&asOf=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`);
ok(r.status === 400, "future asOf → 400");
r = await ava.get(`/api/analytics/report?workspaceId=${ws}&assigneeId=not-a-uuid`);
ok(r.status === 400, "malformed assignee filter → 400");
r = await ava.get(`/api/analytics/report?workspaceId=${ws}&projectId=00000000-0000-4000-8000-000000000000`);
ok(r.status === 404, "unknown project filter → 404 (same as foreign project)");

console.log("3. Report content and internal consistency");
r = await ava.get(`/api/analytics/report?workspaceId=${ws}&days=30&tz=America/New_York`);
ok(r.status === 200, "30-day New York report");
const rep = r.data.report;
ok(rep.daily.length === 30, "daily series has one entry per local day");
ok(rep.window.timeZone === "America/New_York" && rep.window.days === 30, "window echoes time zone and length");
const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
ok(sum(rep.daily, "completed") === rep.throughput.completed, "Σ daily completed = throughput.completed");
ok(sum(rep.daily, "reopened") === rep.throughput.reopened, "Σ daily reopened = throughput.reopened");
ok(sum(rep.daily, "created") === rep.throughput.created, "Σ daily created = throughput.created");
ok(sum(rep.weekly, "completed") === rep.throughput.completed, "Σ weekly completed = throughput.completed");
ok(rep.weekly.every((w) => new Date(w.weekStart + "T00:00:00Z").getUTCDay() === 1), "every week starts on a Monday");
ok(rep.weekly.reduce((a, w) => a + w.daysInWindow, 0) === 30, "weekly daysInWindow totals the window length");
ok(rep.completionRate.rate === null || (rep.completionRate.rate >= 0 && rep.completionRate.rate <= 1), "completion rate within [0,1]");
ok(rep.timing.cycle.count === rep.timing.cycleSamples.length, "cycle count equals cycle sample count");
ok(rep.timing.cycle.count === 0 || (rep.timing.cycle.p50 <= rep.timing.cycle.p85 && rep.timing.cycle.p85 <= rep.timing.cycle.max), "P50 ≤ P85 ≤ max");
ok(rep.onTime.eligible === rep.onTime.onTime + rep.onTime.late, "on-time eligible = on-time + late");
ok(rep.workload.active.count + rep.workload.queued.count === rep.population.open, "active + queued = open");
ok(rep.blocked.blocked <= rep.blocked.openTasks, "blocked ≤ open");

console.log("4. Determinism and replay");
const asOf = encodeURIComponent("2026-03-12T12:00:00.000Z");
const a1 = await ava.get(`/api/analytics/report?workspaceId=${ws}&days=7&asOf=${asOf}`);
const a2 = await mira.get(`/api/analytics/report?workspaceId=${ws}&days=7&asOf=${asOf}`);
ok(JSON.stringify(a1.data.report) === JSON.stringify(a2.data.report), "same as-of query returns identical reports for two members");
ok(a1.data.report.window.asOf === "2026-03-12T12:00:00.000Z", "replay instant is echoed exactly");

console.log("5. Filters");
const projects = (await ava.get(`/api/projects?workspaceId=${ws}`)).data.projects;
const total = (await ava.get(`/api/analytics/report?workspaceId=${ws}&days=30`)).data.report;
let partition = 0;
for (const p of projects) {
  const f = await ava.get(`/api/analytics/report?workspaceId=${ws}&days=30&projectId=${p.id}`);
  partition += f.data.report.throughput.completed;
}
ok(partition === total.throughput.completed, "Σ over projects of completions = unfiltered completions");
const high = await ava.get(`/api/analytics/report?workspaceId=${ws}&days=30&priority=urgent`);
ok(high.data.report.population.tasks < total.population.tasks, "a priority filter narrows the population");

console.log(`\nANALYTICS LIVE RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
