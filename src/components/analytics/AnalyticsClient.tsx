"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { ewmaSeries } from "@/lib/domain/analytics";
import { round } from "@/lib/domain/dates";
import type { AnalyticsDTO } from "@/lib/domain/types";
import { download, fmtDateFull, fmtDays, pct, RISK_HEX } from "@/lib/utils";
import { Button, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ChartCard } from "@/components/charts/shared";
import { ThroughputChart } from "@/components/charts/ThroughputChart";
import { CfdChart } from "@/components/charts/CfdChart";
import { CycleHistogram } from "@/components/charts/CycleHistogram";
import { WorkloadChart } from "@/components/charts/WorkloadChart";
import { OnTimeDonut } from "@/components/charts/OnTimeDonut";
import { RiskQueue } from "@/components/dashboard/RiskQueue";

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="flex items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-1.5">
      <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wider text-mist-500">{label}</span>
      <input
        type="range"
        className="slider w-24"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <span className="w-10 text-right font-mono text-[11.5px] font-bold text-pulse-300">{format(value)}</span>
    </label>
  );
}

function Definition({ title, formula, children }: { title: string; formula: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-ink-900/60 open:bg-ink-900">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-semibold text-mist-300 hover:text-mist-100">
        <span className="rounded bg-pulse-600/15 px-1.5 py-px font-mono text-[10px] text-pulse-300">ƒ</span>
        {title}
        <code className="ml-auto hidden font-mono text-[10.5px] font-normal text-mist-500 sm:block">{formula}</code>
        <Icon name="chevDown" size={13} className="text-mist-600 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-3.5 py-3 text-[12px] leading-5 text-mist-400">{children}</div>
    </details>
  );
}

