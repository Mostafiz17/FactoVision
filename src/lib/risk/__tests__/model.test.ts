import { describe, expect, it } from "vitest";
import { AS_OF, FIXTURE_SOURCE } from "@/lib/analytics/__tests__/fixture";
import type { AnalyticsSource } from "@/lib/analytics/types";
import { DATED_SOURCE } from "./fixture";
import { assessWorkspaceRisk } from "../assess";
import {
  computeTaskRisk,
  configFingerprint,
  DEFAULT_RISK_CONFIG,
  riskConfigSchema,
  type RiskConfig,
  type RiskInput,
} from "../model";

/*
 * Hand-calculated against the Phase 5 fixture (asOf 2026-03-15T12:00Z) with dated edges:
 *   T5 ← T7 since 03-12T12:00 (3.0 days), T8 ← T6 (resolved), T8 ← T9 since 03-14T00:00 (1.5 days).
 * Velocity look-back 30 d: estimated completions T1 (A,3), T4 (A,2), T2 (B,5), T6 (B,1).
 *   A and B have 2 samples each (< 3), team has 4 → team rate = 11 / 30 / 2 = 0.18333 pt/day.
 * Default weights: schedule .40, blocked .20, dependencies .15, workload .25; capacity 8 pt.
 */
const at = (iso: string) => new Date(iso);

const results = assessWorkspaceRisk(DATED_SOURCE, AS_OF, DEFAULT_RISK_CONFIG, 0);
const get = (id: string) => {
  const r = results.get(id);
  if (!r) throw new Error(`no risk for ${id}`);
  return r;
};
const contrib = (id: string) => Object.fromEntries(get(id).factors.map((f) => [f.key, f.contribution]));

