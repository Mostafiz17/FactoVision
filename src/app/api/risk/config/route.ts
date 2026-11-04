import { z } from "zod";
import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { getRiskConfig, updateRiskConfig } from "@/server/modules/risk/service";

const querySchema = z.object({ workspaceId: z.string().uuid() });
const putSchema = z.object({
  workspaceId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  config: z.unknown(),
});

/** GET: any member (analytics.read). PUT: admin+ (risk.configure), revision-checked. */
export async function GET(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const q = querySchema.parse({ workspaceId: new URL(req.url).searchParams.get("workspaceId") });
    return ok({ riskConfig: await getRiskConfig(user.id, q.workspaceId) });
  });
}

export async function PUT(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const body = await parseBody(req, putSchema);
    return ok({ riskConfig: await updateRiskConfig(user.id, body.workspaceId, { config: body.config, expectedRevision: body.expectedRevision }) });
  });
}
