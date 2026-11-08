import { withTransaction } from "@/db";
import { store } from "@/db/repository";
import type { DbUser } from "@/db/schema";
import { ApiError } from "@/server/http";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { demoEnabled, isDemoAccount } from "@/server/auth/demo";
import { enforceAuthLimit } from "@/server/auth/limits";
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

function hueFor(email: string): number {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export async function register(input: z.infer<typeof registerSchema>, client = "internal"): Promise<PublicUser> {
  if (isDemoAccount(input.email) && !demoEnabled()) throw new ApiError(400, "This email is reserved for the demonstration environment");
  if (client !== "internal") await enforceAuthLimit("register:client:" + client, 100);
  await enforceAuthLimit("register:email:" + input.email, 5);
  // User + default workspace + owner membership are one transaction: a failed
  // workspace insert can no longer leave an orphan account. The unique index on
  // users.email (not a pre-read) resolves concurrent duplicate signups, and the
  // duplicate-key violation is mapped to 409 instead of an unhandled 500.
  const passwordHash = await hashPassword(input.password);
  let user: DbUser;
  try {
    user = await withTransaction(async () => {
      const created = await store.users.insert({ email: input.email, name: input.name, passwordHash, avatarHue: hueFor(input.email) });
      const invitations = await store.invitations.find({ email: input.email, expiresAt: { $gt: new Date() } });
      for (const invitation of invitations) {
        // The recipient chooses the password; no administrator receives a credential.
        if (await store.workspaces.one({ id: invitation.workspaceId })) {
          await store.memberships.insert({ workspaceId: invitation.workspaceId, userId: created.id, role: invitation.role });
        }
        await store.invitations.remove({ id: invitation.id });
      }
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
  if (ip !== "internal") await enforceAuthLimit("login:client:" + ip, 100);
  await enforceAuthLimit("login:account:" + input.email, 30);
  if (isDemoAccount(input.email) && !demoEnabled()) throw new ApiError(401, "Invalid email or password");
  const user = await store.users.one({ email: input.email });
  const valid = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || !valid) {
    throw new ApiError(401, "Invalid email or password");
  }
  await createSession(user.id); // fresh token each login (rotation)
  return publicUser(user);
}

export async function logout(): Promise<void> {
  await destroySession();
}
