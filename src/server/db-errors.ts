/** MongoDB duplicate-key error, including driver-wrapped errors. */
export function isUniqueViolation(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<object>(); // driver errors can wrap themselves via `cause`
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === 11000) return true;
    if (candidate.cause) queue.push(candidate.cause);
  }
  return false;
}
