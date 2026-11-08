/** Build first. All database writes occur in a fresh disposable local replica set. */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const directory = path.resolve("tmp", "regression-" + randomUUID());
await mkdir(directory, { recursive: true });
const replica = await MongoMemoryReplSet.create({ binary: { version: "8.2.6", systemBinary: path.resolve("tmp/mongodb-binaries/mongod.exe") }, replSet: { count: 1, storageEngine: "wiredTiger" } });
const probe = createServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const baseURL = "http://127.0.0.1:" + port;
const env = { ...process.env, MONGODB_URI: replica.getUri(), MONGODB_DB: "regression_" + randomUUID().replaceAll("-", ""), NODE_ENV: "test", __NEXT_PROCESSED_ENV: "true", E2E_BASE_URL: baseURL, ENABLE_DEMO: "false" };
delete env.OPENAI_API_KEY;
const children = new Set();
function launch(args, extra = {}) {
  const child = spawn(process.execPath, args, { env: { ...env, ...extra }, stdio: "inherit", windowsHide: true });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function run(args) {
  const child = launch(args);
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Regression command exited " + code))); });
}
try {
  await build({ entryPoints: ["scripts/db-setup.ts"], outfile: path.join(directory, "setup.cjs"), bundle: true, packages: "external", platform: "node", format: "cjs" });
  // Preserve the demo fixture but use ordinary test identities in production-mode checks.
  const seed = (await readFile("scripts/seed.ts", "utf8")).replaceAll("@cadence.dev", "@e2e.test").replace(/^.*console\.log\("Demo login:.*$/m, "");
  await build({ stdin: { contents: seed, resolveDir: path.resolve("scripts"), loader: "ts" }, outfile: path.join(directory, "seed.cjs"), bundle: true, packages: "external", platform: "node", format: "cjs" });
  await run([path.join(directory, "setup.cjs")]);
  await run([path.join(directory, "seed.cjs")]);
  const config = { testDir: path.resolve("e2e"), outputDir: path.join(directory, "results"), workers: 1, timeout: 45000, use: { baseURL, trace: "retain-on-failure" }, reporter: "list" };
  await writeFile(path.join(directory, "playwright.config.mjs"), "export default " + JSON.stringify(config) + ";");
  const server = launch(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { NODE_ENV: "production" });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    if (server.exitCode !== null) throw new Error("Isolated server exited before readiness");
    try { ready = (await fetch(baseURL + "/api/health")).ok; } catch { /* startup */ }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Isolated server did not become healthy");
  console.log("Running browser regressions against an isolated synthetic database.");
  await run(["node_modules/@playwright/test/cli.js", "test", "--config", path.join(directory, "playwright.config.mjs"), ...process.argv.slice(2)]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Regression failed");
  process.exitCode = 1;
} finally {
  await Promise.all([...children].map((child) => new Promise((resolve) => { child.once("exit", resolve); child.kill(); })));
  await replica.stop();
}