describe("workspace assessment against the hand-calculated fixture", () => {
  it("scores exactly the 7 open tasks (done and deleted tasks are not scored)", () => {
    expect([...results.keys()].sort()).toEqual(["T11", "T2", "T3", "T5", "T7", "T8", "T9"]);
  });

  it("T2 (overdue, assignee B at 8/8 pt): 40 + 0 + 0 + 25 = 65, medium, no uncertainty", () => {
    expect(contrib("T2")).toEqual({ schedule: 40, blockedDuration: 0, dependencies: 0, workload: 25 });
    expect(get("T2")).toMatchObject({ score: 65, band: "medium", interval: { low: 65, high: 65 }, confidence: "high", missingInputs: [] });
  });

  it("T5 (overdue, blocked 3 d by 1 open task, unassigned): 40 + 12 + 5 + 12.5 = 69.5, high", () => {
    expect(contrib("T5")).toEqual({ schedule: 40, blockedDuration: 12, dependencies: 5, workload: 12.5 });
    expect(get("T5")).toMatchObject({ score: 69.5, band: "high", interval: { low: 69.5, high: 69.5 }, confidence: "high" });
  });

  it("T7 (3 pt, 4.5 d left, team velocity): effort 16.4 d ≫ 4.5 d → schedule saturated even at +50% rate", () => {
    const schedule = get("T7").factors.find((f) => f.key === "schedule");
    expect(schedule).toMatchObject({ value: 1, low: 1, high: 1, missing: false });
    expect(get("T7")).toMatchObject({ score: 65, band: "medium", confidence: "high" });
    expect(get("T7").velocity).toEqual({ pointsPerDay: 0.18, source: "team", samples: 4 });
  });

  it("T3 (no due date, A's only active task unestimated): 20 + 9.4 = 29.4, interval 0–58.8, low confidence", () => {
    expect(contrib("T3")).toEqual({ schedule: 20, blockedDuration: 0, dependencies: 0, workload: 9.4 });
    expect(get("T3")).toMatchObject({
      score: 29.4,
      band: "low",
      interval: { low: 0, high: 58.8 },
      bandRange: { from: "low", to: "medium" },
      confidence: "low",
      missingInputs: ["due date", "assignee task estimates"],
    });
  });

  it("T8 (no due date, blocked 1.5 d — the resolved T6 edge is ignored): 20 + 6 + 5 + 9.4 = 40.4, range 11–69.8", () => {
    expect(contrib("T8")).toEqual({ schedule: 20, blockedDuration: 6, dependencies: 5, workload: 9.4 });
    expect(get("T8")).toMatchObject({ score: 40.4, band: "medium", interval: { low: 11, high: 69.8 }, bandRange: { from: "low", to: "high" }, confidence: "low" });
  });

  it("T9 (1 pt due in 0.5 d): schedule saturated; only workload is uncertain → 49.4, range 40–58.8, medium confidence", () => {
    expect(get("T9")).toMatchObject({ score: 49.4, band: "medium", interval: { low: 40, high: 58.8 }, bandRange: { from: "medium", to: "medium" }, confidence: "medium" });
  });

  it("T11 (unassigned, no due date): 20 + 12.5 = 32.5, range 12.5–52.5", () => {
    expect(get("T11")).toMatchObject({ score: 32.5, band: "low", interval: { low: 12.5, high: 52.5 }, confidence: "low" });
  });

  it("invariants for every task: contributions sum to the score; the interval contains it; versioned", () => {
    for (const r of results.values()) {
      const sum = Math.round(r.factors.reduce((s, f) => s + f.contribution, 0) * 10) / 10;
      expect(sum).toBe(r.score);
      expect(r.interval.low).toBeLessThanOrEqual(r.score);
      expect(r.interval.high).toBeGreaterThanOrEqual(r.score);
      expect(r.modelVersion).toBe("2.0.0");
      for (const f of r.factors) {
        expect(f.low).toBeLessThanOrEqual(f.value);
        expect(f.high).toBeGreaterThanOrEqual(f.value);
      }
    }
  });

  it("an edge without a timestamp makes blocked duration unknown (range 0–1), never zero", () => {
    const undated = assessWorkspaceRisk(FIXTURE_SOURCE, AS_OF, DEFAULT_RISK_CONFIG, 0).get("T5");
    const blocked = undated?.factors.find((f) => f.key === "blockedDuration");
    expect(blocked).toMatchObject({ value: 0.5, low: 0, high: 1, missing: true });
    expect(undated?.missingInputs).toContain("blocking start time");
  });

  it("edges added after asOf do not block during replay", () => {
    const future: AnalyticsSource = { ...DATED_SOURCE, edges: [{ taskId: "T5", dependsOnId: "T7", createdAt: at("2026-03-20T00:00:00Z") }] };
    const r = assessWorkspaceRisk(future, AS_OF, DEFAULT_RISK_CONFIG, 0).get("T5");
    expect(r?.factors.find((f) => f.key === "dependencies")?.value).toBe(0);
  });
});

const base: RiskInput = {
  estimatePoints: 4,
  dueDate: at("2026-03-19T12:00:00Z"), // 4 days after asOf
  blockedSince: null,
  blockedSinceUnknown: false,
  unresolvedBlockers: 0,
  assigneeId: "A",
  assigneeActivePoints: 4,
  assigneeActiveUnestimated: 0,
  velocity: { pointsPerDay: 2, source: "assignee", samples: 5 },
};

