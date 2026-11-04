import { assertOrigin, ok, route } from "@/server/http";
import { logout } from "@/server/modules/auth/service";

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    await logout();
    return ok({ ok: true });
  });
}