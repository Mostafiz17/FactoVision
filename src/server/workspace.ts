import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { DbUser } from "@/db/schema";
import type { WorkspaceDTO } from "@/lib/domain/types";
import { getSessionUser } from "@/server/auth/session";
import { listWorkspaces } from "@/server/modules/workspaces/service";

export const WS_COOKIE = "cadence_ws";

export interface PageContext {
  user: DbUser;
  workspaces: WorkspaceDTO[];
  workspace: WorkspaceDTO | null;
}

/** Authoritative page guard: session + active workspace resolution (cookie-validated). */
export async function requirePageContext(): Promise<PageContext> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const workspaces = await listWorkspaces(user.id);
  const jar = await cookies();
  const preferred = jar.get(WS_COOKIE)?.value;
  const workspace = workspaces.find((w) => w.id === preferred) ?? workspaces[0] ?? null;
  return { user, workspaces, workspace };
}