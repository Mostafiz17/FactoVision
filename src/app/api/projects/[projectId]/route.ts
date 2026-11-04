import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { deleteProject, updateProject } from "@/server/modules/projects/service";
import { projectPatchSchema } from "@/server/validation";

type Ctx = { params: Promise<{ projectId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { projectId } = await ctx.params;
    const input = await parseBody(req, projectPatchSchema);
    return ok({ project: await updateProject(user.id, projectId, input) });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { projectId } = await ctx.params;
    await deleteProject(user.id, projectId);
    return ok({ ok: true });
  });
}