import { z } from "zod";

/**
 * Environment contract (Phase 1). Validated once, lazily, on first server access
 * so that tooling (typegen/tests) can import modules without a live environment.
 * Secrets never leave the server: MONGODB_URI / MONGODB_DB / OPENAI_API_KEY are read,
 * and neither is NEXT_PUBLIC_.
 */
const envSchema = z.object({
  MONGODB_URI: z
    .string({ error: "MONGODB_URI is required" })
    .min(1, "MONGODB_URI is required")
    .refine(
      (v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"),
      "MONGODB_URI must be a MongoDB connection string (mongodb:// or mongodb+srv://)",
    ),
  MONGODB_DB: z.string({ error: "MONGODB_DB is required" }).trim().min(1).max(63).regex(/^[A-Za-z0-9_-]+$/, "MONGODB_DB must be an explicit database name"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** OpenAI-compatible model id (server-side only). */
  AI_MODEL: z.string().trim().min(1).max(64).optional(),
  /** Provider timeout in milliseconds. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

/** Pure parser — unit-tested without touching process.env. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${detail}`);
  }
  return result.data;
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
