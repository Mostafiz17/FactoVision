import { z } from "zod";
import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { createProject, listProjects } from "@/server/modules/projects/service";
import { projectCreateSchema } from "@/server/validation";

export async function GET(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const workspaceId = z.string().uuid().parse(new URL(req.url).searchParams.get("workspaceId"));
    return ok({ projects: await listProjects(user.id, workspaceId) });
  });
}

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, projectCreateSchema);
    return ok({ project: await createProject(user.id, input) }, 201);
  });
}