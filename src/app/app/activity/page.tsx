import { ActivityClient } from "@/components/activity/ActivityClient";
import { listActivityPage } from "@/server/modules/collaboration/service";
import { listProjects } from "@/server/modules/projects/service";
import { listMembers } from "@/server/modules/workspaces/service";
import { requirePageContext } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { user, workspace } = await requirePageContext();
  if (!workspace) return null;
  const { project } = await searchParams;
  const [projects, members] = await Promise.all([listProjects(user.id, workspace.id), listMembers(user.id, workspace.id)]);
  const projectId = projects.some((p) => p.id === project) ? project : undefined;
  const initial = await listActivityPage(user.id, { workspaceId: workspace.id, projectId, limit: 50 });
  return (
    <ActivityClient
      key={projectId ?? "all"}
      initial={initial}
      members={members}
      projects={projects}
      workspaceId={workspace.id}
      initialProjectId={projectId ?? ""}
    />
  );
}