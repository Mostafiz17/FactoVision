import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { listNotificationPage, setReadState, runDeadlineSweep } from "@/server/modules/collaboration/service";
import { notificationsPatchSchema, notificationsQuerySchema } from "@/server/validation";

export async function GET(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const p = new URL(req.url).searchParams;
    const q = notificationsQuerySchema.parse({
      workspaceId: p.get("workspaceId"),
      cursor: p.get("cursor") ?? undefined,
      limit: p.get("limit") ?? undefined,
      unreadOnly: p.get("unreadOnly") ?? undefined,
    });
    return ok(await listNotificationPage(user.id, q));
  });
}

export async function PATCH(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, notificationsPatchSchema);
    return ok(await setReadState(user.id, input.workspaceId, input.ids, input.read));
  });
}
/** Explicit mutation: GET and server rendering never generate notifications. */
export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { workspaceId } = await parseBody(req, notificationsPatchSchema);
    return ok({ created: await runDeadlineSweep(user.id, workspaceId) });
  });
}
