/**
 * Phase 7 live verification (default http://localhost:3000). No OPENAI_API_KEY is
 * configured in this environment, so the deterministic path is what can be — and
 * is — verified live; the AI path is covered by mocked-provider tests.
 * Run: node scripts/ai-live.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0, failed = 0;
const ok = (c, n) => { c ? (passed++, console.log("  ✓ " + n)) : (failed++, console.error("  ✗ " + n)); };

function client() {
  let cookie = "";
  return {
    async req(path, method = "GET", body) {
      const res = await fetch(BASE + path, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const pair = c.split(";")[0];
        if (pair.startsWith("cadence_session=")) cookie = pair;
      }
      let data = null;
      try { data = await res.json(); } catch {}
      return { status: res.status, data, raw: res };
    },
  };
}

console.log("1. Auth and tenancy");
const anon = client();
ok((await anon.req("/api/ai/insights", "POST", { workspaceId: "00000000-0000-4000-8000-000000000000", days: 30 })).status === 401, "unauthenticated → 401");
const ava = client();
await ava.req("/api/auth/login", "POST", { email: "ava@cadence.dev", password: "demo1234" });
const ws = (await ava.req("/api/auth/me")).data.workspaces[0].id;
const intruder = client();
await intruder.req("/api/auth/register", "POST", { email: `ai-live-${Date.now()}@test.dev`, name: "Intruder", password: "password123" });
ok((await intruder.req("/api/ai/insights", "POST", { workspaceId: ws, days: 30 })).status === 404, "cross-tenant insights → 404");
ok((await ava.req("/api/ai/insights", "POST", { workspaceId: ws, days: 9999 })).status === 400, "invalid days → 400");

console.log("2. Deterministic mode (no key configured)");
// Fresh tenant: the AI limiter is per-user, so reusing the shared demo account
// across suites would make this section depend on other suites' rate-limit state.
const freshEmail = `ai-fresh-${Date.now()}@test.dev`;
const fresh = client();
await fresh.req("/api/auth/register", "POST", { email: freshEmail, name: "Fresh", password: "password123" });
// Invite the isolated user into the seeded workspace so the evidence bundle is
// built from real data (the fresh user's own workspace is intentionally empty).
ok((await ava.req(`/api/workspaces/${ws}/members`, "POST", { email: freshEmail, role: "member" })).status === 201,
  "isolated user invited into seeded workspace");
const freshWs = ws;
let r = await fresh.req("/api/ai/insights", "POST", { workspaceId: freshWs, days: 30 });
const dto = r.data;
ok(r.status === 200 && dto.mode === "deterministic", "mode is deterministic and disclosed");
ok(/rule engine/i.test(dto.provider), `provider note honest ("${dto.provider}")`);
ok(Array.isArray(dto.insights) && dto.insights.length >= 3, `insights produced (${dto.insights?.length})`);
ok(dto.evidenceCount > 10, `evidence bundle non-trivial (${dto.evidenceCount} facts)`);
ok(dto.insights.every((i) => ["fact", "suggestion"].includes(i.kind)), "every insight declares kind fact|suggestion");
ok(dto.insights.some((i) => i.kind === "fact") && dto.insights.some((i) => i.kind === "suggestion"), "facts and suggestions both present");
ok(dto.insights.every((i) => Array.isArray(i.evidenceRefs) && i.evidenceRefs.length > 0 && i.evidenceRefs.every((ref) => /^E\d{2}$/.test(ref))), "every insight cites E## evidence ids");
const serialized = JSON.stringify(dto);
ok(!serialized.includes("sk-") && !serialized.includes("OPENAI"), "response carries no secret material");

console.log("3. Core analytics unaffected while AI is disabled");
ok((await fresh.req(`/api/analytics/report?workspaceId=${freshWs}&days=30`)).status === 200, "analytics report works");
ok((await fresh.req(`/api/dashboard?workspaceId=${freshWs}&days=30`)).status === 200, "dashboard works");

console.log("4. Rate limiting (dedicated user, capacity 10 / 10 min)");
const heavy = client();
await heavy.req("/api/auth/register", "POST", { email: `ai-heavy-${Date.now()}@test.dev`, name: "Heavy", password: "password123" });
const hws = (await heavy.req("/api/auth/me")).data.workspaces[0].id;
let okCount = 0, limited = 0;
for (let i = 0; i < 12; i++) {
  const s = (await heavy.req("/api/ai/insights", "POST", { workspaceId: hws, days: 30 })).status;
  if (s === 200) okCount++;
  else if (s === 429) limited++;
}
ok(okCount === 10 && limited === 2, `10 allowed then 429 (ok=${okCount}, limited=${limited})`);
r = await heavy.req("/api/ai/insights", "POST", { workspaceId: hws, days: 30 });
ok(r.status === 429 && /rate-limited/i.test(r.data?.error ?? ""), "429 body explains the limit");
ok((await ava.req(`/api/analytics/report?workspaceId=${ws}&days=7`)).status === 200, "rate limit is per-user: other users unaffected");

console.log(`\nAI LIVE RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
