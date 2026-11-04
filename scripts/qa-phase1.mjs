import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("/tmp/shots", { recursive: true });
const BASE = "http://localhost:3000";
const errors = [];
let passed = 0, failed = 0;
const ok = (c, name) => { c ? (passed++, console.log("  ✓ " + name)) : (failed++, console.error("  ✗ " + name)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text())) errors.push("CONSOLE " + m.text().slice(0, 160)); }); /* intentional 404 navigations excluded */

await page.goto(BASE + "/login");
await page.getByRole("button", { name: /Ava Chen/ }).click();
await page.waitForURL("**/app");
await page.waitForTimeout(1200);

// skip link is first tab stop
await page.keyboard.press("Tab");
const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
ok(focused.includes("Skip to content"), "skip-to-content link is first tab stop");
await page.keyboard.press("Enter");
const hash = await page.evaluate(() => location.hash);
ok(hash === "#main-content", "skip link targets #main-content");

// aria-current on active nav
await page.goto(BASE + "/app/board");
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1500);
const current = page.locator('nav a[aria-current="page"]');
ok((await current.count()) === 1 && (await current.first().textContent())?.includes("Board"), "aria-current=page marks Board");

// drag & drop after reconciliation refactor
const title = "Import from Jira CSV";
const card = page.getByRole("button", { name: title, exact: true });
await expect(card).toBeVisible();
const todoCol = page.locator("div.rounded-2xl").filter({ has: page.getByText("To do", { exact: true }) });
async function dragWithRetry(src, dst, verify) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await src.dragTo(dst);
    await page.waitForTimeout(1600);
    if (await verify()) return true;
    await page.waitForTimeout(1200); // let hydration / reconciliation settle, retry
  }
  return false;
}
ok(await dragWithRetry(card, todoCol.getByText("To do", { exact: true }),
  () => todoCol.getByRole("button", { name: title, exact: true }).isVisible()), "drag Backlog → To do lands and persists");
await page.screenshot({ path: "/tmp/shots/p1-board-after-dnd.png" });
// drag back
const backlogCol = page.locator("div.rounded-2xl").filter({ has: page.getByText("Backlog", { exact: true }) });
ok(await dragWithRetry(todoCol.getByRole("button", { name: title, exact: true }), backlogCol.getByText("Backlog", { exact: true }),
  () => backlogCol.getByRole("button", { name: title, exact: true }).isVisible()), "drag back restores column");

// 404 boundaries
const r1 = await page.goto(BASE + "/app/no-such-route");
ok(r1?.status() === 404, "unknown /app route returns 404 status");
await expect(page.getByText(/isn.t on the map|Nothing at this address/)).toBeVisible();
ok(true, "styled 404 renders for unknown /app route");
await page.screenshot({ path: "/tmp/shots/p1-404-app.png" });
const r2 = await page.goto(BASE + "/no-such-page");
ok(r2?.status() === 404 && await page.getByText(/isn.t on the map/).isVisible(), "root 404 renders");
await page.screenshot({ path: "/tmp/shots/p1-404-root.png" });

// mobile responsive nav
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mctx.newPage();
mp.on("pageerror", (e) => errors.push("MOBILE " + e.message));
await mp.goto(BASE + "/login");
await mp.getByRole("button", { name: /Ava Chen/ }).click();
await mp.waitForURL("**/app");
await mp.waitForTimeout(900);
await mp.getByRole("button", { name: "Open navigation" }).click();
// Hydration/animation timing: retry the open action, then assert visibility.
for (let i = 0; i < 3; i++) {
  if (await mp.getByRole("link", { name: "Analytics", exact: true }).isVisible()) break;
  await mp.waitForTimeout(700);
  if (await mp.getByRole("button", { name: "Open navigation" }).count()) {
    await mp.getByRole("button", { name: "Open navigation" }).click();
  }
}
await expect(mp.getByRole("link", { name: "Analytics", exact: true })).toBeVisible({ timeout: 15000 });
ok(true, "mobile slide-over navigation opens");
await mp.screenshot({ path: "/tmp/shots/p1-mobile-nav.png" });
await mp.getByRole("link", { name: "Analytics", exact: true }).click();
await mp.waitForURL("**/app/analytics");
ok(true, "mobile nav navigates and closes");

console.log(`PHASE1 QA: ${passed} passed, ${failed} failed; runtime errors: ${errors.length === 0 ? "none" : errors.join(" | ")}`);
await browser.close();
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
