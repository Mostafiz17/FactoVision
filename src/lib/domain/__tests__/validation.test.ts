import { describe, expect, it } from "vitest";
import {
  analyticsQuerySchema,
  loginSchema,
  memberInviteSchema,
  memberPatchSchema,
  registerSchema,
  taskBulkSchema,
  taskCreateSchema,
  taskPatchSchema,
  viewConfigSchema,
} from "@/server/validation";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("auth schemas", () => {
  it("rejects malformed email and short passwords", () => {
    expect(registerSchema.safeParse({ email: "nope", name: "A", password: "longenough1" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.co", name: "A", password: "short" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "A@B.CO ", password: "x" }).success).toBe(true);
  });
  it("normalizes email case/whitespace", () => {
    const r = registerSchema.parse({ email: "  Ava@Cadence.dev ", name: "Ava", password: "demo12345" });
    expect(r.email).toBe("ava@cadence.dev");
  });
});

describe("task schemas", () => {
  it("rejects unknown status and priority values", () => {
    expect(
      taskCreateSchema.safeParse({ workspaceId: uuid, projectId: uuid, title: "x", status: "shipped" }).success,
    ).toBe(false);
    expect(taskPatchSchema.safeParse({ expectedVersion: 0, priority: "critical" }).success).toBe(false);
  });
  it("accepts date-only and offset ISO due dates, and explicit null", () => {
    expect(taskPatchSchema.safeParse({ expectedVersion: 0, dueDate: "2026-03-01" }).success).toBe(true);
    expect(taskPatchSchema.safeParse({ expectedVersion: 0, dueDate: "2026-03-01T10:00:00+02:00" }).success).toBe(true);
    expect(taskPatchSchema.safeParse({ expectedVersion: 0, dueDate: null }).success).toBe(true);
    expect(taskPatchSchema.safeParse({ expectedVersion: 0, dueDate: "tomorrow" }).success).toBe(false);
  });
  it("requires an expected revision on every patch (optimistic concurrency)", () => {
    expect(taskPatchSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(taskPatchSchema.safeParse({ expectedVersion: -1, title: "x" }).success).toBe(false);
    expect(taskPatchSchema.safeParse({ expectedVersion: 3, title: "x" }).success).toBe(true);
  });
  it("caps bulk batches and validates actions", () => {
    expect(taskBulkSchema.safeParse({ workspaceId: uuid, ids: [], action: "delete" }).success).toBe(false);
    expect(
      taskBulkSchema.safeParse({ workspaceId: uuid, ids: Array(101).fill(uuid), action: "delete" }).success,
    ).toBe(false);
    expect(taskBulkSchema.safeParse({ workspaceId: uuid, ids: [uuid], action: "archive" }).success).toBe(false);
  });
});

describe("membership role contracts", () => {
  it("accepts the three assignable roles including project_manager", () => {
    for (const role of ["admin", "project_manager", "member"] as const) {
      expect(memberInviteSchema.safeParse({ email: "a@b.co", role }).success).toBe(true);
      expect(memberPatchSchema.safeParse({ userId: "123e4567-e89b-42d3-a456-426614174000", role }).success).toBe(true);
    }
  });
  it("rejects owner as an assignable role and unknown values", () => {
    expect(memberInviteSchema.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
    expect(memberInviteSchema.safeParse({ email: "a@b.co", role: "superuser" }).success).toBe(false);
    expect(memberPatchSchema.safeParse({ userId: "123e4567-e89b-42d3-a456-426614174000", role: "owner" }).success).toBe(false);
  });
});

describe("query + view schemas", () => {
  it("coerces days and enforces bounds", () => {
    expect(analyticsQuerySchema.parse({ workspaceId: uuid, days: "30" }).days).toBe(30);
    expect(analyticsQuerySchema.safeParse({ workspaceId: uuid, days: 3 }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ workspaceId: uuid, days: 500 }).success).toBe(false);
  });
  it("view layout is a closed enum", () => {
    const cfg = { q: "", projectId: "", assigneeId: "", priority: "", tag: "", sort: "risk", layout: "board" };
    expect(viewConfigSchema.safeParse(cfg).success).toBe(true);
    expect(viewConfigSchema.safeParse({ ...cfg, layout: "gantt" }).success).toBe(false);
  });
});