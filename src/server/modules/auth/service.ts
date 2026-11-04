import { withTransaction } from "@/db";
import { store } from "@/db/repository";
import type { DbUser } from "@/db/schema";
import { ApiError } from "@/server/http";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession } from "@/server/auth/session";
import { createWorkspaceForUser } from "@/server/modules/workspaces/service";
import { isUniqueViolation } from "@/server/db-errors";
import type { z } from "zod";
import type { loginSchema, registerSchema } from "@/server/validation";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarHue: number;
}

export function publicUser(u: DbUser): PublicUser {
  return { id: u.id, email: u.email, name: u.name, avatarHue: u.avatarHue };
}

/*
 * Per-IP failed-attempt throttle (ADR-009: single-instance scope).
 * Only FAILURES count — throttling successful logins would lock out legitimate
 * heavy users (observed in QA). Brute force is still capped at MAX_ATTEMPTS
 * failures per window; a successful authentication clears the counter.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 12;
const WINDOW_MS = 10 * 60 * 1000;

export function assertNotThrottled(ip: string): void {
  const entry = attempts.get(ip);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_ATTEMPTS) {
    throw new ApiError(429, "Too many failed attempts — try again in a few minutes");
  }
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearThrottle(ip: string): void {
  attempts.delete(ip);
}

function hueFor(email: string): number {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export async function register(input: z.infer<typeof registerSchema>): Promise<PublicUser> {
  // User + default workspace + owner membership are one transaction: a failed
  // workspace insert can no longer leave an orphan account. The unique index on
  // users.email (not a pre-read) resolves concurrent duplicate signups, and the
  // duplicate-key violation is mapped to 409 instead of an unhandled 500.
  const passwordHash = await hashPassword(input.password);
  let user: DbUser;
  try {
    user = await withTransaction(async () => {
      const created = await store.users.insert({ email: input.email, name: input.name, passwordHash, avatarHue: hueFor(input.email) });
      await createWorkspaceForUser(created.id, input.workspaceName ?? `${input.name.split(" ")[0]}'s workspace`);
      return created;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, "An account with this email already exists");
    throw e;
  }
  await createSession(user.id);
  return publicUser(user);
}

export async function login(input: z.infer<typeof loginSchema>, ip: string): Promise<PublicUser> {
  assertNotThrottled(ip);
  const user = await store.users.one({ email: input.email });
  const valid = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || !valid) {
    recordFailure(ip);
    throw new ApiError(401, "Invalid email or password");
  }
  clearThrottle(ip);
  await createSession(user.id); // fresh token each login (rotation)
  return publicUser(user);
}

export async function logout(): Promise<void> {
  await destroySession();
}
