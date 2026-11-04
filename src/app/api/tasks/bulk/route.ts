import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { bulkAction } from "@/server/modules/tasks/service";
import { taskBulkSchema } from "@/server/validation";

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, taskBulkSchema);
    return ok(await bulkAction(user.id, input));
  });
}