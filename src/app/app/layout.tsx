import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { listNotificationPage } from "@/server/modules/collaboration/service";
import { requirePageContext } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, workspaces, workspace } = await requirePageContext();
  const notifications = workspace
    ? await listNotificationPage(user.id, { workspaceId: workspace.id, limit: 20, unreadOnly: false })
    : { items: [], nextCursor: null, unreadCount: 0 };
  return (
    <AppShell
      key={workspace?.id ?? "none"}
      user={{ id: user.id, name: user.name, email: user.email, avatarHue: user.avatarHue }}
      workspaces={workspaces}
      workspace={workspace}
      notifications={notifications}
    >
      {children}
    </AppShell>
  );
}