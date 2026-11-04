import { BoardClient } from "@/components/board/BoardClient";
import { listMembers, listViews } from "@/server/modules/workspaces/service";
import { listProjects } from "@/server/modules/projects/service";
import { listTaskPage } from "@/server/modules/tasks/service";
import { requirePageContext } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ q?: string; project?: string }> }) {
  const { user, workspace } = await requirePageContext();
  if (!workspace) return null;
  const params = await searchParams;
  const [taskPage, projects, members, views] = await Promise.all([
    listTaskPage(user.id, {
      workspaceId: workspace.id,
      page: 1,
      pageSize: 50,
      q: "",
      sort: "position",
    }),
    listProjects(user.id, workspace.id),
    listMembers(user.id, workspace.id),
    listViews(user.id, workspace.id),
  ]);
  return (
    <BoardClient
      tasks={taskPage.tasks}
      pagination={taskPage.pagination}
      projects={projects}
      members={members}
      views={views}
      workspaceId={workspace.id}
      initialQ={params.q ?? ""}
      initialProjectId={params.project ?? ""}
    />
  );
}