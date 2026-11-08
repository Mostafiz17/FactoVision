import { withTransaction } from "@/db";
import { store } from "@/db/repository";
import { ApiError } from "@/server/http";
import { enforceAuthLimit } from "./limits";
import { hashPassword, verifyPassword } from "./password";
import { createSession } from "./session";

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  await enforceAuthLimit("password:" + userId, 5);
  const user = await store.users.one({ id: userId });
  if (!user || !await verifyPassword(currentPassword, user.passwordHash)) throw new ApiError(401, "Current password is incorrect");
  if (currentPassword === newPassword) throw new ApiError(400, "Choose a different password");
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async () => {
    const saved = await store.users.update({ id: userId, passwordHash: user.passwordHash }, { passwordHash });
    if (!saved) throw new ApiError(409, "Password changed concurrently. Sign in again before retrying.");
    await store.sessions.remove({ userId });
  });
  await createSession(userId);
}
