import { expect, test, type Page } from "@playwright/test";

async function account(page: Page) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `repair-${suffix}@test.dev`;
  const name = `Workspace ${suffix}`;
  expect((await page.request.post("/api/auth/register", { data: { email, name: "Repair tester", password: "test-password", workspaceName: name } })).status()).toBe(201);
  const me = await (await page.request.get("/api/auth/me")).json();
  const workspace = me.workspaces[0];
  const projectResponse = await page.request.post("/api/projects", { data: { workspaceId: workspace.id, name: "Repair project", color: "#123456" } });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()).project;
  return { workspace, project, email };
}

test("production hides demo access and rejects demo authentication", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Explore the demo")).toHaveCount(0);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect((await page.request.post("/api/auth/login", { data: { email: "ava@cadence.dev", password: "irrelevant" } })).status()).toBe(401);
});

test("all app routes render on desktop, tablet and mobile without runtime errors or page overflow", async ({ page }, testInfo) => {
  await account(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/app", "/app/board", "/app/projects", "/app/analytics", "/app/activity", "/app/settings"]) {
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.getByText("Something went sideways")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`${route.replaceAll("/", "-")}-${width}.png`), fullPage: true });
      const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, elements: [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.right > innerWidth + 1 && getComputedStyle(el).position !== "absolute"; }).slice(0, 12).map((el) => ({ tag: el.tagName, classes: el.className.toString(), right: el.getBoundingClientRect().right })) }));
      expect(overflow.scrollWidth <= overflow.width, `${route} at ${width}: ${JSON.stringify(overflow)}`).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("mobile navigation contains focus, closes with Escape and restores its trigger", async ({ page }) => {
  await account(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  const navigation = page.getByRole("dialog", { name: "Navigation" });
  await expect(navigation).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await navigation.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(navigation).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("account password change is authenticated and persists a privately chosen password", async ({ page }) => {
  expect((await page.request.post("/api/auth/password", { data: { currentPassword: "wrong", newPassword: "new-password" } })).status()).toBe(401);
  const { email } = await account(page);
  await page.goto("/app/settings");
  await page.getByLabel("Current password", { exact: true }).fill("test-password");
  await page.getByLabel("New password", { exact: true }).fill("private-changed-password");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Password updated" })).toBeVisible();
  expect((await page.request.post("/api/auth/login", { data: { email, password: "test-password" } })).status()).toBe(401);
  expect((await page.request.post("/api/auth/login", { data: { email, password: "private-changed-password" } })).status()).toBe(200);
});

test("workspace switching resets settings drafts and dashboard data", async ({ page }) => {
  const { workspace, project } = await account(page);
  await page.request.post("/api/tasks", { data: { workspaceId: workspace.id, projectId: project.id, title: "Workspace A task" } });
  const next = (await (await page.request.post("/api/workspaces", { data: { name: "Empty B " + Date.now() } })).json()).workspace;
  await page.goto("/app/settings");
  await page.getByLabel("Workspace name", { exact: true }).fill("Unsaved A draft");
  await page.getByRole("button", { name: workspace.name, exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(next.name) }).click();
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue(next.name);
  await page.goto("/app");
  await expect(page.getByTestId("kpi-open-value")).toHaveText("0");
  await page.getByRole("button", { name: next.name, exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(workspace.name) }).click();
  await expect(page.getByTestId("kpi-open-value")).toHaveText("1");
});

test("board searches beyond the first page and drawer saves do not erase another field draft", async ({ page }) => {
  const { workspace, project } = await account(page);
  for (let i = 0; i < 52; i++) {
    expect((await page.request.post("/api/tasks", { data: { workspaceId: workspace.id, projectId: project.id, title: i === 51 ? "Needle beyond first page" : "Other " + i } })).status()).toBe(201);
  }
  await page.goto("/app/board");
  await page.getByPlaceholder("Filter tasks…").fill("Needle beyond first page");
  const card = page.getByRole("button", { name: "Needle beyond first page", exact: true });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Space");
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await expect(drawer).toBeVisible();
  await page.getByLabel("Description", { exact: true }).fill("Keep this description draft");
  await page.getByLabel("Priority", { exact: true }).selectOption("high");
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Keep this description draft");
  await expect(page.getByLabel("Priority", { exact: true })).toHaveValue("high");
  await page.getByRole("textbox", { name: "Search blockers" }).fill("Other 50");
  await expect(page.getByRole("combobox", { name: "Blocker", exact: true }).locator("option", { hasText: "Other 50" })).toHaveCount(1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const result = await (await page.request.get(`/api/tasks?workspaceId=${workspace.id}&q=Needle`)).json();
  const detail = await (await page.request.get(`/api/tasks/${result.tasks[0].id}`)).json();
  expect(detail.task.description).toBe("Keep this description draft");
});

test("analytics exposes text alternatives and clear empty forecasts", async ({ page }) => {
  await account(page);
  await page.goto("/app/analytics");
  await expect(page.getByText("No forecast", { exact: true })).toHaveCount(0); // empty backlog clears in zero days
  await page.getByText("How this forecast is calculated", { exact: true }).click();
  await expect(page.getByText("No backlog to clear.", { exact: true })).toBeVisible();
  await expect(page.getByText("0 ÷ 0 = 0")).toHaveCount(0);
  await page.getByText("View chart data", { exact: true }).first().click();
  await expect(page.getByRole("table").first()).toBeVisible();
});

test("failed saved-view deletion restores the view and reports the failure", async ({ page }) => {
  const { workspace } = await account(page);
  await page.goto("/app/board");
  await page.getByRole("button", { name: /^Views/ }).click();
  await page.getByRole("textbox", { name: "Saved view name", exact: true }).fill("Keep this view");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  const view = page.getByRole("button", { name: "Keep this view", exact: true });
  await expect(view).toBeVisible();
  await page.route("**/api/views", async (route) => {
    if (route.request().method() === "DELETE") await route.fulfill({ status: 503, json: { error: "Synthetic failure" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Delete view Keep this view", exact: true }).click();
  await expect(page.getByText("Could not delete view", { exact: true })).toBeVisible();
  await expect(view).toBeVisible();
  const saved = await (await page.request.get(`/api/views?workspaceId=${workspace.id}`)).json();
  expect(saved.views.some((item: { name: string }) => item.name === "Keep this view")).toBe(true);
});
