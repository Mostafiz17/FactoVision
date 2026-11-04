import { describe, expect, it } from "vitest";
import { buildEvidence } from "../evidence";
import { dashboardFixture, FOREIGN_UUID } from "./fixture";

const gen = new Date("2026-03-15T12:00:00Z");

describe("evidence bundle", () => {
  const d = dashboardFixture();
  const bundle = buildEvidence(d, "Nova Product Lab", gen);

  it("numbers facts E01..En with unique ids and non-empty text", () => {
    expect(bundle.facts.length).toBeGreaterThan(10);
    const ids = bundle.facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id, i) => expect(id).toBe(`E${String(i + 1).padStart(2, "0")}`));
    for (const f of bundle.facts) expect(f.text.length).toBeGreaterThan(10);
  });

  it("states the numbers the dashboard computed (no invented values)", () => {
    const all = bundle.facts.map((f) => f.text).join("\n");
    expect(all).toContain("3 completed and 1 reopened");
    expect(all).toContain("33%"); // completion rate 1/3 → pct() rounds to whole percents
    expect(all).toContain("P50 3.3 days, P85 7 days"); // fmtDays rounds to 1 decimal
    expect(all).toContain("2 open task(s) past their due date");
    expect(all).toContain("2 open task(s) blocked");
    expect(all).toContain("Workload of Ben: 8 active pt");
    expect(all).toContain("Project “Alpha app”: 2/6 done");
    expect(all).toContain("1 high, 4 medium, 2 low");
    expect(all).toContain("model v2.0.0, config rev 0");
  });

  it("carries task references only for tasks the dashboard exposes, capped", () => {
    expect(bundle.taskRefs.length).toBeGreaterThan(0);
    expect(bundle.taskRefs.length).toBeLessThanOrEqual(12);
    const ids = new Set(bundle.taskRefs.map((t) => t.id));
    // every fact-attached task id must be a known fixture task
    for (const f of bundle.facts) for (const id of f.taskIds) expect(ids.has(id) || ["T6", "T10"].includes(id)).toBe(true);
    for (const t of bundle.taskRefs) expect(t.title.length).toBeGreaterThan(0);
  });

  it("never mentions data outside the supplied dashboard (tenant isolation by construction)", () => {
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(FOREIGN_UUID);
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("password");
  });

  it("is deterministic: same input → identical bundle", () => {
    expect(buildEvidence(dashboardFixture(), "Nova Product Lab", gen)).toEqual(bundle);
  });

  it("an empty workspace still produces a well-formed bundle", () => {
    const empty = buildEvidence(dashboardFixture({ projectId: "P3" }), "Empty", gen);
    expect(empty.facts.length).toBeGreaterThan(5);
    expect(empty.taskRefs).toEqual([]);
    expect(empty.facts.some((f) => f.text.includes("0 completed"))).toBe(true);
  });

  it("filters change the evidence (project P2 facts only mention P2 projects)", () => {
    const p2 = buildEvidence(dashboardFixture({ projectId: "P2" }), "Nova", gen);
    const text = p2.facts.map((f) => f.text).join("\n");
    expect(text).toContain("Project “Beta data”");
    expect(text).not.toContain("Project “Alpha app”");
  });
});
