import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "@/server/db-errors";
import { ApiError, assertOrigin } from "@/server/http";
import { parseEnv } from "@/server/env";

// Vitest transforms test modules; __dirname is not reliably the file's folder.
// Anchor to the project root explicitly and never traverse symlinked trees.
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const API = path.join(SRC, "app/api");

/** Public endpoints: auth entrypoints and the health probe. */
const PUBLIC = new Set([
  "auth/register/route.ts",
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "health/route.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory() && !lstatSync(full).isSymbolicLink() && !entry.startsWith(".")) walk(full, out);
    else if (statSync(full).isFile()) out.push(full);
  }
  return out;
}

const routes = walk(API).filter((f) => f.endsWith("route.ts"));
const sources = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"));

describe("repository-wide route audit", () => {
  it("uses only the MongoDB persistence dependency", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.dependencies.mongodb).toBeDefined();
    for (const name of ["pg", "@types/pg", "drizzle-orm", "drizzle-kit"]) {
      expect(pkg.dependencies[name] ?? pkg.devDependencies[name]).toBeUndefined();
    }
    for (const file of sources) {
      expect(readFileSync(file, "utf8")).not.toMatch(/from ["'](?:drizzle-orm(?:\/[^"']*)?|pg)["']/);
    }
  });
  it("discovers the full route surface", () => {
    expect(routes.length).toBeGreaterThanOrEqual(22);
  });

  for (const file of routes) {
    const rel = path.relative(API, file).replaceAll("\\", "/");
    if (!PUBLIC.has(rel)) {
      it(`${rel}: enforces authentication before doing work`, () => {
        const source = readFileSync(file, "utf8");
        expect(source).toMatch(/requireUser|requireMembership|requireCapability|getSessionUser/);
      });
    }
  }

  it("every mutating route performs the Origin check", () => {
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      if (/export async function (POST|PATCH|PUT|DELETE)/.test(source)) {
        expect(source, `${path.relative(SRC, file)} must call assertOrigin`).toMatch(/assertOrigin/);
      }
    }
  });

  it("no route handler reads process.env directly (secrets are centralized)", () => {
    for (const file of routes) {
      expect(readFileSync(file, "utf8"), path.relative(SRC, file)).not.toMatch(/process\.env/);
    }
  });

  it("no route handler imports the database directly (services own persistence)", () => {
    for (const file of routes) {
      const rel = path.relative(API, file).replaceAll("\\", "/");
      if (rel === "health/route.ts") continue; // health probe legitimately executes SELECT 1
      expect(readFileSync(file, "utf8"), rel).not.toMatch(/from ["']@\/db/);
    }
  });

  it("no production source contains TypeScript `any` or a credential-looking literal", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      // Only real type annotations — not prose like "any member" in comments.
      expect(text, `${path.relative(SRC, file)} has \`any\``).not.toMatch(/:\s*any\b(?!\s+[A-Za-z])|\bas\s+any\b/);
      expect(text, `${path.relative(SRC, file)} has a key literal`).not.toMatch(/sk-[A-Za-z0-9]{12,}/);
    }
  });
});

describe("CSRF origin check fails closed", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/tasks", { method: "POST", headers });

  it("accepts a matching Origin/Host pair", () => {
    expect(() => assertOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).not.toThrow();
  });
  const statusOf = (fn: () => void): number => {
    try {
      fn();
      return 0;
    } catch (e) {
      return e instanceof ApiError ? e.status : -1;
    }
  };
  it("rejects a cross-origin mutation with 403", () => {
    expect(statusOf(() => assertOrigin(req({ origin: "https://evil.example", host: "localhost:3000" })))).toBe(403);
  });
  it("rejects an Origin with no Host rather than skipping the check", () => {
    expect(statusOf(() => assertOrigin(req({ origin: "http://localhost:3000" })))).toBe(403);
  });
  it("rejects a malformed Origin", () => {
    expect(() => assertOrigin(req({ origin: "not-a-url", host: "localhost:3000" }))).toThrow(ApiError);
  });
});

describe("database error mapping", () => {
  it("recognises MongoDB duplicate-key errors on the error and on a wrapped cause", () => {
    expect(isUniqueViolation({ code: 11000 })).toBe(true);
    expect(isUniqueViolation({ cause: { code: 11000 } })).toBe(true);
    expect(isUniqueViolation({ cause: { cause: { code: 11000 } } })).toBe(true);
  });
  it("does not treat unrelated errors as conflicts", () => {
    expect(isUniqueViolation(new Error("x"))).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation({ cause: { cause: {} } })).toBe(false);
  });
  it("does not loop forever on a cyclic cause chain", () => {
    const a: { code?: string; cause?: unknown } = {};
    a.cause = a;
    expect(isUniqueViolation(a)).toBe(false);
  });
});

describe("environment validation of optional AI settings", () => {
  const base = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_DB: "cadence_test", NODE_ENV: "production" as const };
  it("accepts valid model and timeout", () => {
    const env = parseEnv({ ...base, OPENAI_API_KEY: "sk-example", AI_MODEL: "gpt-4o-mini", AI_TIMEOUT_MS: "12000" });
    expect(env.AI_MODEL).toBe("gpt-4o-mini");
    expect(env.AI_TIMEOUT_MS).toBe(12000);
  });
  it("rejects out-of-range timeout and oversized model ids", () => {
    expect(() => parseEnv({ ...base, AI_TIMEOUT_MS: "10" })).toThrow(/AI_TIMEOUT_MS/);
    expect(() => parseEnv({ ...base, AI_TIMEOUT_MS: "999999" })).toThrow(/AI_TIMEOUT_MS/);
    expect(() => parseEnv({ ...base, AI_MODEL: "x".repeat(65) })).toThrow(/AI_MODEL/);
  });
  it("AI credentials are optional and empty keys are rejected", () => {
    expect(parseEnv(base).OPENAI_API_KEY).toBeUndefined();
    expect(() => parseEnv({ ...base, OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/);
  });
});
