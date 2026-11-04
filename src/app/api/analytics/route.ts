import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { computeAnalytics } from "@/server/modules/analytics/service";
import { analyticsQuerySchema } from "@/server/validation";

export async function GET(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;
    const input = analyticsQuerySchema.parse({
      workspaceId: params.get("workspaceId"),
      days: params.get("days") ?? 30,
    });
    return ok({ analytics: await computeAnalytics(user.id, input.workspaceId, input.days) });
  });
}