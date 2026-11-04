import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { createWorkspace, listWorkspaces } from "@/server/modules/workspaces/service";
import { workspaceCreateSchema } from "@/server/validation";

export async function GET() {
  return route(async () => {
    const user = await requireUser();
    return ok({ workspaces: await listWorkspaces(user.id) });
  });
}

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, workspaceCreateSchema);
    return ok({ workspace: await createWorkspace(user.id, input.name) }, 201);
  });
}