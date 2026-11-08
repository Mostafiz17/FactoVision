import { z } from "zod";
import { requireUser } from "@/server/auth/guard";
import { changePassword } from "@/server/auth/credentials";
import { assertOrigin, ok, parseBody, route } from "@/server/http";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) });
export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const user = await requireUser();
    const input = await parseBody(req, schema);
    await changePassword(user.id, input.currentPassword, input.newPassword);
    return ok({ ok: true });
  });
}
