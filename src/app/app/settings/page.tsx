import { SettingsClient } from "@/components/settings/SettingsClient";
import { listMembers } from "@/server/modules/workspaces/service";
import { requirePageContext } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, workspace } = await requirePageContext();
  if (!workspace) return null;
  const members = await listMembers(user.id, workspace.id);
  return <SettingsClient workspace={workspace} members={members} currentUserId={user.id} />;
}