describe("factor formulas", () => {
  it("schedule = effortDays ÷ availableDays: 4 pt at 2 pt/day = 2 d of 4 d → 0.5, exact with own velocity", () => {
    const f = computeTaskRisk(base, AS_OF, DEFAULT_RISK_CONFIG, 0).factors.find((x) => x.key === "schedule");
    expect(f).toMatchObject({ value: 0.5, low: 0.5, high: 0.5, missing: false, contribution: 20 });
  });

  it("team or default velocity widens schedule by ±50%: 2 pt/day → rates 3 and 1 → range 0.33–1", () => {
    const f = computeTaskRisk({ ...base, velocity: { pointsPerDay: 2, source: "team", samples: 4 } }, AS_OF, DEFAULT_RISK_CONFIG, 0).factors.find((x) => x.key === "schedule");
    expect(f).toMatchObject({ value: 0.5, low: 0.33, high: 1 });
  });

  it("missing estimate before the deadline is unknown effort; past the deadline it is simply overdue", () => {
    const unknown = computeTaskRisk({ ...base, estimatePoints: null }, AS_OF, DEFAULT_RISK_CONFIG, 0);
    expect(unknown.factors[0]).toMatchObject({ value: 0.5, low: 0, high: 1, missing: true });
    expect(unknown.missingInputs).toContain("estimate");
    const overdue = computeTaskRisk({ ...base, estimatePoints: null, dueDate: at("2026-03-14T00:00:00Z") }, AS_OF, DEFAULT_RISK_CONFIG, 0);
    expect(overdue.factors[0]).toMatchObject({ value: 1, low: 1, high: 1, missing: false });
  });

  it("a due instant equal to asOf counts as overdue (no time available)", () => {
    expect(computeTaskRisk({ ...base, dueDate: AS_OF }, AS_OF, DEFAULT_RISK_CONFIG, 0).factors[0].value).toBe(1);
  });

  it("blocked duration and dependency pressure saturate at their configured limits", () => {
    const r = computeTaskRisk({ ...base, unresolvedBlockers: 5, blockedSince: at("2026-03-01T00:00:00Z") }, AS_OF, DEFAULT_RISK_CONFIG, 0);
    expect(r.factors.find((f) => f.key === "blockedDuration")?.value).toBe(1);
    expect(r.factors.find((f) => f.key === "dependencies")?.value).toBe(1);
  });

  it("bands use the configured thresholds (≥ highFrom is high)", () => {
    const high = computeTaskRisk({ ...base, dueDate: at("2026-03-14T00:00:00Z"), assigneeActivePoints: 8, unresolvedBlockers: 1, blockedSince: at("2026-03-15T12:00:00Z") }, AS_OF, DEFAULT_RISK_CONFIG, 0);
    // 40 + 0 + 5 + 25 = 70 → high
    expect(high).toMatchObject({ score: 70, band: "high" });
  });
});

describe("configuration and versioning", () => {
  it("the default configuration validates and its weights sum to 1", () => {
    expect(riskConfigSchema.safeParse(DEFAULT_RISK_CONFIG).success).toBe(true);
  });

  it("rejects weights that do not sum to 1, inverted bands and out-of-range parameters", () => {
    const bad = (patch: (c: RiskConfig) => RiskConfig) => riskConfigSchema.safeParse(patch(structuredClone(DEFAULT_RISK_CONFIG))).success;
    expect(bad((c) => ({ ...c, weights: { ...c.weights, schedule: 0.5 } }))).toBe(false);
    expect(bad((c) => ({ ...c, bands: { mediumFrom: 70, highFrom: 60 } }))).toBe(false);
    expect(bad((c) => ({ ...c, params: { ...c.params, capacityPoints: 0 } }))).toBe(false);
    expect(bad((c) => ({ ...c, params: { ...c.params, velocityUncertainty: 1 } }))).toBe(false);
  });

  it("changing the configuration changes scores: doubling workload weight raises T2", () => {
    const cfg: RiskConfig = { ...DEFAULT_RISK_CONFIG, weights: { schedule: 0.3, blockedDuration: 0.1, dependencies: 0.1, workload: 0.5 } };
    const r = assessWorkspaceRisk(DATED_SOURCE, AS_OF, cfg, 7).get("T2");
    expect(r).toMatchObject({ score: 80, configRevision: 7 }); // 30 + 0 + 0 + 50
  });

  it("fingerprints ignore key order and change when any value changes", () => {
    const reordered = JSON.parse(JSON.stringify({ bands: DEFAULT_RISK_CONFIG.bands, params: DEFAULT_RISK_CONFIG.params, weights: DEFAULT_RISK_CONFIG.weights })) as RiskConfig;
    expect(configFingerprint(reordered)).toBe(configFingerprint(DEFAULT_RISK_CONFIG));
    expect(configFingerprint({ ...DEFAULT_RISK_CONFIG, bands: { mediumFrom: 30, highFrom: 67 } })).not.toBe(configFingerprint(DEFAULT_RISK_CONFIG));
  });
});
