import { getDatabase } from "@/db";
import { hashToken } from "./tokens";
import { ApiError } from "@/server/http";

/** Ignore forwarding headers unless the operator explicitly trusts its proxy. */
export function clientAddress(req: Request): string {
  return process.env.TRUST_PROXY === "true"
    ? (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || "unknown")
    : "untrusted";
}

/** Atomic shared counters; TTL cleanup never determines whether a window expired. */
export async function enforceAuthLimit(key: string, capacity: number, now = Date.now()) {
  const windowMs = 10 * 60_000;
  const start = Math.floor(now / windowMs) * windowMs;
  const id = hashToken(key + ":" + start);
  const row = await (await getDatabase()).collection<{ _id: string; id: string; count: number; createdAt: Date; expiresAt: Date }>("auth_limits").findOneAndUpdate(
    { _id: id },
    { $setOnInsert: { id, createdAt: new Date(now), expiresAt: new Date(start + windowMs) }, $inc: { count: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  if ((row?.count ?? 0) > capacity) throw new ApiError(429, "Too many attempts. Try again in a few minutes.");
}
