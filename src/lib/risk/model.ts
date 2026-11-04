import { z } from "zod";
import { roundHalfUp } from "@/lib/analytics/stats";

/**
 * Deadline-risk model v2 (pure, versioned, configurable). See RISK.md.
 *
 *   score = Σ round1(100 · wᵢ · vᵢ)          (factor values vᵢ ∈ [0, 1], Σ wᵢ = 1)
 *
 * Inputs: remaining effort and time available (combined into schedule pressure),
 * blocked duration, unresolved dependencies, assignee workload.
 *
 * Uncertainty: every factor carries a range [lowᵢ, highᵢ]. Missing inputs widen the
 * range (an unknown factor spans [0, 1]); a fallback velocity widens schedule
 * pressure by ±velocityUncertainty. The score interval is Σ 100·wᵢ·[lowᵢ, highᵢ].
 * Missing factors use `missingAssumption` for the point estimate — never silently 0.
 */

export const RISK_MODEL_VERSION = "2.0.0";
export const FACTOR_KEYS = ["schedule", "blockedDuration", "dependencies", "workload"] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

const weight = z.number().min(0).max(1);

export const riskConfigSchema = z
  .object({
    weights: z.object({
      schedule: weight,
      blockedDuration: weight,
      dependencies: weight,
      workload: weight,
    }),
    params: z.object({
      /** Fallback velocity when neither the assignee nor the team has enough samples. */
      defaultPointsPerDay: z.number().gt(0).max(50),
      /** Estimated completions needed before a velocity is trusted. */
      minVelocitySamples: z.number().int().min(1).max(50),
      /** Look-back window for velocity, in days. */
      velocityLookbackDays: z.number().int().min(7).max(180),
      /** Relative rate uncertainty applied when a fallback velocity is used. */
      velocityUncertainty: z.number().min(0).max(0.9),
      /** Days blocked at which blocked-duration pressure saturates. */
      blockedSaturationDays: z.number().gt(0).max(60),
      /** Unresolved blockers at which dependency pressure saturates. */
      dependencySaturation: z.number().int().min(1).max(20),
      /** Active points an assignee can carry before workload saturates. */
      capacityPoints: z.number().gt(0).max(200),
      /** Workload pressure policy for unassigned tasks. */
      unassignedWorkload: z.number().min(0).max(1),
      /** Assumed points for an unestimated active task (range uses [0, 2×]). */
      unestimatedTaskPoints: z.number().min(0).max(50),
      /** Point estimate used for a factor whose inputs are missing (range is [0, 1]). */
      missingAssumption: z.number().min(0).max(1),
    }),
    bands: z.object({
      mediumFrom: z.number().gt(0).lt(100),
      highFrom: z.number().gt(0).lt(100),
    }),
  })
  .refine((c) => Math.abs(FACTOR_KEYS.reduce((s, k) => s + c.weights[k], 0) - 1) < 1e-6, {
    message: "weights must sum to 1",
    path: ["weights"],
  })
  .refine((c) => c.bands.mediumFrom < c.bands.highFrom, {
    message: "bands.mediumFrom must be lower than bands.highFrom",
    path: ["bands"],
  });

export type RiskConfig = z.infer<typeof riskConfigSchema>;

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  weights: { schedule: 0.4, blockedDuration: 0.2, dependencies: 0.15, workload: 0.25 },
  params: {
    defaultPointsPerDay: 1,
    minVelocitySamples: 3,
    velocityLookbackDays: 30,
    velocityUncertainty: 0.5,
    blockedSaturationDays: 5,
    dependencySaturation: 3,
    capacityPoints: 8,
    unassignedWorkload: 0.5,
    unestimatedTaskPoints: 3,
    missingAssumption: 0.5,
  },
  bands: { mediumFrom: 34, highFrom: 67 },
};

export type RiskBand = "low" | "medium" | "high";
export type RiskConfidence = "high" | "medium" | "low";
export type VelocitySource = "assignee" | "team" | "default";

