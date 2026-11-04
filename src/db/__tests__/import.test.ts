import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeSnapshot } from "../import";
import { INDEXES } from "../setup";

function snapshot() {
  const data = Object.fromEntries(Object.keys(INDEXES).map((name) => [name, []])) as Record<string, Record<string, unknown>[]>;
  const user = randomUUID(), ws = randomUUID();
  data.users = [{ id: user, email: "test@example.com", name: "Test", password_hash: "existing-hash", created_at: "2026-01-01T00:00:00Z" }];
  data.workspaces = [{ id: ws, created_by: user, name: "Workspace", slug: "workspace", created_at: "2026-01-01T00:00:00Z" }];
  data.memberships = [{ id: randomUUID(), workspace_id: ws, user_id: user, role: "owner", created_at: "2026-01-01T00:00:00Z" }];
  return data;
}
describe("offline snapshot migration", () => {
  it("preserves UUIDs and password hashes while converting keys and dates", () => {
    const data = snapshot(), normalized = normalizeSnapshot(data);
    expect(normalized.users[0]).toMatchObject({ id: data.users[0].id, passwordHash: "existing-hash", createdAt: new Date("2026-01-01T00:00:00Z") });
    expect(normalized.memberships[0].workspaceId).toBe(data.workspaces[0].id);
  });
  it("rejects omitted collections, invalid dates, duplicate IDs, and dangling references", () => {
    expect(() => normalizeSnapshot({})).toThrow(/array/);
    const badDate = snapshot(); badDate.users[0].created_at = "invalid";
    expect(() => normalizeSnapshot(badDate)).toThrow(/date/);
    const duplicate = snapshot(); duplicate.users.push(duplicate.users[0]);
    expect(() => normalizeSnapshot(duplicate)).toThrow(/Duplicate IDs/);
    const dangling = snapshot(); dangling.memberships[0].user_id = randomUUID();
    expect(() => normalizeSnapshot(dangling)).toThrow(/Dangling/);
  });
  it("rejects missing ownership and mixed MongoDB IDs", () => {
    const owner = snapshot(); owner.memberships[0].role = "member";
    expect(() => normalizeSnapshot(owner)).toThrow(/exactly one owner/);
    const mixed = snapshot(); mixed.users[0]._id = "507f1f77bcf86cd799439011";
    expect(() => normalizeSnapshot(mixed)).toThrow(/ID mismatch/);
  });
});
