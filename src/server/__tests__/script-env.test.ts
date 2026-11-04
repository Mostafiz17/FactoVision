import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Exercise the actual helper and Next loader in a fresh process so their global
// env cache cannot affect tests' isolated database settings. All files are fake.
function loadFixture(files: Record<string, string>, mode?: "development" | "production", inherited?: { uri: string; database: string }) {
  const directory = path.resolve("tmp/env-tests", randomUUID());
  mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(directory, name), content);
  const filename = path.resolve("scripts/env.ts");
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const program = `const Module = require('node:module');
    const m = new Module(${JSON.stringify(filename)}); m.filename = ${JSON.stringify(filename)};
    m.paths = Module._nodeModulePaths(process.cwd()); m._compile(${JSON.stringify(compiled)}, m.filename);
    const loaded = m.exports.loadScriptEnv(${JSON.stringify(directory)});
    console.log(JSON.stringify({ loaded, local: process.env.MONGODB_DB === 'local-db', production: process.env.MONGODB_DB === 'production-db', development: process.env.MONGODB_DB === 'development-db', inherited: process.env.MONGODB_DB === 'inherited-db', fallback: process.env.MONGODB_DB === 'fallback-db', uriLoaded: Boolean(process.env.MONGODB_URI) }));`;
  const env: Record<string, string | undefined> & { NODE_ENV: "development" | "production" | "test" } = { ...process.env, NODE_ENV: mode ?? "production" };
  delete env.MONGODB_URI; delete env.MONGODB_DB; delete env.__NEXT_PROCESSED_ENV;
  if (mode) env.NODE_ENV = mode; else Reflect.deleteProperty(env, "NODE_ENV");
  if (inherited) { env.MONGODB_URI = inherited.uri; env.MONGODB_DB = inherited.database; }
  const result = spawnSync(process.execPath, ["-e", program], { env, encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw new Error("Isolated environment-loader process failed; exit " + result.status);
  return JSON.parse(result.stdout.trim()) as { loaded: string[]; local: boolean; production: boolean; development: boolean; inherited: boolean; fallback: boolean; uriLoaded: boolean };
}
const local = "MONGODB_URI=mongodb://fake.invalid\nMONGODB_DB=local-db\n";
describe("CLI environment parity with Next.js", () => {
  it("loads .env.local even when .env does not exist", () => {
    expect(loadFixture({ ".env.local": local })).toMatchObject({ loaded: [".env.local"], local: true, uriLoaded: true });
  });
  it("matches next start production precedence by default", () => {
    expect(loadFixture({ ".env.local": local, ".env.production.local": "MONGODB_DB=production-db\n" })).toMatchObject({ production: true, uriLoaded: true });
  });
  it("respects process variables rather than overriding the configured database", () => {
    expect(loadFixture({ ".env.local": local }, "production", { uri: "mongodb://inherited.invalid", database: "inherited-db" })).toMatchObject({ inherited: true });
  });
  it("supports explicit development mode and .env fallback", () => {
    expect(loadFixture({ ".env.local": local, ".env.development.local": "MONGODB_DB=development-db\n" }, "development")).toMatchObject({ development: true });
    expect(loadFixture({ ".env": "MONGODB_URI=mongodb://fake.invalid\nMONGODB_DB=fallback-db\n" })).toMatchObject({ fallback: true, uriLoaded: true });
  });
});
