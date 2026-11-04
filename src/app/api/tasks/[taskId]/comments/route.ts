import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { addComment, listComments } from "@/server/modules/collaboration/service";
import { commentListQuerySchema, commentSchema } from "@/server/validation";

type Ctx = { params: Promise<{ taskId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return route(async () => {
    const user = await requireUser();
    const { taskId } = await ctx.params;
    const params = new URL(req.url).searchParams;
    const page = commentListQuerySchema.parse({
      cursor: params.get("cursor") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    return ok(await listComments(user.id, taskId, page));
  });
}

export async function POST(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { taskId } = await ctx.params;
    const input = await parseBody(req, commentSchema);
    return ok({ comment: await addComment(user.id, taskId, input) }, 201);
  });
}