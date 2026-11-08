import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Phase 6: dashboard API contract, risk-model configuration, and UI ↔ API agreement.
 * Seeded data is time-relative, so assertions check consistency and exact UI/API
 * equality rather than hardcoded numbers (fixture-exact values live in Vitest).
 */
test.describe.configure({ mode: "serial" });
const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000");

interface Dash {
  summary: Record<string, number | null>;
  completionTrend: { label: string; created: number; completed: number }[];
  projectProgress: { projectId: string; open: number; total: number }[];
  risk: { modelVersion: string; revision: number; items: { score: number; interval: { low: number; high: number }; band: string }[] };
}

async function session(email: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: BASE });
  expect((await ctx.post("/api/auth/login", { data: { email, password: "demo1234" } })).status()).toBe(200);
  return ctx;
}
async function dash(ctx: APIRequestContext, ws: string, qs = ""): Promise<Dash> {
  const res = await ctx.get(`/api/dashboard?workspaceId=${ws}&days=30${qs}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).dashboard as Dash;
}

let ava: APIRequestContext;
let mira: APIRequestContext;
let ws: string;
let uiEmail: string;

test.beforeAll(async () => {
  ava = await session("ava@e2e.test");
  mira = await session("mira@e2e.test");
  ws = (await (await ava.get("/api/auth/me")).json()).workspaces[0].id;
  // UI tests use a dedicated admin invited into the seeded workspace. The AI
  // insights limiter is per user; sharing `ava` across suites made the truthful
  // mode badge assertion depend on unrelated suites consuming her budget.
  uiEmail = `dash-ui-${Date.now()}@test.dev`;
  const reg = await request.newContext({ baseURL: BASE });
  expect((await reg.post("/api/auth/register", { data: { email: uiEmail, name: "Dash UI", password: "password123" } })).status()).toBe(201);
  await reg.dispose();
  expect((await ava.post(`/api/workspaces/${ws}/members`, { data: { email: uiEmail, role: "admin" } })).status()).toBe(201);
});
test.afterAll(async () => {
  await ava?.dispose();
  await mira?.dispose();
});

test.describe("API: validation, scoping and consistency", () => {
  test("unauthenticated 401, other tenant 404, invalid filters 400, foreign project 404", async () => {
    const anon = await request.newContext({ baseURL: BASE });
    expect((await anon.get(`/api/dashboard?workspaceId=${ws}`)).status()).toBe(401);
    expect((await anon.get(`/api/risk/config?workspaceId=${ws}`)).status()).toBe(401);
    const intruder = await request.newContext({ baseURL: BASE });
    expect((await intruder.post("/api/auth/register", { data: { email: `dash-${Date.now()}@test.dev`, name: "X", password: "password123" } })).status()).toBe(201);
    expect((await intruder.get(`/api/dashboard?workspaceId=${ws}`)).status()).toBe(404);
    expect((await intruder.get(`/api/risk/config?workspaceId=${ws}`)).status()).toBe(404);
    const own = (await (await intruder.get("/api/auth/me")).json()).workspaces[0].id;
    const avaProject = (await (await ava.get(`/api/projects?workspaceId=${ws}`)).json()).projects[0].id;
    expect((await intruder.get(`/api/dashboard?workspaceId=${own}&projectId=${avaProject}`)).status()).toBe(404);
    for (const bad of ["&tz=Mars/Olympus", "&days=0", "&days=500", "&priority=critical", "&assigneeId=nope", `&label=${"x".repeat(40)}`]) {
      expect((await ava.get(`/api/dashboard?workspaceId=${ws}${bad}`)).status(), bad).toBe(400);
    }
    await anon.dispose();
    await intruder.dispose();
  });

  test("summary, trends, projects and risk are internally consistent", async () => {
    const d = await dash(ava, ws);
    expect(d.completionTrend.reduce((s, w) => s + w.completed, 0)).toBe(d.summary.completed);
    expect(d.projectProgress.reduce((s, p) => s + p.open, 0)).toBe(d.summary.openTasks);
    expect(d.risk.modelVersion).toBe("2.0.0");
    expect(d.risk.items.length).toBeGreaterThan(0);
    for (const r of d.risk.items) {
      expect(r.interval.low).toBeLessThanOrEqual(r.score);
      expect(r.interval.high).toBeGreaterThanOrEqual(r.score);
    }
  });

  test("a project filter narrows the result to that project", async () => {
    const all = await dash(ava, ws);
    const target = all.projectProgress.find((p) => p.open > 0)!;
    const one = await dash(ava, ws, `&projectId=${target.projectId}`);
    expect(one.projectProgress.map((p) => p.projectId)).toEqual([target.projectId]);
    expect(one.summary.openTasks).toBe(target.open);
    expect(one.summary.openTasks!).toBeLessThan(all.summary.openTasks!);
  });
});

test.describe("API: configurable, versioned risk model", () => {
  test("members read; only admins write; revisions are enforced; changes rescore", async () => {
    const current = (await (await mira.get(`/api/risk/config?workspaceId=${ws}`)).json()).riskConfig;
    expect(current.modelVersion).toBe("2.0.0");
    const heavier = { ...current.config, weights: { schedule: 0.2, blockedDuration: 0.1, dependencies: 0.1, workload: 0.6 } };

    expect((await mira.put("/api/risk/config", { data: { workspaceId: ws, expectedRevision: current.revision, config: heavier } })).status()).toBe(403);
    const invalid = { ...current.config, weights: { ...current.config.weights, schedule: 0.9 } };
    const bad = await ava.put("/api/risk/config", { data: { workspaceId: ws, expectedRevision: current.revision, config: invalid } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toContain("weights must sum to 1");
    expect((await ava.put("/api/risk/config", { data: { workspaceId: ws, expectedRevision: current.revision + 5, config: heavier } })).status()).toBe(409);

    const before = await dash(ava, ws);
    const saved = await ava.put("/api/risk/config", { data: { workspaceId: ws, expectedRevision: current.revision, config: heavier } });
    expect(saved.status()).toBe(200);
    const rev = (await saved.json()).riskConfig.revision;
    expect(rev).toBe(current.revision + 1);
    const after = await dash(ava, ws);
    expect(after.risk.revision).toBe(rev);
    expect(after.risk.items.map((i) => i.score)).not.toEqual(before.risk.items.map((i) => i.score));

    const reset = await ava.put("/api/risk/config", { data: { workspaceId: ws, expectedRevision: rev, config: current.config } });
    expect((await reset.json()).riskConfig.revision).toBe(rev + 1);
  });
});

async function loginFresh(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill('input[type="email"]', uiEmail);
  await page.fill('input[type="password"]', "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.waitForURL("**/app");
}

test.describe("UI: dashboard renders the API data", () => {
  test("KPI cards and the completion-trend data table equal the API response", async ({ page }) => {
    await loginFresh(page);
    const d = await dash(page.request, ws);
    await expect(page.getByRole("heading", { name: "Mission control" })).toBeVisible();
    await expect(page.getByTestId("kpi-completed-value")).toHaveText(String(d.summary.completed));
    await expect(page.getByTestId("kpi-open-value")).toHaveText(String(d.summary.openTasks));
    await expect(page.getByTestId("kpi-overdue-value")).toHaveText(String(d.summary.overdue));

    const chart = page.getByTestId("chart-completion");
    await expect(chart).toHaveAccessibleName("Completion trend");
    await chart.getByRole("button", { name: "View data" }).click();
    const rows = chart.locator("tbody tr");
    await expect(rows).toHaveCount(d.completionTrend.length);
    for (let i = 0; i < d.completionTrend.length; i++) {
      const cells = rows.nth(i).locator("th, td");
      await expect(cells.nth(0)).toHaveText(d.completionTrend[i].label);
      await expect(cells.nth(2)).toHaveText(String(d.completionTrend[i].created));
      await expect(cells.nth(3)).toHaveText(String(d.completionTrend[i].completed));
    }
    await expect(page.getByTestId("ai-panel")).toContainText("deterministic"); // truthful mode badge (no AI key configured)
    const firstRisk = page.getByTestId("risk-panel").getByRole("button").first();
    await expect(firstRisk).toHaveAttribute("aria-label", new RegExp(`risk ${d.risk.items[0].score} \\(${d.risk.items[0].band}\\), range`));
  });

  test("changing a filter refetches, updates the URL and matches the filtered API data", async ({ page }) => {
    await loginFresh(page);
    const all = await dash(page.request, ws);
    const target = all.projectProgress.find((p) => p.open > 0)!;
    await page.getByLabel("Project", { exact: true }).selectOption(target.projectId);
    await page.waitForURL(new RegExp(`projectId=${target.projectId}`));
    await expect(page.getByTestId("kpi-open-value")).toHaveText(String(target.open));
    await expect(page.getByTestId("project-progress").getByRole("progressbar")).toHaveCount(1);
    await page.reload();
    await expect(page.getByLabel("Project", { exact: true })).toHaveValue(target.projectId); // URL filters survive reload (server-validated)
  });

  test("empty and error states", async ({ page }) => {
    await loginFresh(page);
    const created = await page.request.post("/api/projects", { data: { workspaceId: ws, name: `Empty ${Date.now()}`, color: "#123456" } });
    const projectId = (await created.json()).project.id;
    try {
      await page.reload();
      await page.getByLabel("Project", { exact: true }).selectOption(projectId);
      await expect(page.getByTestId("chart-completion").getByText("No data for these filters")).toBeVisible();
      await expect(page.getByText("No open tasks to score")).toBeVisible();

      await page.route("**/api/dashboard?**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "simulated outage" }) }));
      await page.getByLabel("Window", { exact: true }).selectOption("14");
      await expect(page.getByRole("alert").filter({ hasText: "simulated outage" })).toBeVisible();
      await page.unroute("**/api/dashboard?**");
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "simulated outage" })).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/projects/${projectId}`);
    }
  });

  test("risk settings are read-only for a project manager", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("mira@e2e.test");
    await page.getByLabel("Password", { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await page.waitForURL("**/app");
    await page.goto("/app/settings");
    const card = page.getByTestId("risk-config");
    await expect(card).toContainText("Only admins and owners can edit");
    await expect(card.getByLabel("Workload weight")).toBeDisabled();
  });
});
