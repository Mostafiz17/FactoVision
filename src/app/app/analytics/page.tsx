import { AnalyticsClient } from "@/components/analytics/AnalyticsClient";
import { computeAnalytics } from "@/server/modules/analytics/service";
import { requirePageContext } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const { user, workspace } = await requirePageContext();
  if (!workspace) return null;
  const analytics = await computeAnalytics(user.id, workspace.id, 30);
  return <AnalyticsClient initial={analytics} workspaceId={workspace.id} />;
}