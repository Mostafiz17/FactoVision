import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  can,
  CAPABILITIES,
  MIN_ROLE,
  ROLE_RANK,
  roleAtLeast,
} from "../permissions";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["owner", "admin", "project_manager", "member"];

describe("role ladder", () => {
  it("is strictly ordered member < project_manager < admin < owner", () => {
    expect(ROLE_RANK.member).toBeLessThan(ROLE_RANK.project_manager);
    expect(ROLE_RANK.project_manager).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.owner);
  });
  it("roleAtLeast respects the ladder", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("project_manager", "admin")).toBe(false);
    expect(roleAtLeast("member", "member")).toBe(true);
  });
});

describe("capability matrix integrity", () => {
  it("every capability has a minimum role and every role exists in the ladder", () => {
    for (const cap of CAPABILITIES) {
      expect(MIN_ROLE[cap]).toBeDefined();
      expect(ALL_ROLES).toContain(MIN_ROLE[cap]);
    }
  });
  it("matrix covers all declared capabilities exactly", () => {
    expect(Object.keys(MIN_ROLE).sort()).toEqual([...CAPABILITIES].sort());
  });
  it("role changes are the single owner-exclusive capability", () => {
    const ownerOnly = CAPABILITIES.filter((cap) => MIN_ROLE[cap] === "owner");
    expect(ownerOnly).toEqual(["workspace.member.changeRole"]);
  });
  it("owner can do everything", () => {
    for (const cap of CAPABILITIES) expect(can("owner", cap)).toBe(true);
  });
  it("higher roles inherit every lower role capability (monotonicity)", () => {
    for (const cap of CAPABILITIES) {
      for (const role of ALL_ROLES) {
        if (can(role, cap)) {
          for (const higher of ALL_ROLES) {
            if (ROLE_RANK[higher] >= ROLE_RANK[role]) expect(can(higher, cap)).toBe(true);
          }
        }
      }
    }
  });
});

describe("explicit role permissions (documented model)", () => {
  it("member: participates in work, no governance", () => {
    expect(can("member", "task.create")).toBe(true);
    expect(can("member", "task.update")).toBe(true);
    expect(can("member", "task.delete")).toBe(true); // soft delete + undo
    expect(can("member", "task.bulk")).toBe(true);
    expect(can("member", "task.comment")).toBe(true);
    expect(can("member", "task.dependency")).toBe(true);
    expect(can("member", "analytics.read")).toBe(true);
    expect(can("member", "workspace.member.list")).toBe(true);
    expect(can("member", "view.manageOwn")).toBe(true);
    expect(can("member", "workspace.leave")).toBe(true);
    expect(can("member", "workspace.member.invite")).toBe(false);
    expect(can("member", "workspace.member.remove")).toBe(false);
    expect(can("member", "workspace.member.changeRole")).toBe(false);
    expect(can("member", "workspace.rename")).toBe(false);
    expect(can("member", "project.create")).toBe(false);
    expect(can("member", "project.delete")).toBe(false);
  });
  it("project_manager: governs projects, not people", () => {
    expect(can("project_manager", "project.create")).toBe(true);
    expect(can("project_manager", "project.edit")).toBe(true);
    expect(can("project_manager", "project.archive")).toBe(true);
    expect(can("project_manager", "project.delete")).toBe(false);
    expect(can("project_manager", "workspace.member.invite")).toBe(false);
    expect(can("project_manager", "workspace.member.remove")).toBe(false);
    expect(can("project_manager", "workspace.rename")).toBe(false);
    expect(can("project_manager", "task.create")).toBe(true); // inherits member
  });
  it("admin: governs people and destructive project ops, not roles", () => {
    expect(can("admin", "workspace.member.invite")).toBe(true);
    expect(can("admin", "workspace.member.remove")).toBe(true);
    expect(can("admin", "workspace.rename")).toBe(true);
    expect(can("admin", "project.delete")).toBe(true);
    expect(can("admin", "project.create")).toBe(true); // inherits PM
    expect(can("admin", "workspace.member.changeRole")).toBe(false); // owner-only
    expect(can("admin", "risk.configure")).toBe(true);
    expect(can("project_manager", "risk.configure")).toBe(false);
    expect(can("member", "risk.configure")).toBe(false);
  });
  it("owner: sole authority over role changes", () => {
    expect(can("owner", "workspace.member.changeRole")).toBe(true);
    expect(can("admin", "workspace.member.changeRole")).toBe(false);
  });
});

describe("assignable roles", () => {
  it("owner is not assignable through invites or role changes", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
    expect(ASSIGNABLE_ROLES).toEqual(["admin", "project_manager", "member"]);
  });
});