export function AnalyticsClient({ initial, workspaceId }: { initial: AnalyticsDTO; workspaceId: string }) {
  const [a, setA] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [alpha, setAlpha] = useState(initial.alpha);
  const [bins, setBins] = useState(12);
  const [wipLimit, setWipLimit] = useState(initial.wip.limitPerMember);
  const [pace, setPace] = useState<"p50" | "p85">("p50");

  async function changeWindow(days: number) {
    setLoading(true);
    try {
      const res = await api<{ analytics: AnalyticsDTO }>(`/api/analytics?workspaceId=${workspaceId}&days=${days}`);
      setA(res.analytics);
    } finally {
      setLoading(false);
    }
  }

  const daily = useMemo(
    () => {
      const smooth = ewmaSeries(a.daily.map((d) => d.completed), alpha);
      return a.daily.map((d, i) => ({ ...d, ewma: round(smooth[i] ?? 0, 3) }));
    },
    [a.daily, alpha],
  );
  const cycleValues = useMemo(() => a.cycleSamples.map((s) => s.days), [a.cycleSamples]);
  const workloadWhatIf = useMemo(() => a.workload.map((m) => ({ ...m, overload: m.wip > wipLimit })), [a.workload, wipLimit]);
  const forecastDays = pace === "p50" ? a.forecast.conservativeDays : a.forecast.optimisticDays;
  const forecastRate = pace === "p50" ? a.forecast.p50Daily : a.forecast.p85Daily;

  function exportCsv() {
    const head = "date,created,completed,reopened,ewma";
    const rows = daily.map((d) => `${d.date},${d.created},${d.completed},${d.reopened},${d.ewma}`);
    download(`${BRAND.analyticsExportPrefix}-${a.days}d.csv`, [head, ...rows].join("\n"), "text/csv");
  }
  function exportJson() {
    download(`${BRAND.analyticsExportPrefix}-${a.days}d.json`, JSON.stringify({ ...a, alpha, daily }, null, 2), "application/json");
  }

  const bandTotal = Math.max(1, a.riskDistribution.low + a.riskDistribution.medium + a.riskDistribution.high);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="panel-title text-xl font-bold text-mist-100">Analytics</h1>
          <p className="text-[12px] text-mist-500">
            {fmtDateFull(a.from)} → {fmtDateFull(a.to)} · every number below is a published formula over the event log
          </p>
        </div>
        {loading && <Spinner size={16} className="text-pulse-300" />}
        <Select value={a.days} onChange={(e) => changeWindow(Number(e.target.value))} className="h-8.5 w-auto py-0 text-[12px]" aria-label="Analysis window">
          {[14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </Select>
        <Slider label="EWMA α" value={alpha} min={0.05} max={0.9} step={0.05} onChange={setAlpha} format={(v) => v.toFixed(2)} />
        <Button variant="outline" size="sm" onClick={exportCsv}><Icon name="download" size={13} /> CSV</Button>
        <Button variant="outline" size="sm" onClick={exportJson}><Icon name="download" size={13} /> JSON</Button>
      </div>

      {/* stat strip */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          ["Completed", String(a.totals.completed), "#a3e635"],
          ["Net of rework", String(a.totals.net), "#22d3ee"],
          ["Reopened", String(a.totals.reopened), "#fb4d6d"],
          ["Created", String(a.totals.created), "#4c8dff"],
          ["Lead P50", `${fmtDays(a.lead.p50)}d`, "#e879f9"],
          ["Samples", String(a.cycle.count), "#fbbf24"],
        ].map(([label, v, color], i) => (
          <div key={label} className="card animate-rise px-3 py-2.5" style={{ animationDelay: `${i * 40}ms` }}>
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-mist-600">{label}</p>
            <p className="mt-0.5 font-mono text-lg font-bold" style={{ color }}>{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard className="lg:col-span-8" title="Throughput" subtitle={`λₜ = α·xₜ + (1−α)·λₜ₋₁ with α = ${alpha.toFixed(2)} — drag the slider to feel the smoothing`} icon="chart"
          definition="Completed events per UTC day. EWMA reacts to recent days at rate α; small α = smoother, large α = twitchier.">
          <ThroughputChart data={daily} />
        </ChartCard>

        <ChartCard className="lg:col-span-4" title="Clearance forecast" subtitle="Empirical percentile pace — switch the pace to compare" icon="pulse"
          definition="Days to clear backlog B at q50 or q85 of daily completions (zero days included). ∞ means the chosen percentile pace is 0.">
          <div className="mb-3 flex rounded-lg border border-line bg-ink-900 p-0.5">
            {(["p50", "p85"] as const).map((p) => (
              <button key={p} onClick={() => setPace(p)}
                className={`flex-1 rounded-md py-1.5 font-mono text-[11.5px] font-bold uppercase transition-all ${pace === p ? (p === "p50" ? "bg-cyan-400/20 text-cyan-300" : "bg-lime-400/20 text-lime-300") : "text-mist-500 hover:text-mist-300"}`}>
                {p === "p50" ? "Conservative · q50" : "Optimistic · q85"}
              </button>
            ))}
          </div>
          <p className="font-mono text-4xl font-bold" style={{ color: pace === "p50" ? "#22d3ee" : "#a3e635" }}>
            {fmtDays(forecastDays)}<span className="text-base text-mist-500"> days</span>
          </p>
          <div className="mt-3 space-y-1.5 rounded-xl border border-line bg-ink-900/70 p-3 font-mono text-[11.5px] text-mist-400">
            <p>B = {a.forecast.backlog} open</p>
            <p>q({pace}) = {forecastRate}/day</p>
            <p>{a.forecast.backlog} ÷ {forecastRate || 0} = {fmtDays(forecastDays)}</p>
          </div>
          {a.forecast.backlog > 0 && !Number.isFinite(forecastDays) && (
            <p className="mt-2 text-[11px] leading-4 text-amber-300">This percentile of daily throughput is zero — the model refuses to invent a date.</p>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Cumulative flow diagram" subtitle="End-of-day status occupancy reconstructed from transition events — widening active bands mean WIP is growing" icon="layers" delay={80}
        definition="Bands sum to live task count per day. A reopen visibly moves work out of Done and back into In progress.">
        <CfdChart data={a.cfd} height={300} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard className="lg:col-span-7" title="Cycle time distribution" subtitle={`${a.cycle.count} completions with a start timestamp in window`} icon="clock" delay={120}
          definition="Cycle time = completedAt − startedAt, in days, for tasks currently completed within the window."
          actions={<Slider label="Bins" value={bins} min={5} max={24} step={1} onChange={setBins} format={(v) => String(v)} />}>
          <CycleHistogram values={cycleValues} p50={a.cycle.p50} p85={a.cycle.p85} bins={bins} />
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {[["mean", a.cycle.mean], ["P50", a.cycle.p50], ["P85", a.cycle.p85], ["min", a.cycle.min], ["max", a.cycle.max]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border border-line bg-ink-900/70 px-2.5 py-2 text-center">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-mist-600">{l}</p>
                <p className="font-mono text-[13.5px] font-bold text-mist-100">{fmtDays(v as number)}d</p>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard className="lg:col-span-5" title="Delivery reliability" subtitle="Due-dated completions only — undated work is excluded and disclosed" icon="target" delay={160}
          definition="On-time = completedAt ≤ dueDate. Rate = onTime ÷ (onTime + late).">
          <div className="grid grid-cols-2 items-center gap-3">
            <OnTimeDonut onTime={a.onTime.onTime} late={a.onTime.late} height={170} />
            <div className="space-y-2">
              <div className="rounded-lg border border-lime-400/25 bg-lime-400/8 px-3 py-2">
                <p className="font-mono text-lg font-bold text-lime-300">{a.onTime.onTime}</p>
                <p className="text-[10px] uppercase tracking-wider text-mist-500">on time</p>
              </div>
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2">
                <p className="font-mono text-lg font-bold text-rose-300">{a.onTime.late}</p>
                <p className="text-[10px] uppercase tracking-wider text-mist-500">late</p>
              </div>
              <p className="font-mono text-[10.5px] text-mist-600">rate = {a.onTime.rate !== null ? pct(a.onTime.rate) : "n/a"}</p>
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard className="lg:col-span-6" title="Team workload" subtitle="What-if WIP limit — move the stepper to re-flag overload without touching the server" icon="users" delay={200}
          definition="WIP per member = tasks in In progress + Review. Overload when WIP > limit. Completed counts tasks finished in the window."
          actions={
            <div className="flex items-center gap-1 rounded-lg border border-line bg-ink-850 px-2 py-1">
              <span className="text-[10px] font-semibold uppercase text-mist-500">limit</span>
              <button className="rounded p-0.5 text-mist-400 hover:text-white" onClick={() => setWipLimit((v) => Math.max(1, v - 1))} aria-label="Decrease WIP limit"><Icon name="down" size={11} /></button>
              <span className="w-5 text-center font-mono text-[12px] font-bold text-amber-300">{wipLimit}</span>
              <button className="rounded p-0.5 text-mist-400 hover:text-white" onClick={() => setWipLimit((v) => Math.min(10, v + 1))} aria-label="Increase WIP limit"><Icon name="up" size={11} /></button>
            </div>
          }>
          <WorkloadChart workload={workloadWhatIf} wipLimit={wipLimit} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {workloadWhatIf.map((m) => (
              <span key={m.userId} className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${m.overload ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-line text-mist-400"}`}>
                {m.name.split(" ")[0]}: {m.wip} WIP · {m.active} active{m.overload && " ⚠"}
              </span>
            ))}
          </div>
        </ChartCard>

        <ChartCard className="lg:col-span-6" title="Risk model & queue" subtitle={`Risk model v${a.riskModel.version} · config rev ${a.riskModel.revision} · score with uncertainty interval · open any task for its breakdown`} icon="shield" delay={240}
          definition="Four weighted factors: schedule pressure (remaining effort vs time available), blocked duration, unresolved dependencies, assignee workload. Missing inputs widen the interval. Weights and bands are configured per workspace in Settings.">
          <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full border border-line">
            {(["low", "medium", "high"] as const).map((b) => (
              <div key={b} className="h-full transition-all duration-500" style={{ width: `${(a.riskDistribution[b] / bandTotal) * 100}%`, background: RISK_HEX[b] }} title={`${b}: ${a.riskDistribution[b]}`} />
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-mist-500">
            {(["low", "medium", "high"] as const).map((b) => (
              <span key={b} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: RISK_HEX[b] }} /> {b}: <b className="font-mono text-mist-200">{a.riskDistribution[b]}</b>
              </span>
            ))}
            {a.cycleFallbackUsed && <span className="text-amber-300">P85 fallback = 5d (&lt;3 samples)</span>}
          </div>
          <RiskQueue items={a.riskQueue} />
        </ChartCard>
      </div>

      {/* definitions */}
      <section className="card animate-rise p-4 sm:p-5" style={{ animationDelay: "280ms" }}>
        <h3 className="panel-title mb-3 text-[14px] font-semibold text-mist-100">Metric definitions — the contract</h3>
        <div className="space-y-2">
          <Definition title="Throughput & net throughput" formula="X(d) = completed(d); net = ΣX − Σreopens">
            Counts <b>completed</b> events per UTC day (window: {a.days} days). Reopens are counted separately and subtracted for net throughput
            ({a.totals.completed} − {a.totals.reopened} = {a.totals.net}). Nothing is silently discarded.
          </Definition>
          <Definition title="Cycle & lead time percentiles" formula="nearest-rank: idx = ⌈p/100·n⌉">
            Cycle = completedAt − startedAt; lead = completedAt − createdAt. Sample: tasks currently completed in window (n={a.cycle.count}).
            P50 = {fmtDays(a.cycle.p50)}d, P85 = {fmtDays(a.cycle.p85)}d. Percentiles use the nearest-rank method on the sorted sample.
          </Definition>
          <Definition title="EWMA trend" formula="λₜ = α·xₜ + (1−α)·λₜ₋₁, λ₀ = x₀">
            α = {alpha.toFixed(2)} right now. The final λ is {daily.length > 0 ? daily[daily.length - 1].ewma : 0}/day. The slider recomputes the
            exact same pure function the server uses — no separate client math.
          </Definition>
          <Definition title="Forecast" formula="days = B / q, q ∈ {q50, q85}">
            B = {a.forecast.backlog} open tasks. q50 = {a.forecast.p50Daily}/day, q85 = {a.forecast.p85Daily}/day, computed over all {a.days} days
            including zero-throughput days. A zero pace yields ∞, never a fabricated date.
          </Definition>
          <Definition title="Deadline risk score" formula="S = Σ 100·wᵢ·fᵢ, fᵢ ∈ [0,1]">
            Model v{a.riskModel.version}, configuration revision {a.riskModel.revision}. Each factor value is in [0,1] with a range; missing
            inputs use a neutral assumption and widen the score interval. Contributions sum to the score. Full definitions: RISK.md.
          </Definition>
        </div>
      </section>
    </div>
  );
}
