import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { getInsights } from "@/server/modules/ai/service";
import { aiInsightsSchema } from "@/server/validation";

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, aiInsightsSchema);
    return ok(await getInsights(user.id, input.workspaceId, input.days));
  });
}