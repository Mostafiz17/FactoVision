import { listTaskLabels } from "@/server/modules/tasks/service";
import { DashboardClient, type DashboardFilters } from "@/components/dashboard/DashboardClient";
import type { DashboardDTO } from "@/lib/dashboard/model";
import { getDashboard } from "@/server/modules/dashboard/service";
import { listProjects } from "@/server/modules/projects/service";
import { listMembers } from "@/server/modules/workspaces/service";
import { ApiError } from "@/server/http";
import { analyticsReportQuerySchema } from "@/server/validation";
import { requirePageContext } from "@/server/workspace";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: Search }) {
  const { user, workspace } = await requirePageContext();
  if (!workspace) return null;
  const sp = await searchParams;
  // URL filters go through the same schema as the API; invalid values fall back to defaults.
  const parsed = analyticsReportQuerySchema.safeParse({
    workspaceId: workspace.id,
    days: one(sp.days) ?? 30,
    tz: one(sp.tz) ?? undefined,
    projectId: one(sp.projectId) || undefined,
    assigneeId: one(sp.assigneeId) || undefined,
    priority: one(sp.priority) || undefined,
    label: one(sp.label) || undefined,
  });
  const q = parsed.success ? parsed.data : analyticsReportQuerySchema.parse({ workspaceId: workspace.id });
  const filters: DashboardFilters = {
    days: q.days,
    tz: q.tz,
    projectId: q.projectId ?? "",
    assigneeId: q.assigneeId ?? "",
    priority: q.priority ?? "",
    label: q.label ?? "",
  };
  const [projects, members, labelRows] = await Promise.all([
    listProjects(user.id, workspace.id),
    listMembers(user.id, workspace.id),
    listTaskLabels(user.id, workspace.id),
  ]);
  let initial: DashboardDTO | null = null;
  let initialError: string | null = parsed.success ? null : "Some URL filters were invalid and have been reset.";
  try {
    initial = await getDashboard(user.id, workspace.id, {
      days: q.days,
      timeZone: q.tz,
      filters: { projectId: q.projectId, assigneeId: q.assigneeId, priority: q.priority, label: q.label },
    });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    initialError = e.message;
  }
  return (
    <DashboardClient
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      initial={initial}
      initialFilters={filters}
      initialError={initialError}
      projects={projects}
      members={members}
      labels={labelRows}
    />
  );
}
