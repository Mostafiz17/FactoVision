import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { renameWorkspace } from "@/server/modules/workspaces/service";
import { workspacePatchSchema } from "@/server/validation";

export async function PATCH(req: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const input = await parseBody(req, workspacePatchSchema);
    await renameWorkspace(user.id, workspaceId, input.name);
    return ok({ ok: true });
  });
}