import { ProjectsClient } from "@/components/projects/ProjectsClient";
import { listProjects } from "@/server/modules/projects/service";
import { requirePageContext } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { user, workspace } = await requirePageContext();
  if (!workspace) return null;
  const projects = await listProjects(user.id, workspace.id);
  return <ProjectsClient projects={projects} workspaceId={workspace.id} role={workspace.role} />;
}