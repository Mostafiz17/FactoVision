import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { addDependency, removeDependency } from "@/server/modules/tasks/service";
import { dependencySchema } from "@/server/validation";

type Ctx = { params: Promise<{ taskId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { taskId } = await ctx.params;
    const input = await parseBody(req, dependencySchema);
    await addDependency(user.id, taskId, input.dependsOnId);
    return ok({ ok: true }, 201);
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { taskId } = await ctx.params;
    const input = await parseBody(req, dependencySchema);
    await removeDependency(user.id, taskId, input.dependsOnId);
    return ok({ ok: true });
  });
}