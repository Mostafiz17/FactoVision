import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { listActivityPage } from "@/server/modules/collaboration/service";
import { activityQuerySchema } from "@/server/validation";

export async function GET(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const p = new URL(req.url).searchParams;
    const q = activityQuerySchema.parse({
      workspaceId: p.get("workspaceId"),
      projectId: p.get("projectId") ?? undefined,
      taskId: p.get("taskId") ?? undefined,
      cursor: p.get("cursor") ?? undefined,
      limit: p.get("limit") ?? undefined,
    });
    return ok(await listActivityPage(user.id, q));
  });
}