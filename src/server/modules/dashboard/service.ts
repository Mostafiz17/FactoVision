import { store, memberUsers } from "@/db/repository";
import { buildWindow } from "@/lib/analytics";
import { buildDashboard, type DashboardDTO } from "@/lib/dashboard/model";
import { assessWorkspaceRisk } from "@/lib/risk/assess";
import { ensureCan, requireMembership } from "@/server/auth/guard";
import { loadAnalyticsSource } from "@/server/modules/analytics/repository";
import { assertFilterScope, validateQuery, type ReportQuery } from "@/server/modules/analytics/service";
import { loadRiskConfig } from "@/server/modules/risk/service";

/**
 * Dashboard data. Membership + analytics.read are checked first; filters are
 * validated (400) and project filters are scoped to the workspace (404). Risk is
 * scored over the whole workspace (workload and blockers cross project lines) and
 * then narrowed to the filtered population, so filtering never changes a task's score.
 */
export async function getDashboard(userId: string, workspaceId: string, query: ReportQuery): Promise<DashboardDTO> {
  const membership = await requireMembership(userId, workspaceId);
  ensureCan(membership.role, "analytics.read");
  const { asOf, filters } = validateQuery(query, new Date());
  await assertFilterScope(workspaceId, filters);
  const win = buildWindow(asOf, query.timeZone, query.days);
  const [source, projectRows, memberRows, riskConfig] = await Promise.all([
    loadAnalyticsSource(workspaceId, win, filters),
    store.projects.find({ workspaceId }, { sort: { name: 1 } }),
    memberUsers(workspaceId).then((rows) => rows.map(({ u }) => ({ id: u.id, name: u.name }))),
    loadRiskConfig(workspaceId),
  ]);
  const results = assessWorkspaceRisk(source, asOf, riskConfig.config, riskConfig.revision);
  return buildDashboard(
    source,
    { asOf, timeZone: query.timeZone, days: query.days, filters },
    {
      results,
      meta: {
        modelVersion: riskConfig.modelVersion,
        revision: riskConfig.revision,
        fingerprint: riskConfig.fingerprint,
        capacityPoints: riskConfig.config.params.capacityPoints,
      },
    },
    projectRows,
    memberRows,
  );
}
