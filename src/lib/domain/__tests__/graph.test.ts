import { describe, expect, it } from "vitest";
import { wouldCreateCycle, type Edge } from "../graph";

describe("dependency cycle prevention", () => {
  it("rejects self-dependency", () => {
    expect(wouldCreateCycle([], { from: "a", to: "a" })).toBe(true);
  });
  it("rejects a direct two-node cycle", () => {
    const edges: Edge[] = [{ from: "a", to: "b" }];
    expect(wouldCreateCycle(edges, { from: "b", to: "a" })).toBe(true);
  });
  it("rejects a transitive cycle", () => {
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ];
    expect(wouldCreateCycle(edges, { from: "d", to: "a" })).toBe(true);
  });
  it("allows DAG additions (diamond dependencies)", () => {
    const edges: Edge[] = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
    ];
    expect(wouldCreateCycle(edges, { from: "c", to: "d" })).toBe(false);
    expect(wouldCreateCycle(edges, { from: "x", to: "a" })).toBe(false);
  });
});