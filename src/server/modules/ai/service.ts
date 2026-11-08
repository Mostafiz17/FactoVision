import { deterministicInsights } from "@/lib/ai/deterministic";
import { BRAND } from "@/lib/brand";
import { buildEvidence } from "@/lib/ai/evidence";
import { enforceAuthLimit } from "@/server/auth/limits";
import type { AnalyticsFilters } from "@/lib/analytics";
import { validateInsights, type InsightsDTO } from "@/lib/ai/types";
import { getEnv } from "@/server/env";
import { ApiError } from "@/server/http";
import { ensureCan, requireMembership } from "@/server/auth/guard";
import { getDashboard } from "@/server/modules/dashboard/service";
import { AiProviderError, generateWithOpenAI } from "./openai";

/**
 * Optional AI insights (ADR-005, ADR-018). Core analytics never depend on this
 * module: with no credentials, on provider failure, timeout, provider rate
 * limit, or invalid output, the deterministic narrator answers and the response
 * says so (`mode`). The `mode` field is never "ai" unless validated model output
 * was actually used.
 */

/** Per-user fixed window: protects the paid provider and the DB from bursts. */


function deterministic(
  providerNote: string,
  dashboard: Parameters<typeof deterministicInsights>[0],
  bundle: Parameters<typeof deterministicInsights>[1],
  providerAttempted = false,
): InsightsDTO {
  return {
    mode: "deterministic",
    providerAttempted,
    provider: providerNote,
    generatedAt: new Date().toISOString(),
    insights: deterministicInsights(dashboard, bundle),
    droppedInvalid: 0,
    evidenceCount: bundle.facts.length,
  };
}

export async function getInsights(userId: string, workspaceId: string, days: number, scope: { timeZone: string; filters: AnalyticsFilters } = { timeZone: "UTC", filters: {} }): Promise<InsightsDTO> {
  const membership = await requireMembership(userId, workspaceId);
  ensureCan(membership.role, "analytics.read");
  await enforceAuthLimit("ai:" + userId, 10);
  // Evidence is built from the caller's authorized dashboard only — the model
  // never receives database access or another tenant's data.
  const dashboard = await getDashboard(userId, workspaceId, { days, ...scope });
  const workspaceName = "this workspace"; // name not needed by the model; avoids extra read
  const bundle = buildEvidence(dashboard, workspaceName, new Date());

  const env = getEnv();
  const key = env.OPENAI_API_KEY;
  if (!key) {
    return deterministic(`${BRAND.name} rule engine (no AI credentials configured)`, dashboard, bundle);
  }
  try {
    const raw = await generateWithOpenAI(bundle, {
      apiKey: key,
      model: env.AI_MODEL ?? "gpt-4o-mini",
      timeoutMs: env.AI_TIMEOUT_MS ?? 15_000,
    });
    const { insights, droppedInvalid } = validateInsights(raw, bundle);
    if (insights.length === 0) {
      // Model answered but nothing cited real evidence — fall back, say so.
      return deterministic(`${BRAND.name} rule engine (AI output failed validation)`, dashboard, bundle, true);
    }
    return {
      mode: "ai",
      providerAttempted: true,
      provider: env.AI_MODEL ?? "gpt-4o-mini",
      generatedAt: new Date().toISOString(),
      insights,
      droppedInvalid,
      evidenceCount: bundle.facts.length,
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const note = e instanceof AiProviderError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : "unknown failure";
    console.error("[ai] provider failed, using deterministic narrator —", note);
    return deterministic(`${BRAND.name} rule engine (AI provider unavailable — ${e instanceof AiProviderError ? e.kind : "error"})`, dashboard, bundle, true);
  }
}
