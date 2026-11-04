import type { Role } from "@/lib/domain/types";

/**
 * Explicit role-based authorization model (Phase 2).
 *
 * Single source of truth for "who may do what". Pure module — importable from
 * server guards AND client components (for honest UI gating; the server
 * re-checks everything regardless).
 *
 * Role ladder: member < project_manager < admin < owner.
 * A capability is granted when ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE[capability]].
 */
export const ROLE_RANK: Record<Role, number> = {
  member: 0,
  project_manager: 1,
  admin: 2,
  owner: 3,
};

export const CAPABILITIES = [
  "workspace.rename",
  "workspace.leave",
  "workspace.member.list",
  "workspace.member.invite",
  "workspace.member.remove",
  "workspace.member.changeRole",
  "project.create",
  "project.edit",
  "project.archive",
  "project.delete",
  "task.create",
  "task.update",
  "task.delete",
  "task.bulk",
  "task.comment",
  "task.dependency",
  "view.manageOwn",
  "analytics.read",
  "risk.configure",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Minimum role required per capability. */
export const MIN_ROLE: Record<Capability, Role> = {
  "workspace.rename": "admin",
  "workspace.leave": "member", // owner is blocked separately (cannot orphan a workspace)
  "workspace.member.list": "member",
  "workspace.member.invite": "admin",
  "workspace.member.remove": "admin", // only strictly-lower ranks; owner protected
  "workspace.member.changeRole": "owner",
  "project.create": "project_manager",
  "project.edit": "project_manager",
  "project.archive": "project_manager",
  "project.delete": "admin",
  "task.create": "member",
  "task.update": "member",
  "task.delete": "member", // soft delete with undo — reversible, so member-level
  "task.bulk": "member",
  "task.comment": "member",
  "task.dependency": "member",
  "view.manageOwn": "member",
  "analytics.read": "member",
  "risk.configure": "admin", // changes every score in the workspace
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE[capability]];
}

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export const ASSIGNABLE_ROLES: Exclude<Role, "owner">[] = ["admin", "project_manager", "member"];