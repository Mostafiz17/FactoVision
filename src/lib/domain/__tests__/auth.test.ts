import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { generateToken, hashToken } from "@/server/auth/tokens";

describe("password hashing (scrypt)", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("demo1234!");
    expect(hash.startsWith("scrypt$16384$")).toBe(true);
    expect(await verifyPassword("demo1234!", hash)).toBe(true);
  });
  it("rejects wrong passwords and malformed hashes", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$zz$zz")).toBe(false);
  });
  it("uses a fresh salt per hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });
});

describe("session tokens", () => {
  it("generates unique high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
    for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(42);
  });
  it("hashes deterministically to 64 hex chars (tokens never stored raw)", () => {
    const h = hashToken("abc");
    expect(h).toBe(hashToken("abc"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("abc");
  });
});