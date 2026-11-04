import { cookies } from "next/headers";
import { withTransaction } from "@/db";
import { store } from "@/db/repository";
import type { DbUser } from "@/db/schema";
import { DAY_MS } from "@/lib/domain/dates";
import { generateToken, hashToken } from "./tokens";

export { generateToken, hashToken } from "./tokens";

export const SESSION_COOKIE = "cadence_session";
const SESSION_TTL_MS = 7 * DAY_MS;

export async function createSession(userId: string): Promise<string> {
  const jar = await cookies();
  // Session rotation: invalidate the token this browser presented before a new
  // one is issued. Without this, a login would leave the pre-login session
  // valid (session fixation / stale-token reuse). Other devices are unaffected.
  const previous = jar.get(SESSION_COOKIE)?.value;
  const token = generateToken();
  await withTransaction(async () => {
    if (previous) await store.sessions.remove({ id: hashToken(previous) });
    await store.sessions.insert({ id: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  });
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await store.sessions.remove({ id: hashToken(token) });
  }
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Resolves the authenticated user from the session cookie, or null. */
export async function getSessionUser(): Promise<DbUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // TTL cleanup is asynchronous; expiration is always enforced on the read path.
  const row = await store.sessions.one({ id: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!row) return null;
  return store.users.one({ id: row.userId });
}
