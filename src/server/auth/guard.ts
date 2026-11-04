import { store } from "@/db/repository";
import type { DbMembership, DbUser } from "@/db/schema";
import type { Role } from "@/lib/domain/types";
import { ApiError } from "@/server/http";
import { can, ROLE_RANK, type Capability } from "./permissions";
import { getSessionUser } from "./session";

export async function requireUser(): Promise<DbUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Authentication required");
  return user;
}

/**
 * Tenant isolation gate: every workspace-scoped operation must pass through here.
 * Non-members get 404 (no existence disclosure).
 */
export async function requireMembership(
  userId: string,
  workspaceId: string,
  minRole: Role = "member",
): Promise<DbMembership> {
  const membership = await store.memberships.one({ workspaceId, userId });
  if (!membership) throw new ApiError(404, "Workspace not found");
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new ApiError(403, "Insufficient role for this action");
  }
  return membership;
}

/** Pure role check against the capability matrix — throws 403 with an explicit reason. */
export function ensureCan(role: Role, capability: Capability): void {
  if (!can(role, capability)) {
    throw new ApiError(403, `Role "${role}" is not allowed to perform "${capability}"`);
  }
}

/** Membership + capability in one server-side gate. */
export async function requireCapability(
  userId: string,
  workspaceId: string,
  capability: Capability,
): Promise<DbMembership> {
  const membership = await requireMembership(userId, workspaceId);
  ensureCan(membership.role, capability);
  return membership;
}