export interface RiskInput {
  /** Current estimate; analytics does not track partial progress, so the full estimate is remaining. */
  estimatePoints: number | null;
  dueDate: Date | null;
  /** Earliest creation instant of a currently unresolved blocker edge; null when not blocked or unknown. */
  blockedSince: Date | null;
  /** True when the task has unresolved blockers whose edge age is unknown. */
  blockedSinceUnknown: boolean;
  unresolvedBlockers: number;
  assigneeId: string | null;
  /** Σ estimated points of the assignee's active open tasks (including this task when active). */
  assigneeActivePoints: number;
  /** Count of the assignee's active open tasks without an estimate. */
  assigneeActiveUnestimated: number;
  velocity: { pointsPerDay: number; source: VelocitySource; samples: number };
}

export interface FactorResult {
  key: FactorKey;
  label: string;
  weight: number;
  /** Point value used for the score (assumption when missing). */
  value: number;
  low: number;
  high: number;
  missing: boolean;
  /** Points of 100 contributed to the score (rounded to 1 decimal). */
  contribution: number;
  explanation: string;
}

export interface RiskResult {
  modelVersion: string;
  configRevision: number;
  score: number;
  band: RiskBand;
  interval: { low: number; high: number };
  bandRange: { from: RiskBand; to: RiskBand };
  confidence: RiskConfidence;
  factors: FactorResult[];
  missingInputs: string[];
  velocity: { pointsPerDay: number; source: VelocitySource; samples: number };
}

const DAY_MS = 86_400_000;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r1 = (v: number) => roundHalfUp(v, 1);
const r2 = (v: number) => roundHalfUp(v, 2);

export function bandOf(score: number, config: RiskConfig): RiskBand {
  if (score >= config.bands.highFrom) return "high";
  if (score >= config.bands.mediumFrom) return "medium";
  return "low";
}

/** Interval width → confidence. Thresholds are part of the model version. */
export function confidenceOf(width: number): RiskConfidence {
  if (width < 10) return "high";
  if (width < 25) return "medium";
  return "low";
}

const LABELS: Record<FactorKey, string> = {
  schedule: "Schedule pressure",
  blockedDuration: "Blocked duration",
  dependencies: "Unresolved dependencies",
  workload: "Assignee workload",
};

interface Raw {
  value: number;
  low: number;
  high: number;
  missing: boolean;
  explanation: string;
}

function scheduleFactor(input: RiskInput, asOf: Date, c: RiskConfig): Raw {
  const p = c.params;
  if (input.dueDate === null) {
    return { value: p.missingAssumption, low: 0, high: 1, missing: true, explanation: "No due date — time available is unknown." };
  }
  const availableDays = (input.dueDate.getTime() - asOf.getTime()) / DAY_MS;
  if (availableDays <= 0) {
    return { value: 1, low: 1, high: 1, missing: false, explanation: `Overdue by ${r1(-availableDays)} day(s).` };
  }
  if (input.estimatePoints === null) {
    return {
      value: p.missingAssumption,
      low: 0,
      high: 1,
      missing: true,
      explanation: `${r1(availableDays)} day(s) available, but no estimate — remaining effort is unknown.`,
    };
  }
  const rate = input.velocity.pointsPerDay;
  const effortDays = input.estimatePoints / rate;
  const value = clamp01(effortDays / availableDays);
  const u = input.velocity.source === "assignee" ? 0 : p.velocityUncertainty;
  const low = clamp01(input.estimatePoints / (rate * (1 + u)) / availableDays);
  const high = u >= 1 ? 1 : clamp01(input.estimatePoints / (rate * (1 - u)) / availableDays);
  const source = input.velocity.source === "assignee" ? "assignee velocity" : input.velocity.source === "team" ? "team velocity (±uncertainty)" : "default velocity (±uncertainty)";
  return {
    value,
    low,
    high,
    missing: false,
    explanation: `${input.estimatePoints} pt at ${r2(rate)} pt/day (${source}) ≈ ${r1(effortDays)} day(s) of work vs ${r1(availableDays)} day(s) available.`,
  };
}

function blockedFactor(input: RiskInput, asOf: Date, c: RiskConfig): Raw {
  if (input.unresolvedBlockers === 0) {
    return { value: 0, low: 0, high: 0, missing: false, explanation: "Not blocked." };
  }
  if (input.blockedSince === null || input.blockedSinceUnknown) {
    return { value: c.params.missingAssumption, low: 0, high: 1, missing: true, explanation: "Blocked, but the blocking start time is unknown." };
  }
  const days = Math.max(0, (asOf.getTime() - input.blockedSince.getTime()) / DAY_MS);
  const value = clamp01(days / c.params.blockedSaturationDays);
  return { value, low: value, high: value, missing: false, explanation: `Blocked for ${r1(days)} day(s) (saturates at ${c.params.blockedSaturationDays}).` };
}

