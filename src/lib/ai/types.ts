import { z } from "zod";

/**
 * Provider-independent AI contracts.
 *
 * The model never sees the database. It receives an EvidenceBundle: numbered
 * facts (E01…En) derived from the caller's authorized dashboard, plus a closed
 * list of task references. Every returned insight must cite the evidence it
 * relies on; citations are validated against the bundle before anything is
 * shown, and facts are kept separate from suggestions.
 */

export interface EvidenceFact {
  id: string;
  text: string;
  taskIds: string[];
}

export interface EvidenceBundle {
  workspaceName: string;
  generatedAt: string;
  facts: EvidenceFact[];
  /** Closed set of task ids the model may reference. */
  taskRefs: { id: string; title: string }[];
}

export type InsightKind = "fact" | "suggestion";
export type InsightSeverity = "info" | "success" | "warning" | "danger";

export interface InsightItem {
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** Ids of evidence facts this insight relies on; must be non-empty and known. */
  evidenceRefs: string[];
  taskIds: string[];
}

export interface InsightsDTO {
  mode: "deterministic" | "ai";
  provider: string;
  generatedAt: string;
  insights: InsightItem[];
  /** Model outputs rejected by validation (unknown/missing citations, bad shape). */
  droppedInvalid: number;
  evidenceCount: number;
}

export const MAX_INSIGHTS = 6;

export const insightSchema = z.object({
  kind: z.enum(["fact", "suggestion"]),
  severity: z.enum(["info", "success", "warning", "danger"]),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(1200),
  evidenceRefs: z.array(z.string().min(1).max(16)).min(1).max(6),
  taskIds: z.array(z.string().min(1).max(64)).max(10).default([]),
});

export interface ValidatedInsights {
  insights: InsightItem[];
  droppedInvalid: number;
}

/**
 * Validates raw model output against the bundle:
 * - shape/limits via Zod (malformed items are dropped, not coerced);
 * - every evidenceRef must be a fact id in the bundle (unknown citation ⇒ item dropped);
 * - unknown task ids are stripped (the model may only point at supplied tasks);
 * - at most MAX_INSIGHTS kept (rest counted as dropped).
 */
export function validateInsights(raw: unknown, bundle: EvidenceBundle): ValidatedInsights {
  // Accept either a bare array or the {"insights": [...]} envelope the system prompt requests.
  const parsed = z
    .union([z.array(z.unknown()), z.object({ insights: z.array(z.unknown()) }).transform((v) => v.insights)])
    .safeParse(raw);
  if (!parsed.success) return { insights: [], droppedInvalid: 1 };
  const factIds = new Set(bundle.facts.map((f) => f.id));
  const taskIds = new Set(bundle.taskRefs.map((t) => t.id));
  const insights: InsightItem[] = [];
  let droppedInvalid = 0;
  for (const candidate of parsed.data) {
    const item = insightSchema.safeParse(candidate);
    if (!item.success) {
      droppedInvalid += 1;
      continue;
    }
    const refs = item.data.evidenceRefs.filter((r) => factIds.has(r));
    if (refs.length === 0) {
      droppedInvalid += 1; // recommendation without supplied evidence is not shown
      continue;
    }
    insights.push({
      kind: item.data.kind,
      severity: item.data.severity,
      title: item.data.title,
      body: item.data.body,
      evidenceRefs: refs,
      taskIds: item.data.taskIds.filter((id) => taskIds.has(id)),
    });
    if (insights.length === MAX_INSIGHTS) {
      droppedInvalid += parsed.data.length - insights.length - droppedInvalid;
      break;
    }
  }
  return { insights, droppedInvalid };
}
