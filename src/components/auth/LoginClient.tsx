"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Avatar, Button, FieldLabel, Input, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

const DEMO_USERS = [
  { name: "Ava Chen", email: "ava@cadence.dev", hue: 258, role: "Owner" },
  { name: "Noah Park", email: "noah@cadence.dev", hue: 190, role: "Admin" },
  { name: "Mira Solis", email: "mira@cadence.dev", hue: 320, role: "Project manager" },
];


export function LoginClient({ demoEnabled = false }: { demoEnabled?: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doLogin(mail: string, pass: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", "POST", { email: mail, password: pass });
      push({ title: "Welcome back", description: "Session established — loading your workspace.", tone: "success" });
      router.push("/app");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await doLogin(email, password);
        return;
      }
      await api("/api/auth/register", "POST", {
        email,
        password,
        name,
        workspaceName: workspaceName || undefined,
      });
      push({ title: "Workspace created", description: "Your account and first workspace are ready.", tone: "success" });
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-stretch">
      {/* Brand panel */}
      <section className="relative hidden w-[46%] flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex">
        <div className="animate-rise flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pulse-400 to-pulse-700 text-white shadow-glow">
            <Icon name="pulse" size={20} />
          </span>
          <div>
            <p className="panel-title text-lg font-bold leading-5">{BRAND.name}</p>
            <p className="mt-0.5 text-[11px] font-medium tracking-wide text-mist-500">{BRAND.attribution}</p>
          </div>
        </div>

        <div className="max-w-lg">
          <h1 className="panel-title animate-rise text-4xl font-bold leading-[1.12]" style={{ animationDelay: "80ms" }}>
            See Progress.
            <br />
            <span className="bg-gradient-to-r from-pulse-300 via-cyan-300 to-lime-300 bg-clip-text text-transparent">Build Better.</span>
          </h1>
          <p className="animate-rise mt-4 text-[15px] leading-6 text-mist-400" style={{ animationDelay: "160ms" }}>
            Every metric is a published formula. Every risk score shows its work. Task history becomes
            throughput, cycle-time percentiles, and forecasts you can defend in a room full of skeptics.
          </p>

          <div className="animate-rise mt-8 grid grid-cols-2 gap-3" style={{ animationDelay: "240ms" }}>
            <div className="card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-mist-500">Cycle time</p>
              <p className="mt-2 font-mono text-[13px] text-mist-300">Time from starting work to completion</p>
              <p className="mt-2 text-[11.5px] leading-4 text-mist-500">P50 and P85 by nearest rank over the window. Empty windows show “—”, never zero.</p>
            </div>
            <div className="card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-mist-500">Deadline risk</p>
              <p className="mt-2 font-mono text-[13px] text-mist-300">Understand what puts deadlines at risk</p>
              <p className="mt-2 text-[11.5px] leading-4 text-mist-500">Four factors, weights sum to 1. Every score shows its breakdown.</p>
            </div>
          </div>

          <div className="animate-rise mt-6 flex flex-wrap gap-2" style={{ animationDelay: "320ms" }}>
            {["Delivery trends", "Cycle-time percentiles", "Explainable risk", "Clearance forecasts"].map((f) => (
              <code key={f} className="rounded-lg border border-line bg-ink-850 px-2.5 py-1 font-mono text-[11px] text-pulse-300">
                {f}
              </code>
            ))}
          </div>
        </div>

        <p className="text-xs text-mist-600">Deterministic analytics first · AI strictly optional · Tenant-isolated workspaces</p>
      </section>

      {/* Form panel */}
      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm animate-rise">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-pulse-400 to-pulse-700 text-white">
              <Icon name="pulse" size={18} />
            </span>
            <div>
              <p className="panel-title text-lg font-bold">{BRAND.name}</p>
              <p className="text-[11px] text-mist-500">{BRAND.attribution}</p>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 rounded-xl border border-line bg-ink-850 p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cn(
                  "rounded-lg py-2 text-sm font-semibold transition-all",
                  mode === m ? "bg-gradient-to-b from-pulse-400 to-pulse-600 text-white shadow-glow" : "text-mist-400 hover:text-mist-200",
                )}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <FieldLabel htmlFor="loginclient-1">Your name</FieldLabel>
                <Input id="loginclient-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" required maxLength={80} />
              </div>
            )}
            <div>
              <FieldLabel htmlFor="loginclient-2">Email</FieldLabel>
              <Input id="loginclient-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@team.dev" required autoComplete="email" />
            </div>
            <div>
              <FieldLabel htmlFor="loginclient-3">Password</FieldLabel>
              <Input id="loginclient-3"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "8+ characters" : "••••••••"}
                required
                minLength={mode === "register" ? 8 : 1}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </div>
            {mode === "register" && (
              <div>
                <FieldLabel htmlFor="loginclient-4">Workspace name <span className="normal-case text-mist-600">(optional)</span></FieldLabel>
                <Input id="loginclient-4" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Nova Product Lab" maxLength={80} />
              </div>
            )}
            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300" role="alert">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner size={15} /> : <Icon name={mode === "login" ? "logout" : "plus"} size={15} className={mode === "login" ? "rotate-180" : ""} />}
              {mode === "login" ? "Sign in" : "Create workspace"}
            </Button>
          </form>

          {demoEnabled && <div className="mt-8">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-600">Explore the demo</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="space-y-2">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  disabled={busy}
                  onClick={() => doLogin(u.email, "demo1234")}
                  className="card card-hover flex w-full items-center gap-3 p-3 text-left disabled:opacity-50"
                >
                  <Avatar name={u.name} hue={u.hue} size={32} />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-mist-100">{u.name}</span>
                    <span className="block text-[11px] text-mist-500">{u.role} · Nova Product Lab · 60 days of history</span>
                  </span>
                  <Icon name="chevRight" size={15} className="text-mist-600" />
                </button>
              ))}
            </div>
            <p className="mt-3 text-center font-mono text-[11px] text-mist-600">demo password: demo1234</p>
          </div>}
        </div>
      </section>
    </main>
  );
}