function dependencyFactor(input: RiskInput, c: RiskConfig): Raw {
  const value = clamp01(input.unresolvedBlockers / c.params.dependencySaturation);
  return {
    value,
    low: value,
    high: value,
    missing: false,
    explanation:
      input.unresolvedBlockers === 0
        ? "No unresolved blockers."
        : `${input.unresolvedBlockers} unresolved blocker(s) (saturates at ${c.params.dependencySaturation}).`,
  };
}

function workloadFactor(input: RiskInput, c: RiskConfig): Raw {
  const p = c.params;
  if (input.assigneeId === null) {
    return { value: p.unassignedWorkload, low: p.unassignedWorkload, high: p.unassignedWorkload, missing: false, explanation: `Unassigned — policy value ${p.unassignedWorkload}.` };
  }
  const known = input.assigneeActivePoints;
  const n = input.assigneeActiveUnestimated;
  const value = clamp01((known + n * p.unestimatedTaskPoints) / p.capacityPoints);
  const low = clamp01(known / p.capacityPoints);
  const high = clamp01((known + n * 2 * p.unestimatedTaskPoints) / p.capacityPoints);
  const unestimated = n > 0 ? ` plus ${n} unestimated active task(s) (assumed ${p.unestimatedTaskPoints} pt each, range 0–${2 * p.unestimatedTaskPoints})` : "";
  return { value, low, high, missing: n > 0, explanation: `Assignee carries ${r2(known)} estimated active pt${unestimated} vs capacity ${p.capacityPoints}.` };
}

export function computeTaskRisk(input: RiskInput, asOf: Date, config: RiskConfig, configRevision: number): RiskResult {
  const raws: Record<FactorKey, Raw> = {
    schedule: scheduleFactor(input, asOf, config),
    blockedDuration: blockedFactor(input, asOf, config),
    dependencies: dependencyFactor(input, config),
    workload: workloadFactor(input, config),
  };
  const factors: FactorResult[] = FACTOR_KEYS.map((key) => {
    const raw = raws[key];
    const w = config.weights[key];
    return {
      key,
      label: LABELS[key],
      weight: w,
      value: r2(raw.value),
      low: r2(raw.low),
      high: r2(raw.high),
      missing: raw.missing,
      contribution: r1(100 * w * raw.value),
      explanation: raw.explanation,
    };
  });
  const score = r1(factors.reduce((s, f) => s + f.contribution, 0));
  const low = r1(FACTOR_KEYS.reduce((s, k) => s + 100 * config.weights[k] * raws[k].low, 0));
  const high = r1(FACTOR_KEYS.reduce((s, k) => s + 100 * config.weights[k] * raws[k].high, 0));
  const missingInputs: string[] = [];
  if (input.dueDate === null) missingInputs.push("due date");
  if (input.estimatePoints === null && input.dueDate !== null && input.dueDate.getTime() > asOf.getTime()) missingInputs.push("estimate");
  if (raws.blockedDuration.missing) missingInputs.push("blocking start time");
  if (input.assigneeActiveUnestimated > 0 && input.assigneeId !== null) missingInputs.push("assignee task estimates");
  if (input.velocity.source !== "assignee" && !raws.schedule.missing && raws.schedule.low !== raws.schedule.high) {
    missingInputs.push(`assignee velocity (using ${input.velocity.source})`);
  }
  return {
    modelVersion: RISK_MODEL_VERSION,
    configRevision,
    score,
    band: bandOf(score, config),
    interval: { low: Math.min(low, score), high: Math.max(high, score) },
    bandRange: { from: bandOf(low, config), to: bandOf(high, config) },
    confidence: confidenceOf(high - low),
    factors,
    missingInputs,
    velocity: { ...input.velocity, pointsPerDay: r2(input.velocity.pointsPerDay) },
  };
}

/** Stable short fingerprint of a configuration (FNV-1a over canonical JSON). */
export function configFingerprint(config: RiskConfig): string {
  const canonical = JSON.stringify(config, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
