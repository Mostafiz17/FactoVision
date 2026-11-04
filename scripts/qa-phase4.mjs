import { chromium, expect } from "@playwright/test";
const BASE = "http://localhost:3000";
const errors = [];
let passed = 0, failed = 0;
const ok = (c, n) => { c ? (passed++, console.log("  ✓ " + n)) : (failed++, console.error("  ✗ " + n)); };
const browser = await chromium.launch();
const watch = (p, tag) => {
  p.on("pageerror", (e) => errors.push(`${tag} PAGEERROR ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${tag} ${m.text().slice(0, 160)}`); });
};
async function login(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); watch(page, name);
  await page.goto(BASE + "/login");
  if (name === "Leo") {
    await page.getByPlaceholder("you@team.dev").fill("leo@cadence.dev");
    await page.getByPlaceholder("••••••••").fill("demo1234");
    await page.getByRole("button", { name: "Sign in" }).last().click();
  } else {
    await page.getByRole("button", { name: new RegExp(name) }).click();
  }
  await page.waitForURL("**/app");
  await page.waitForLoadState("networkidle");
  return page;
}

const ava = await login("Ava Chen");
await ava.goto(BASE + "/app/board");
await ava.waitForLoadState("networkidle");
await ava.getByRole("button", { name: "Fix payment retry double-charge", exact: true }).click();
await ava.getByRole("button", { name: /^Comments/ }).click();
const stamp = Date.now();
await ava.getByLabel("Mention a teammate").selectOption({ label: "Leo Fontaine" });
const box = ava.getByLabel("Comment");
ok((await box.inputValue()).includes("@Leo Fontaine"), "mention picker inserts @Name");
await box.fill(`${await box.inputValue()}please confirm the migration ${stamp}`);
await ava.getByRole("button", { name: /Send/ }).click();
await expect(ava.getByText(`please confirm the migration ${stamp}`)).toBeVisible({ timeout: 10000 });
ok(await ava.locator("span", { hasText: "@Leo Fontaine" }).last().isVisible(), "mention highlighted in posted comment");
await ava.getByRole("button", { name: "Reply" }).last().click();
ok(await ava.getByText(/Replying to Ava Chen/).isVisible(), "reply mode shows target");
await ava.getByLabel("Comment").fill(`self-follow-up ${stamp}`);
await ava.getByRole("button", { name: /Send/ }).click();
await expect(ava.getByText(`self-follow-up ${stamp}`)).toBeVisible({ timeout: 10000 });
ok(await ava.locator("div.ml-9", { hasText: `self-follow-up ${stamp}` }).isVisible(), "reply rendered nested under its thread");
await ava.screenshot({ path: "/tmp/p4-thread.png" });

const leo = await login("Leo");
const bell = leo.getByRole("button", { name: /Notifications \(\d+ unread\)/ });
const label = await bell.getAttribute("aria-label");
const unread = Number(/\((\d+) unread\)/.exec(label ?? "")?.[1] ?? "0");
ok(unread >= 1, `Leo's bell shows unread count (${unread})`);
await bell.click();
const item = leo.getByText(/mentioned you in “Fix payment retry double-charge”/).first();
await expect(item).toBeVisible();
ok(true, "mention notification visible to Leo");
ok(await leo.getByText(/overdue/i).first().isVisible().catch(() => false), "deadline (overdue) alert present for Leo's overdue task");
const toggle = leo.getByRole("button", { name: "Mark as read" }).first();
await toggle.click();
await expect(leo.getByRole("button", { name: new RegExp(`Notifications \\(${unread - 1} unread\\)`) })).toBeVisible({ timeout: 5000 });
ok(true, "mark-as-read decrements unread badge");
await leo.getByRole("button", { name: "Mark as unread" }).first().click();
await expect(leo.getByRole("button", { name: new RegExp(`Notifications \\(${unread} unread\\)`) })).toBeVisible({ timeout: 5000 });
ok(true, "mark-as-unread restores badge");
await leo.screenshot({ path: "/tmp/p4-notifications.png" });

await leo.keyboard.press("Escape");
await leo.goto(BASE + "/app/projects");
await leo.getByRole("link", { name: "Atlas Web App activity" }).click();
await leo.waitForURL("**/app/activity?project=*");
await expect(leo.getByRole("heading", { name: /Atlas Web App · activity/ })).toBeVisible();
ok(await leo.getByText(`please confirm the migration ${stamp}`).first().isVisible().catch(() => false) || await leo.getByText("Fix payment retry double-charge").first().isVisible(), "project activity feed scoped and populated");

console.log(`PHASE4 UI QA: ${passed} passed, ${failed} failed; runtime errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
