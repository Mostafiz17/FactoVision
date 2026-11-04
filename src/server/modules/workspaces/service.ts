import { randomBytes } from "node:crypto";
import { withTransaction } from "@/db";
import { memberUsers, store, workspaceTransaction } from "@/db/repository";
import type { MemberDTO, SavedViewDTO, ViewConfig, WorkspaceDTO } from "@/lib/domain/types";
import { ensureCan, requireMembership } from "@/server/auth/guard";
import { ROLE_RANK } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { isUniqueViolation } from "@/server/db-errors";
import { ApiError } from "@/server/http";
import { viewConfigSchema } from "@/server/validation";

export async function listWorkspaces(userId: string): Promise<WorkspaceDTO[]> {
  const memberships = await store.memberships.find({ userId });
  const rows = await store.workspaces.find({ id: { $in: memberships.map((m) => m.workspaceId) } }, { sort: { createdAt: 1 } });
  return rows.map((ws) => ({ id: ws.id, name: ws.name, slug: ws.slug, role: memberships.find((m) => m.workspaceId === ws.id)!.role }));
}
function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "workspace";
  return base + "-" + randomBytes(3).toString("hex");
}
/** Caller owns the transaction: registration creates user + workspace + owner atomically. */
export async function createWorkspaceForUser(userId: string, name: string): Promise<WorkspaceDTO> {
  const ws = await store.workspaces.insert({ name, slug: slugify(name), createdBy: userId });
  await store.memberships.insert({ workspaceId: ws.id, userId, role: "owner" });
  return { id: ws.id, name: ws.name, slug: ws.slug, role: "owner" };
}
export async function createWorkspace(userId: string, name: string): Promise<WorkspaceDTO> {
  return withTransaction(() => createWorkspaceForUser(userId, name));
}
export async function renameWorkspace(userId: string, workspaceId: string, name: string): Promise<void> {
  await workspaceTransaction(workspaceId, async () => {
    const membership = await requireMembership(userId, workspaceId);
    ensureCan(membership.role, "workspace.rename");
    await store.workspaces.update({ id: workspaceId }, { name });
  });
}
export async function listMembers(userId: string, workspaceId: string): Promise<MemberDTO[]> {
  const membership = await requireMembership(userId, workspaceId);
  ensureCan(membership.role, "workspace.member.list");
  return (await memberUsers(workspaceId)).map(({ u, role }) => ({ id: u.id, name: u.name, email: u.email, avatarHue: u.avatarHue, role }));
}
export async function inviteMember(
  actorId: string, workspaceId: string,
  input: { email: string; name?: string; role: "admin" | "project_manager" | "member" },
): Promise<{ member: MemberDTO; tempPassword: string | null }> {
  const tempPassword = randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);
  try {
    return await workspaceTransaction(workspaceId, async () => {
      const actor = await requireMembership(actorId, workspaceId);
      ensureCan(actor.role, "workspace.member.invite");
      const found = await store.users.one({ email: input.email });
      const user = found ?? await store.users.insert({ email: input.email, name: input.name ?? input.email.split("@")[0], passwordHash, avatarHue: Math.floor(Math.random() * 360) });
      if (await store.memberships.one({ workspaceId, userId: user.id })) throw new ApiError(409, "This person is already a member");
      await store.memberships.insert({ workspaceId, userId: user.id, role: input.role });
      return { member: { id: user.id, name: user.name, email: user.email, avatarHue: user.avatarHue, role: input.role }, tempPassword: found ? null : tempPassword };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, "This person is already a member");
    throw e;
  }
}
export async function changeMemberRole(actorId: string, workspaceId: string, targetUserId: string, role: "admin" | "project_manager" | "member"): Promise<void> {
  await workspaceTransaction(workspaceId, async () => {
    const actor = await requireMembership(actorId, workspaceId);
    ensureCan(actor.role, "workspace.member.changeRole");
    const target = await requireMembership(targetUserId, workspaceId);
    if (target.role === "owner") throw new ApiError(400, "The owner's role cannot be changed");
    await store.memberships.update({ workspaceId, userId: targetUserId }, { role });
  });
}
export async function removeMember(actorId: string, workspaceId: string, targetUserId: string): Promise<void> {
  await workspaceTransaction(workspaceId, async () => {
    const actor = await requireMembership(actorId, workspaceId);
    const target = await requireMembership(targetUserId, workspaceId);
    if (targetUserId === actorId) {
      ensureCan(actor.role, "workspace.leave");
      if (target.role === "owner") throw new ApiError(400, "The owner cannot leave the workspace");
    } else {
      ensureCan(actor.role, "workspace.member.remove");
      if (target.role === "owner") throw new ApiError(400, "The owner cannot be removed");
      if (ROLE_RANK[target.role] >= ROLE_RANK[actor.role]) throw new ApiError(403, "Cannot remove a member with an equal or higher role");
    }
    await store.memberships.remove({ workspaceId, userId: targetUserId });
  });
}
export async function listViews(userId: string, workspaceId: string): Promise<SavedViewDTO[]> {
  const membership = await requireMembership(userId, workspaceId);
  ensureCan(membership.role, "view.manageOwn");
  const rows = await store.savedViews.find({ workspaceId, userId }, { sort: { createdAt: 1 } });
  return rows.flatMap((r) => {
    const parsed = viewConfigSchema.safeParse(r.config);
    return parsed.success ? [{ id: r.id, name: r.name, config: parsed.data as ViewConfig }] : [];
  });
}
export async function createView(userId: string, workspaceId: string, name: string, config: ViewConfig): Promise<SavedViewDTO> {
  return workspaceTransaction(workspaceId, async () => {
    const membership = await requireMembership(userId, workspaceId);
    ensureCan(membership.role, "view.manageOwn");
    const row = await store.savedViews.insert({ workspaceId, userId, name, config });
    return { id: row.id, name, config };
  });
}
export async function deleteView(userId: string, workspaceId: string, viewId: string): Promise<void> {
  await workspaceTransaction(workspaceId, async () => {
    const membership = await requireMembership(userId, workspaceId);
    ensureCan(membership.role, "view.manageOwn");
    await store.savedViews.remove({ id: viewId, workspaceId, userId });
  });
}
