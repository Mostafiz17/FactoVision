import { z } from "zod";
import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { createView, deleteView, listViews } from "@/server/modules/workspaces/service";
import { viewCreateSchema, viewDeleteSchema } from "@/server/validation";

export async function GET(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const workspaceId = z.string().uuid().parse(new URL(req.url).searchParams.get("workspaceId"));
    return ok({ views: await listViews(user.id, workspaceId) });
  });
}

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, viewCreateSchema);
    return ok({ view: await createView(user.id, input.workspaceId, input.name, input.config) }, 201);
  });
}

export async function DELETE(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, viewDeleteSchema);
    await deleteView(user.id, input.workspaceId, input.id);
    return ok({ ok: true });
  });
}