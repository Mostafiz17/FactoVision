import { assertOrigin, ok, parseBody, route } from "@/server/http";
import { register } from "@/server/modules/auth/service";
import { registerSchema } from "@/server/validation";

export async function POST(req: Request) {
  return route(async () => {
    assertOrigin(req);
    const input = await parseBody(req, registerSchema);
    const user = await register(input);
    return ok({ user }, 201);
  });
}