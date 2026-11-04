import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { LoginClient } from "@/components/auth/LoginClient";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/app");
  return <LoginClient />;
}