import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { getDashboard } from "@/server/modules/dashboard/service";
import { analyticsReportQuerySchema } from "@/server/validation";

/** GET /api/dashboard — same query contract as /api/analytics/report (validated server-side). */
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
    const dashboard = await getDashboard(user.id, q.workspaceId, {
      days: q.days,
      timeZone: q.tz,
      asOf: q.asOf ? new Date(q.asOf) : undefined,
      filters: { projectId: q.projectId, assigneeId: q.assigneeId, priority: q.priority, label: q.label },
    });
    return ok({ dashboard });
  });
}
