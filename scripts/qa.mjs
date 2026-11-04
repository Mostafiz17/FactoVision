import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0, 200)); });

await page.goto(BASE + "/login");
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/shots/01-login.png" });
await page.getByRole("button", { name: /Ava Chen/ }).click();
await page.waitForURL("**/app");
await page.waitForTimeout(2200);
await page.screenshot({ path: "/tmp/shots/02-dashboard.png", fullPage: true });

await page.goto(BASE + "/app/board");
await page.waitForTimeout(1400);
await page.screenshot({ path: "/tmp/shots/03-board.png" });

// open risk drawer on the top-risk task
await page.getByText("Fix payment retry double-charge").first().click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /^Risk/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/shots/04-drawer-risk.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

await page.goto(BASE + "/app/analytics");
await page.waitForTimeout(1800);
await page.screenshot({ path: "/tmp/shots/05-analytics.png", fullPage: true });

await page.goto(BASE + "/app/projects");
await page.waitForTimeout(1000);
await page.screenshot({ path: "/tmp/shots/06-projects.png" });

await page.goto(BASE + "/app/activity");
await page.waitForTimeout(1000);
await page.screenshot({ path: "/tmp/shots/07-activity.png" });

await page.goto(BASE + "/app/settings");
await page.waitForTimeout(1000);
await page.screenshot({ path: "/tmp/shots/08-settings.png" });

// mobile
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mctx.newPage();
mp.on("pageerror", (e) => errors.push("MOBILE PAGEERROR " + e.message));
await mp.goto(BASE + "/login");
await mp.getByRole("button", { name: /Ava Chen/ }).click();
await mp.waitForURL("**/app");
await mp.waitForTimeout(2000);
await mp.screenshot({ path: "/tmp/shots/09-mobile-dashboard.png" });
await mp.goto(BASE + "/app/board");
await mp.waitForTimeout(1200);
await mp.screenshot({ path: "/tmp/shots/10-mobile-board.png" });

console.log("ERRORS:", errors.length === 0 ? "none" : errors.join("\n"));
await browser.close();
