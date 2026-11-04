import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { publicUser } from "@/server/modules/auth/service";
import { listWorkspaces } from "@/server/modules/workspaces/service";

export async function GET() {
  return route(async () => {
    const user = await requireUser();
    const workspaces = await listWorkspaces(user.id);
    return ok({ user: publicUser(user), workspaces });
  });
}