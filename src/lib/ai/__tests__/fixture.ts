import { AS_OF } from "@/lib/analytics/__tests__/fixture";
import { assessWorkspaceRisk } from "@/lib/risk/assess";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/model";
import { DATED_SOURCE } from "@/lib/risk/__tests__/fixture";
import { buildDashboard, type DashboardDTO } from "@/lib/dashboard/model";

/** Real DashboardDTO derived from the Phase 5/6 hand-calculated fixture. */
export function dashboardFixture(filters = {}): DashboardDTO {
  return buildDashboard(
    DATED_SOURCE,
    { asOf: AS_OF, timeZone: "UTC", days: 7, filters },
    {
      results: assessWorkspaceRisk(DATED_SOURCE, AS_OF, DEFAULT_RISK_CONFIG, 0),
      meta: { modelVersion: "2.0.0", revision: 0, fingerprint: "fixture", capacityPoints: 8 },
    },
    [
      { id: "P1", name: "Alpha app", color: "#7c5cff" },
      { id: "P2", name: "Beta data", color: "#22d3ee" },
    ],
    [
      { id: "A", name: "Ann" },
      { id: "B", name: "Ben" },
    ],
  );
}

export const TENANT_A_TASK_IDS = ["T1", "T2", "T3", "T4", "T5", "T7", "T8", "T9", "T11"];
export const FOREIGN_UUID = "99999999-8888-4777-8666-555555555555";
