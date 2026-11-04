import { chromium, expect } from "@playwright/test";
const BASE = "http://localhost:3000";
const errors = [];
let passed = 0, failed = 0;
const ok = (c, name) => { c ? (passed++, console.log("  ✓ " + name)) : (failed++, console.error("  ✗ " + name)); };
const browser = await chromium.launch();

// Mira = project_manager: can create projects, cannot invite members
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("CONSOLE " + m.text().slice(0, 160)); });
await page.goto(BASE + "/login");
await page.getByRole("button", { name: /Mira Solis/ }).click();
await page.waitForURL("**/app");
await page.waitForTimeout(1200);
ok((await page.locator("aside p", { hasText: "Nova Product Lab" }).first().textContent())?.includes("PM"), "sidebar shows PM role label");
await page.goto(BASE + "/app/projects");
await page.waitForTimeout(800);
ok(await page.getByRole("button", { name: "New project" }).isVisible(), "PM sees New project");
await page.screenshot({ path: "/tmp/shots/p2-pm-projects.png" });
await page.goto(BASE + "/app/settings");
await page.waitForTimeout(800);
ok(!(await page.getByText("Invite a teammate").isVisible().catch(() => false)), "PM does NOT see invite section");
const miraRow = page.locator("tr", { hasText: "mira@cadence.dev" });
ok((await miraRow.textContent())?.includes("PM"), "PM badge rendered for Mira");
ok(!(await page.locator("select[aria-label='Role for Mira Solis']").isVisible().catch(() => false)), "PM cannot change roles (no select)");
await page.screenshot({ path: "/tmp/shots/p2-pm-settings.png" });

// Ava = owner: full governance UI
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p2 = await ctx2.newPage();
p2.on("pageerror", (e) => errors.push("PAGEERROR(ava) " + e.message));
await p2.goto(BASE + "/login");
await p2.getByRole("button", { name: /Ava Chen/ }).click();
await p2.waitForURL("**/app");
await p2.waitForTimeout(1000);
await p2.goto(BASE + "/app/settings");
await p2.waitForTimeout(800);
ok(await p2.getByText("Invite a teammate").isVisible(), "owner sees invite section");
ok(await p2.locator("select[aria-label='Role for Mira Solis']").isVisible(), "owner sees role select for PM member");
const opts = await p2.locator("select[aria-label='Role for Mira Solis']").locator("option").allTextContents();
ok(opts.join(",").includes("Project manager"), "role select offers Project manager");
ok((await p2.locator("tr", { hasText: "ava@cadence.dev" }).textContent())?.includes("Owner"), "owner badge rendered");
ok(!(await p2.locator("tr", { hasText: "ava@cadence.dev" }).getByRole("button", { name: /Remove/ }).isVisible().catch(() => false)), "owner row has no remove button");
await p2.screenshot({ path: "/tmp/shots/p2-owner-settings.png" });

console.log(`PHASE2 UI QA: ${passed} passed, ${failed} failed; runtime errors: ${errors.length === 0 ? "none" : errors.join(" | ")}`);
await browser.close();
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
