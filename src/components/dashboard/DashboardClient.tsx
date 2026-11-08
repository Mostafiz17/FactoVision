"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardDTO, DashboardRiskItem } from "@/lib/dashboard/model";
import { PRIORITIES, PRIORITY_LABEL, type MemberDTO, type ProjectDTO } from "@/lib/domain/types";
import { cn, fmtDate, fmtDays, pct, RISK_HEX } from "@/lib/utils";
import { Button, EmptyState, Select, Skeleton, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { ChartTip } from "@/components/charts/shared";
import { useApp } from "@/components/shell/app-context";
import { ChartFrame } from "./ChartFrame";
import { AiPanel } from "./AiPanel";

export interface DashboardFilters {
  days: number;
  tz: string;
  projectId: string;
  assigneeId: string;
  priority: string;
  label: string;
}

const DAY_OPTIONS = [7, 14, 30, 60, 90];
const BASE_ZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
// Browser time zone is an external value; use the server snapshot during hydration.
const subscribeTimeZone = () => () => {};
const getLocalTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerTimeZone = () => "";
const getClientReady = () => true;
const getServerReady = () => false;
const CONF_CLASS: Record<string, string> = {
  high: "border-lime-400/40 text-lime-300",
  medium: "border-amber-400/40 text-amber-300",
  low: "border-rose-400/40 text-rose-300",
};

function toQuery(workspaceId: string, f: DashboardFilters): string {
  const q = new URLSearchParams({ workspaceId, days: String(f.days), tz: f.tz });
  if (f.projectId) q.set("projectId", f.projectId);
  if (f.assigneeId) q.set("assigneeId", f.assigneeId);
  if (f.priority) q.set("priority", f.priority);
  if (f.label) q.set("label", f.label);
  return q.toString();
}

function rate(v: number | null): string {
  return v === null ? "—" : pct(v);
}

export function DashboardClient({
  workspaceId,
  workspaceName,
  initial,
  initialFilters,
  initialError,
  projects,
  members,
  labels,
}: {
  workspaceId: string;
  workspaceName: string;
  initial: DashboardDTO | null;
  initialFilters: DashboardFilters;
  initialError: string | null;
  projects: ProjectDTO[];
  members: MemberDTO[];
  labels: string[];
}) {
  const { openTask } = useApp();
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<DashboardDTO | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const [previousInitial, setPreviousInitial] = useState(initial);
  if (previousInitial !== initial) {
    setPreviousInitial(initial); setData(initial); setError(initialError); setFilters(initialFilters);
  }
  const localZone = useSyncExternalStore(subscribeTimeZone, getLocalTimeZone, getServerTimeZone);
  const zones = localZone && !BASE_ZONES.includes(localZone) ? [localZone, ...BASE_ZONES] : BASE_ZONES;
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const load = useCallback(
    async (next: DashboardFilters) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      setError(null);
      const qs = toQuery(workspaceId, next);
      try {
        const res = await fetch(`/api/dashboard?${qs}`, { signal: controller.signal });
        const body = (await res.json().catch(() => null)) as { dashboard?: DashboardDTO; error?: string } | null;
        if (!res.ok || !body?.dashboard) throw new Error(body?.error ?? `Request failed (${res.status})`);
        if (controller.signal.aborted) return;
        setData(body.dashboard);
        const url = new URL(window.location.href);
        url.search = qs.replace(/(^|&)workspaceId=[^&]*/, "").replace(/^&/, "");
        window.history.replaceState(null, "", url.toString());
      } catch (e) {
        if (controller.signal.aborted || (e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Could not load the dashboard");
      } finally {
        if (abort.current === controller) setLoading(false);
      }
    },
    [workspaceId],
  );

  const update = (patch: Partial<DashboardFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next);
  };
  const activeFilters = [filters.projectId, filters.assigneeId, filters.priority, filters.label].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-pulse-300">{workspaceName}</p>
          <h1 className="panel-title mt-1 text-2xl font-bold text-mist-100">Mission control</h1>
          {data && (
            <p className="mt-1 text-[12px] text-mist-500">
              {data.window.startDay} → {data.window.endDay} · {data.window.timeZone}
            </p>
          )}
        </div>
        {loading && <span className="flex items-center gap-2 text-[12px] text-pulse-300" role="status"><Spinner size={14} /> Updating…</span>}
      </div>

      {/* Filters — every value is re-validated by /api/dashboard. */}
      <form className="card flex flex-wrap items-end gap-2 p-3" aria-label="Dashboard filters" onSubmit={(e) => e.preventDefault()}>
        <FilterSelect label="Window" value={String(filters.days)} onChange={(v) => update({ days: Number(v) })}
          options={DAY_OPTIONS.map((d) => [String(d), `Last ${d} days`])} />
        <FilterSelect label="Time zone" value={filters.tz} onChange={(v) => update({ tz: v })}
          options={(zones.includes(filters.tz) ? zones : [filters.tz, ...zones]).map((z) => [z, z])} />
        <FilterSelect label="Project" value={filters.projectId} onChange={(v) => update({ projectId: v })}
          options={[["", "All projects"], ...projects.map((p) => [p.id, p.name] as [string, string])]} />
        <FilterSelect label="Assignee" value={filters.assigneeId} onChange={(v) => update({ assigneeId: v })}
          options={[["", "Everyone"], ["none", "Unassigned"], ...members.map((m) => [m.id, m.name] as [string, string])]} />
        <FilterSelect label="Priority" value={filters.priority} onChange={(v) => update({ priority: v })}
          options={[["", "Any priority"], ...PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as [string, string])]} />
        <FilterSelect label="Label" value={filters.label} onChange={(v) => update({ label: v })}
          options={[["", "Any label"], ...labels.map((l) => [l, `#${l}`] as [string, string])]} />
        {activeFilters > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => update({ projectId: "", assigneeId: "", priority: "", label: "" })}>
            <Icon name="x" size={12} /> Clear ({activeFilters})
          </Button>
        )}
      </form>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-200">
          <Icon name="alert" size={16} />
          <span className="flex-1">Dashboard data could not be loaded: {error}</span>
          <Button size="sm" variant="outline" onClick={() => void load(filters)}><Icon name="refresh" size={12} /> Retry</Button>
        </div>
      )}

      {!data ? (
        <DashboardSkeleton />
      ) : (
        <div aria-busy={loading} className={cn("space-y-4 transition-opacity", loading && "opacity-60")}>
          <SummaryCards d={data} />
          {(data.dataQuality.unestimatedOpen > 0 || data.dataQuality.undatedOpen > 0) && (
            <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-200">
              <Icon name="info" size={12} className="mr-1 inline" />
              {data.dataQuality.unestimatedOpen} open task(s) lack an estimate and {data.dataQuality.undatedOpen} lack a due date. Their risk scores
              are shown as ranges; {data.risk.lowConfidence} score(s) have low confidence.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <CompletionTrend d={data} />
            <CycleTrend d={data} />
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <RiskPanel d={data} onOpen={openTask} />
            <WorkloadChart d={data} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ProjectProgress d={data} />
            <OverdueList d={data} onOpen={openTask} />
            <BlockedList d={data} onOpen={openTask} />
          </div>

          <div className="h-[420px]"><AiPanel workspaceId={workspaceId} scope={filters} /></div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  // Explicit label/id pairing: a wrapping <label> would fold every option's text into the accessible name.
  const id = useId();
  const ready = useSyncExternalStore(subscribeTimeZone, getClientReady, getServerReady);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[10.5px] font-semibold uppercase tracking-wider text-mist-500">{label}</label>
      <Select id={id} disabled={!ready} value={value} onChange={(e) => onChange(e.target.value)} className="h-8.5 w-auto min-w-[130px] py-0 text-[12px]">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Loading dashboard…</span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[92px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-[300px]" /><Skeleton className="h-[300px]" /></div>
    </div>
  );
}

function Card({ label, value, sub, icon, color, testId }: { label: string; value: string; sub: string; icon: IconName; color: string; testId: string }) {
  return (
    <div className="card p-3.5" data-testid={testId}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-mist-500">{label}</p>
        <span style={{ color }} aria-hidden="true"><Icon name={icon} size={13} /></span>
      </div>
      <p className="mt-1.5 font-mono text-[22px] font-bold leading-7 text-mist-100" data-testid={`${testId}-value`}>{value}</p>
      <p className="mt-1 text-[10.5px] text-mist-500">{sub}</p>
    </div>
  );
}

function SummaryCards({ d }: { d: DashboardDTO }) {
  const s = d.summary;
  return (
    <section aria-label="Summary metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      <Card testId="kpi-open" label="Open tasks" value={String(s.openTasks)} sub={`${s.activePoints} active pt · ${rate(s.activeCoverage)} of active estimated`} icon="layers" color="#8f76ff" />
      <Card testId="kpi-completed" label="Completed" value={String(s.completed)} sub={`${s.reopened} reopened in window`} icon="check" color="#a3e635" />
      <Card testId="kpi-completion" label="Completion rate" value={rate(s.completionRate)} sub={`of ${s.completionEligible} created in window`} icon="target" color="#22d3ee" />
      <Card testId="kpi-ontime" label="On-time" value={rate(s.onTimeRate)} sub={`${s.onTimeEligible} dated completions`} icon="calendar" color="#fbbf24" />
      <Card testId="kpi-overdue" label="Overdue" value={String(s.overdue)} sub="open past their due date" icon="alert" color="#fb4d6d" />
      <Card testId="kpi-blocked" label="Blocked" value={String(s.blocked)} sub={`${rate(s.blockedShare)} of open tasks`} icon="block" color="#f97316" />
      <Card testId="kpi-cycle" label="Cycle P50" value={s.cycleP50 === null ? "—" : `${fmtDays(s.cycleP50)}d`} sub={`P85 ${fmtDays(s.cycleP85)}d · lead P50 ${fmtDays(s.leadP50)}d`} icon="clock" color="#22d3ee" />
      <Card testId="kpi-risk" label="High risk" value={String(s.highRisk)} sub={`${d.risk.distribution.medium} medium · ${d.risk.distribution.low} low`} icon="shield" color="#fb4d6d" />
    </section>
  );
}

function CompletionTrend({ d }: { d: DashboardDTO }) {
  const rows = d.completionTrend;
  const totals = rows.reduce((a, r) => ({ c: a.c + r.completed, n: a.n + r.created }), { c: 0, n: 0 });
  const empty = rows.every((r) => r.created + r.completed + r.reopened === 0);
  return (
    <ChartFrame
      testId="chart-completion"
      title="Completion trend"
      icon="chart"
      summary={`Weekly (Monday-start). ${totals.c} completed and ${totals.n} created across ${rows.length} week(s); edge weeks may be partial.`}
      empty={empty}
      table={{
        caption: "Weekly created, completed, reopened and net completions",
        columns: ["Week of", "Days", "Created", "Completed", "Reopened", "Net"],
        rows: rows.map((r) => [r.label, r.daysInWindow, r.created, r.completed, r.reopened, r.net]),
      }}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="#1c2947" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#1c2947" }} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(124,92,255,0.07)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="created" name="Created" fill="#4c8dff" fillOpacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Bar dataKey="completed" name="Completed" fill="#8f76ff" radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Bar dataKey="reopened" name="Reopened" fill="#fb4d6d" radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Line dataKey="net" name="Net" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function CycleTrend({ d }: { d: DashboardDTO }) {
  const rows = d.cycleTrend;
  const samples = rows.reduce((a, r) => a + r.count, 0);
  return (
    <ChartFrame
      testId="chart-cycle"
      title="Cycle-time trend"
      icon="clock"
      summary={`Weekly P50 and P85 cycle time (days, nearest rank) over ${samples} completion(s). Weeks without completions are gaps, not zero.`}
      empty={samples === 0}
      emptyText="No completions with a recorded flow start in this window."
      table={{
        caption: "Weekly cycle-time percentiles in days",
        columns: ["Week of", "Samples", "P50 (days)", "P85 (days)"],
        rows: rows.map((r) => [r.label, r.count, r.p50 ?? "—", r.p85 ?? "—"]),
      }}
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="#1c2947" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#1c2947" }} />
          <YAxis tickLine={false} axisLine={false} unit="d" />
          <Tooltip content={<ChartTip suffix="d" />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line dataKey="p50" name="P50" stroke="#a3e635" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          <Line dataKey="p85" name="P85" stroke="#fbbf24" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function WorkloadChart({ d }: { d: DashboardDTO }) {
  const rows = d.workload;
  const capacity = d.risk.capacityPoints;
  return (
    <ChartFrame
      testId="chart-workload"
      className="lg:col-span-5"
      title="Workload distribution"
      icon="users"
      summary={`Estimated points of open work per assignee (active = in progress or review); dashed line = capacity ${capacity} pt. Unestimated tasks count as 0 pt and are listed.`}
      empty={rows.length === 0}
      emptyText="No open tasks for these filters."
      table={{
        caption: "Open work per assignee",
        columns: ["Assignee", "Active pt", "Queued pt", "Active tasks", "Queued tasks", "Unestimated"],
        rows: rows.map((w) => [w.name, w.activePoints, w.queuedPoints, w.activeTasks, w.queuedTasks, w.unestimated]),
      }}
    >
      <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 42 + 40)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#1c2947" strokeDasharray="3 5" horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={{ stroke: "#1c2947" }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={108} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <Tooltip content={<ChartTip suffix=" pt" />} cursor={{ fill: "rgba(124,92,255,0.07)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="activePoints" name="Active" stackId="w" fill="#8f76ff" maxBarSize={16} />
          <Bar dataKey="queuedPoints" name="Queued" stackId="w" fill="#4c8dff" fillOpacity={0.45} maxBarSize={16} radius={[0, 4, 4, 0]} />
          <ReferenceLine x={capacity} stroke="#fbbf24" strokeDasharray="5 4" label={{ value: `capacity ${capacity}`, fill: "#fbbf24", fontSize: 10, position: "insideTopRight" }} />
        </BarChart>
      </ResponsiveContainer>
      {rows.some((w) => w.overCapacity) && (
        <p className="mt-2 text-[11px] text-amber-300">Over capacity: {rows.filter((w) => w.overCapacity).map((w) => w.name).join(", ")}</p>
      )}
    </ChartFrame>
  );
}

/** Inline SVG interval (no chart library): the score dot and its plausible range on 0–100. */
function IntervalBar({ item }: { item: DashboardRiskItem }) {
  const color = RISK_HEX[item.band];
  return (
    <svg viewBox="0 0 100 10" className="h-2.5 w-full" aria-hidden="true" preserveAspectRatio="none">
      <rect x="0" y="4" width="100" height="2" fill="#1c2947" />
      <rect x={item.interval.low} y="2.5" width={Math.max(0.8, item.interval.high - item.interval.low)} height="5" rx="2" fill={color} fillOpacity="0.3" />
      <circle cx={item.score} cy="5" r="3" fill={color} />
    </svg>
  );
}

function RiskPanel({ d, onOpen }: { d: DashboardDTO; onOpen: (id: string) => void }) {
  const r = d.risk;
  const total = r.distribution.low + r.distribution.medium + r.distribution.high;
  return (
    <section className="card p-4 sm:p-5 lg:col-span-7" aria-labelledby="risk-title" data-testid="risk-panel">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 id="risk-title" className="panel-title text-[14px] font-semibold text-mist-100">Deadline risk</h2>
        <span className="text-[10.5px] text-mist-500">Open a task to explore its score and plausible range.</span>
      </div>
      {total === 0 ? (
        <EmptyState icon="shield" title="No open tasks to score" body="Risk applies to open tasks in the filtered population." />
      ) : (
        <>
          <p className="mb-3 text-[12px] text-mist-400">
            <span className="font-semibold text-rose-300">{r.distribution.high} high</span> · <span className="text-amber-300">{r.distribution.medium} medium</span> ·{" "}
            <span className="text-lime-300">{r.distribution.low} low</span> · {r.lowConfidence} low-confidence. Bars show score and plausible range (0–100).
          </p>
          <ol className="space-y-1.5" aria-label="Tasks ranked by risk score">
            {r.items.map((item) => (
              <li key={item.taskId}>
                <button type="button" onClick={() => onOpen(item.taskId)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg border border-transparent px-2 py-2 text-left hover:border-line hover:bg-ink-800"
                  aria-label={`${item.title}: risk ${item.score} (${item.band}), range ${item.interval.low} to ${item.interval.high}, ${item.confidence} confidence`}>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-mist-200">{item.title}</span>
                    <span className="block truncate text-[10.5px] text-mist-500">
                      {item.topFactors.map((f) => `${f.label} +${f.contribution}`).join(" · ") || "No contributing factors"}
                      {item.missingInputs.length > 0 && ` · missing: ${item.missingInputs.join(", ")}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cn("rounded-full border px-1.5 py-px text-[9.5px] font-semibold uppercase", CONF_CLASS[item.confidence])}>{item.confidence} conf.</span>
                    <span className="w-10 text-right font-mono text-[13px] font-bold" style={{ color: RISK_HEX[item.band] }}>{item.score}</span>
                  </span>
                  <span className="col-span-2"><IntervalBar item={item} /></span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function ProjectProgress({ d }: { d: DashboardDTO }) {
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="pp-title" data-testid="project-progress">
      <h2 id="pp-title" className="panel-title mb-3 text-[14px] font-semibold text-mist-100">Project progress</h2>
      {d.projectProgress.length === 0 ? (
        <EmptyState icon="folder" title="No projects" body="Create a project to track progress." />
      ) : (
        <ul className="space-y-3">
          {d.projectProgress.map((p) => (
            <li key={p.projectId}>
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="font-medium text-mist-200">{p.name}</span>
                <span className="font-mono text-[11px] text-mist-400">{p.done}/{p.total} · {rate(p.completionShare)}</span>
              </div>
              <div role="progressbar" aria-label={`${p.name} completion`} aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={p.completionShare === null ? undefined : Math.round(p.completionShare * 100)}
                aria-valuetext={p.completionShare === null ? "No tasks" : `${p.done} of ${p.total} done`}
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full rounded-full" style={{ width: `${(p.completionShare ?? 0) * 100}%`, background: p.color }} />
              </div>
              <p className="mt-1 text-[10.5px] text-mist-500">{p.open} open · {p.overdue} overdue · {p.blocked} blocked</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OverdueList({ d, onOpen }: { d: DashboardDTO; onOpen: (id: string) => void }) {
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="od-title" data-testid="overdue-list">
      <h2 id="od-title" className="panel-title mb-3 text-[14px] font-semibold text-mist-100">Overdue tasks <span className="font-mono text-[11px] text-rose-300">{d.overdueTasks.length}</span></h2>
      {d.overdueTasks.length === 0 ? (
        <EmptyState icon="check" title="Nothing overdue" body="No open task is past its due date." />
      ) : (
        <ul className="max-h-[260px] space-y-1 overflow-y-auto">
          {d.overdueTasks.map((t) => (
            <li key={t.taskId}>
              <button type="button" onClick={() => onOpen(t.taskId)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink-800">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-mist-200">{t.title}</span>
                <span className="text-[10.5px] text-mist-500">{t.assigneeName ?? "Unassigned"}</span>
                <span className="font-mono text-[11px] text-rose-300" title={`Due ${fmtDate(t.dueDate)}`}>{fmtDays(t.daysOverdue)}d late</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BlockedList({ d, onOpen }: { d: DashboardDTO; onOpen: (id: string) => void }) {
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="bl-title" data-testid="blocked-list">
      <h2 id="bl-title" className="panel-title mb-1 text-[14px] font-semibold text-mist-100">Blocked tasks <span className="font-mono text-[11px] text-orange-300">{d.blocked.count}</span></h2>
      <p className="mb-3 text-[11px] text-mist-500">{rate(d.blocked.share)} of open tasks · {d.blocked.points} pt waiting</p>
      {d.blocked.tasks.length === 0 ? (
        <EmptyState icon="link" title="Nothing blocked" body="No open task has an unresolved blocker." />
      ) : (
        <ul className="max-h-[240px] space-y-1.5 overflow-y-auto">
          {d.blocked.tasks.map((t) => (
            <li key={t.taskId} className="rounded-lg border border-line/60 px-2 py-1.5">
              <button type="button" onClick={() => onOpen(t.taskId)} className="flex w-full items-center gap-2 text-left">
                <Icon name="block" size={12} className="text-orange-300" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-mist-200">{t.title}</span>
                <span className="font-mono text-[10.5px] text-mist-400">{t.blockedDays === null ? "duration unknown" : `${fmtDays(t.blockedDays)}d`}</span>
              </button>
              <p className="ml-5 truncate text-[10.5px] text-mist-500">by {t.blockers.map((b) => b.title).join(", ")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
