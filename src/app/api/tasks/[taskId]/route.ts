import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { deleteTask, getTaskDetail, updateTask } from "@/server/modules/tasks/service";
import { taskDeleteSchema, taskPatchSchema } from "@/server/validation";

type Ctx = { params: Promise<{ taskId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return route(async () => {
    const user = await requireUser();
    const { taskId } = await ctx.params;
    return ok({ task: await getTaskDetail(user.id, taskId) });
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { taskId } = await ctx.params;
    const input = await parseBody(req, taskPatchSchema);
    return ok({ task: await updateTask(user.id, taskId, input) });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { taskId } = await ctx.params;
    const input = await parseBody(req, taskDeleteSchema);
    return ok({ ok: true, ...(await deleteTask(user.id, taskId, input)) });
  });
}