import { FIXTURE_SOURCE } from "@/lib/analytics/__tests__/fixture";
import type { AnalyticsSource } from "@/lib/analytics/types";

/** Phase 5 fixture plus dated dependency edges (see model.test.ts for the hand calculation). */
const at = (iso: string) => new Date(iso);

export const DATED_SOURCE: AnalyticsSource = {
  ...FIXTURE_SOURCE,
  edges: [
    { taskId: "T5", dependsOnId: "T7", createdAt: at("2026-03-12T12:00:00Z") },
    { taskId: "T8", dependsOnId: "T6", createdAt: at("2026-03-13T00:00:00Z") },
    { taskId: "T8", dependsOnId: "T9", createdAt: at("2026-03-14T00:00:00Z") },
  ],
};

