import { expect, test } from "@playwright/test";

test.describe("FactoVision core loop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("ava@e2e.test");
    await page.getByLabel("Password", { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await page.waitForURL("**/app");
  });

  test("dashboard renders KPIs and charts from real data", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Mission control" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Summary metrics" })).toBeVisible();
    await expect(page.getByRole("figure", { name: "Completion trend" })).toBeVisible();
    await expect(page.getByRole("figure", { name: "Cycle-time trend" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Deadline risk" })).toBeVisible();
    await expect(page.getByText("Rule-based insights", { exact: false })).toBeVisible();
  });

  test("create → open → complete → risk cleared", async ({ page }) => {
    await page.goto("/app/board");
    await page.getByRole("button", { name: "New task" }).first().click();
    const title = `E2E probe ${Date.now()}`;
    await page.getByPlaceholder("Ship the thing").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await page.getByPlaceholder("Filter tasks…").fill(title);
    const card = page.getByRole("button", { name: title, exact: true });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.click();
    // Lifecycle rules: backlog → in_progress → done (direct backlog → done is illegal).
    await page.getByLabel("Status").selectOption("in_progress");
    await expect(page.getByLabel("Status")).toHaveValue("in_progress", { timeout: 15_000 });
    await expect(page.getByLabel("Status").locator("option", { hasText: "Done" })).toHaveCount(1, { timeout: 15_000 });
    await page.getByLabel("Status").selectOption("done");
    await page.getByRole("button", { name: /^Risk/ }).click();
    await expect(page.getByText("Completed — no active risk")).toBeVisible({ timeout: 15_000 });
  });

  test("analytics page exposes definitions and controls", async ({ page }) => {
    await page.goto("/app/analytics");
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page.getByLabel("EWMA α")).toBeVisible();
    await expect(page.getByText("Metric definitions — the contract")).toBeVisible();
  });

  test("unauthenticated API access is rejected", async ({ request }) => {
    const res = await request.get("/api/auth/me");
    expect(res.status()).toBe(401);
  });
});