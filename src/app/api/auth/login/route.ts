import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { clientAddress } from "@/server/auth/limits";
import { login } from "@/server/modules/auth/service";
import { loginSchema } from "@/server/validation";

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const input = await parseBody(req, loginSchema);
    const ip = clientAddress(req);
    const user = await login(input, ip);
    return ok({ user });
  });
}