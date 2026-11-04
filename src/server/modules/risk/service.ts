import { store, workspaceTransaction } from "@/db/repository";
import { buildWindow } from "@/lib/analytics";
import { assessWorkspaceRisk } from "@/lib/risk/assess";
import {
  configFingerprint,
  DEFAULT_RISK_CONFIG,
  RISK_MODEL_VERSION,
  riskConfigSchema,
  type RiskConfig,
  type RiskResult,
} from "@/lib/risk/model";
import { ensureCan, requireMembership } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import { loadAnalyticsSource } from "@/server/modules/analytics/repository";

export interface StoredRiskConfig {
  modelVersion: string;
  revision: number;
  config: RiskConfig;
  fingerprint: string;
  isDefault: boolean;
  updatedAt: string | null;
}

/**
 * Loads the workspace configuration. A stored config written for a different model
 * version, or one that no longer validates, is ignored in favour of the defaults
 * (it is never silently reinterpreted); the revision is kept so the change is visible.
 */
export async function loadRiskConfig(workspaceId: string): Promise<StoredRiskConfig> {
  const row = await store.riskConfigs.one({ workspaceId });
  if (row && row.modelVersion === RISK_MODEL_VERSION) {
    const parsed = riskConfigSchema.safeParse(row.config);
    if (parsed.success) {
      return {
        modelVersion: row.modelVersion,
        revision: row.revision,
        config: parsed.data,
        fingerprint: configFingerprint(parsed.data),
        isDefault: false,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
  }
  return {
    modelVersion: RISK_MODEL_VERSION,
    revision: row?.revision ?? 0,
    config: DEFAULT_RISK_CONFIG,
    fingerprint: configFingerprint(DEFAULT_RISK_CONFIG),
    isDefault: true,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

export async function getRiskConfig(userId: string, workspaceId: string): Promise<StoredRiskConfig> {
  const m = await requireMembership(userId, workspaceId);
  ensureCan(m.role, "analytics.read");
  return loadRiskConfig(workspaceId);
}

/**
 * Admin-only. `expectedRevision` makes concurrent edits fail loudly (409) instead of
 * one silently overwriting the other. Every accepted change increments the revision.
 */
export async function updateRiskConfig(
  userId: string,
  workspaceId: string,
  input: { config: unknown; expectedRevision: number },
): Promise<StoredRiskConfig> {
  const m = await requireMembership(userId, workspaceId);
  ensureCan(m.role, "risk.configure");
  const parsed = riskConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, `${issue?.path.join(".") || "config"}: ${issue?.message ?? "invalid"}`);
  }
  return workspaceTransaction(workspaceId, async () => {
    const membership = await requireMembership(userId, workspaceId);
    ensureCan(membership.role, "risk.configure");
    const current = await store.riskConfigs.one({ workspaceId });
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ApiError(409, "Risk configuration changed since you loaded it; reload and retry");
    }
    const next = { modelVersion: RISK_MODEL_VERSION, revision: currentRevision + 1, config: parsed.data, updatedBy: userId, updatedAt: new Date() };
    if (current) await store.riskConfigs.update({ workspaceId, revision: currentRevision }, next);
    else await store.riskConfigs.insert({ workspaceId, ...next });
    return {
      modelVersion: RISK_MODEL_VERSION,
      revision: next.revision,
      config: parsed.data,
      fingerprint: configFingerprint(parsed.data),
      isDefault: false,
      updatedAt: next.updatedAt.toISOString(),
    };
  });
}

/**
 * Scores every open task of a workspace at `asOf`. Callers must already have
 * authorized the workspace. Shared by the board, task drawer, analytics and dashboard
 * so a task has one score everywhere.
 */
export async function workspaceRisk(
  workspaceId: string,
  asOf: Date = new Date(),
): Promise<{ results: Map<string, RiskResult>; config: StoredRiskConfig }> {
  const config = await loadRiskConfig(workspaceId);
  const win = buildWindow(asOf, "UTC", 1);
  const source = await loadAnalyticsSource(workspaceId, win, {});
  return { results: assessWorkspaceRisk(source, asOf, config.config, config.revision), config };
}
