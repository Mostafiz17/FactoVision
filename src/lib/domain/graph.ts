/**
 * Dependency graph helpers. Edge A → B means "A depends on B" (B blocks A).
 * Adding an edge is rejected when it would create a directed cycle.
 */
export type Edge = { from: string; to: string };

export function wouldCreateCycle(edges: Edge[], candidate: Edge): boolean {
  if (candidate.from === candidate.to) return true;
  // A cycle appears iff `candidate.from` is reachable from `candidate.to`.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  const stack = [candidate.to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node === candidate.from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adj.get(node) ?? []) stack.push(next);
  }
  return false;
}