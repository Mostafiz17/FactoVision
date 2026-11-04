import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiError } from "@/lib/domain/errors";
export { ApiError } from "@/lib/domain/errors";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data as Record<string, unknown>, { status });
}

/** CSRF hardening: mutating requests must carry an Origin matching the Host. */
export function assertOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetch may omit Origin; SameSite=Lax cookie still applies
  const host = req.headers.get("host");
  // An Origin without a Host gives us nothing to compare against; fail closed.
  if (!host) throw new ApiError(403, "Missing Host header for origin check");
  try {
    const url = new URL(origin);
    if (url.host !== host) throw new ApiError(403, "Cross-origin request rejected");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, "Invalid origin");
  }
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be JSON");
  }
  return schema.parse(raw);
}

export function handleError(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const path = first?.path.join(".") ?? "";
    const message = first ? `${path ? path + ": " : ""}${first.message}` : "Invalid input";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  console.error("[api] unhandled error", e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function route(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    return handleError(e);
  }
}
