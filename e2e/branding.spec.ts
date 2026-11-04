import { expect, test } from "@playwright/test";
import { BRAND } from "../src/lib/brand";

// No login, data mutations, seeded accounts, or database connection are needed.
test("desktop login exposes the product identity, metadata and working icon", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await expect(page).toHaveTitle(BRAND.title);
  await expect(page.getByText(BRAND.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(BRAND.attribution, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: BRAND.tagline })).toBeVisible();
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", BRAND.name);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", BRAND.name);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", BRAND.description);
  const iconHref = await page.locator('link[rel="icon"][href^="/icon.svg"]').getAttribute("href");
  expect(iconHref).toBeTruthy();
  const icon = await request.get(iconHref!);
  expect(icon.ok()).toBe(true);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  expect(await icon.text()).toContain(BRAND.title);
  await expect(page.locator("body")).not.toContainText("Cadence");
  await page.screenshot({ path: testInfo.outputPath("factovision-desktop.png"), fullPage: true });
});

test("mobile login and registration retain branding without horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await expect(page.getByText(BRAND.name, { exact: true }).last()).toBeVisible();
  await expect(page.getByText(BRAND.attribution, { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByPlaceholder("Ada Lovelace")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create workspace", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("factovision-mobile.png"), fullPage: true });
});
