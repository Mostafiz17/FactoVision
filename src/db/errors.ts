function details(error: unknown): { message: string; name?: string; code?: string | number; codeName?: string; cause?: unknown } {
  if (!error || typeof error !== "object") return { message: typeof error === "string" ? error : "Unknown error" };
  const value = error as Record<string, unknown>;
  return {
    message: typeof value.message === "string" ? value.message : "Unknown error",
    name: typeof value.name === "string" ? value.name : undefined,
    code: typeof value.code === "number" || typeof value.code === "string" ? value.code : undefined,
    codeName: typeof value.codeName === "string" ? value.codeName : undefined,
    cause: value.cause,
  };
}

/** Redact the URI plus encoded/decoded credentials even if a driver message
 * prints them separately. Never stringify driver objects, stacks, or env files.
 */
export function redactMongoMessage(message: string, uri = process.env.MONGODB_URI): string {
  const secrets = new Set<string>();
  if (uri) {
    secrets.add(uri);
    const authority = uri.replace(/^mongodb(?:\+srv)?:\/\//i, "").split(/[/?#]/, 1)[0];
    const at = authority.lastIndexOf("@");
    if (at >= 0) {
      const userInfo = authority.slice(0, at);
      const colon = userInfo.indexOf(":");
      for (const part of colon >= 0 ? [userInfo.slice(0, colon), userInfo.slice(colon + 1)] : [userInfo]) {
        if (part) secrets.add(part);
        try { const decoded = decodeURIComponent(part); if (decoded) secrets.add(decoded); } catch { /* malformed escape */ }
      }
    }
    const query = uri.split("?", 2)[1];
    if (query) for (const [key, value] of new URLSearchParams(query)) {
      if (/password|token|secret|api.?key/i.test(key) && value) secrets.add(value);
    }
  }
  let safe = message.replace(/mongodb(?:\+srv)?:\/\/[^\s<>"']+/gi, "[REDACTED_URI]");
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) safe = safe.split(secret).join("[REDACTED]");
  return safe.replace(/[\r\n\t]+/g, " ");
}

export class MongoInitializationError extends Error {
  readonly code?: string | number;
  readonly codeName?: string;
  constructor(operation: "setup" | "verify", collection: string, error: unknown) {
    const original = details(error);
    const missing = original.code === 26 ? " Collection is missing; run npm run db:setup before starting the app." : "";
    super(`MongoDB ${operation} failed for collection "${collection}".${missing}`, {
      cause: new Error(redactMongoMessage(original.message)),
    });
    this.name = "MongoInitializationError";
    this.code = original.code;
    this.codeName = original.codeName;
  }
}

export function formatMongoError(error: unknown, uri = process.env.MONGODB_URI): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  let code: string | number | undefined;
  let codeName: string | undefined;
  let name: string | undefined;
  while (current && !seen.has(current) && seen.size < 8) {
    seen.add(current);
    const item = details(current);
    code ??= item.code;
    codeName ??= item.codeName;
    name ??= item.name;
    messages.push(item.message);
    current = item.cause;
  }
  if (!messages.length) messages.push("Unknown error");
  const metadata = [name, code !== undefined ? "code=" + code : undefined, codeName].filter(Boolean).join(", ");
  const hints: Record<string, string> = {
    "13": "The database user lacks privileges for the reported operation; review database-scoped setup permissions. No authentication options were changed.",
    "18": "Atlas rejected authentication; verify the configured credentials and authSource with the database administrator.",
    "26": "The database has not been fully initialized; run npm run db:setup with the same environment as npm run start.",
    "85": "An existing index has different options; review it explicitly. Setup will not drop or replace it.",
    "86": "An existing index has a conflicting key definition; review it explicitly. Setup will not drop it.",
    "11000": "Existing duplicate keys prevent a unique index; review the records. Setup will not delete or rewrite them.",
  };
  return redactMongoMessage([metadata ? "[" + metadata + "]" : "", messages.join(" Cause: "), code !== undefined ? hints[String(code)] : undefined].filter(Boolean).join(" "), uri);
}
