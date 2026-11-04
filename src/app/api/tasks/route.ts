import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { createTask, listTaskPage } from "@/server/modules/tasks/service";
import { taskCreateSchema, taskListQuerySchema } from "@/server/validation";

export async function GET(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;
    const input = taskListQuerySchema.parse({
      workspaceId: params.get("workspaceId"),
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
      q: params.get("q") ?? "",
      projectId: params.get("projectId") ?? undefined,
      status: params.get("status") ?? undefined,
      priority: params.get("priority") ?? undefined,
      assigneeId: params.get("assigneeId") ?? undefined,
      label: params.get("label") ?? undefined,
      sort: params.get("sort") ?? undefined,
    });
    return ok(await listTaskPage(user.id, input));
  });
}

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, taskCreateSchema);
    return ok({ task: await createTask(user.id, input) }, 201);
  });
}