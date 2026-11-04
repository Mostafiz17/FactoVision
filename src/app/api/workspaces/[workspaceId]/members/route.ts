import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import {
  changeMemberRole,
  inviteMember,
  listMembers,
  removeMember,
} from "@/server/modules/workspaces/service";
import { memberInviteSchema, memberPatchSchema, memberRemoveSchema } from "@/server/validation";

type Ctx = { params: Promise<{ workspaceId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return route(async () => {
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    return ok({ members: await listMembers(user.id, workspaceId) });
  });
}

export async function POST(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const input = await parseBody(req, memberInviteSchema);
    return ok(await inviteMember(user.id, workspaceId, input), 201);
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const input = await parseBody(req, memberPatchSchema);
    await changeMemberRole(user.id, workspaceId, input.userId, input.role);
    return ok({ ok: true });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const input = await parseBody(req, memberRemoveSchema);
    await removeMember(user.id, workspaceId, input.userId);
    return ok({ ok: true });
  });
}