import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await (await getDatabase()).command({ ping: 1 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
