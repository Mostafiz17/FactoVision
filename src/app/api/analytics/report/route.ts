import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { getAnalyticsReport } from "@/server/modules/analytics/service";
import { analyticsReportQuerySchema } from "@/server/validation";

/**
 * GET /api/analytics/report — deterministic analytics (see ANALYTICS.md).
 * Query: workspaceId, days (1–366, default 30), tz (IANA, default UTC),
 * asOf (ISO instant, default now), projectId, assigneeId (uuid | none),
 * priority, label. Membership and analytics.read are enforced in the service.
 */
export async function GET(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const p = new URL(req.url).searchParams;
    const q = analyticsReportQuerySchema.parse({
      workspaceId: p.get("workspaceId"),
      days: p.get("days") ?? 30,
      tz: p.get("tz") ?? undefined,
      asOf: p.get("asOf") ?? undefined,
      projectId: p.get("projectId") ?? undefined,
      assigneeId: p.get("assigneeId") ?? undefined,
      priority: p.get("priority") ?? undefined,
      label: p.get("label") ?? undefined,
    });
    const report = await getAnalyticsReport(user.id, q.workspaceId, {
      days: q.days,
      timeZone: q.tz,
      asOf: q.asOf ? new Date(q.asOf) : undefined,
      filters: { projectId: q.projectId, assigneeId: q.assigneeId, priority: q.priority, label: q.label },
    });
    return ok({ report });
  });
}
