"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icons";
import { Tip } from "@/components/overlays";

export function ChartCard({
  title,
  subtitle,
  icon,
  actions,
  definition,
  children,
  className,
  delay = 0,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  actions?: ReactNode;
  definition?: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section className={cn("card animate-rise min-w-0 p-4 sm:p-5", className)} style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-4 flex flex-wrap items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-pulse-600/15 text-pulse-300">
          <Icon name={icon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="panel-title text-[14px] font-semibold text-mist-100">{title}</h3>
            {definition && (
              <Tip label={definition}>
                <span className="cursor-help rounded bg-ink-700 px-1.5 py-px font-mono text-[9.5px] font-semibold text-mist-400">ƒ</span>
              </Tip>
            )}
          </div>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-mist-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export interface TipRow {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

export function ChartTip({
  active,
  payload,
  label,
  suffix = "",
}: {
  active?: boolean;
  payload?: ReadonlyArray<TipRow>;
  label?: string | number;
  suffix?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-ink-800/95 px-3 py-2 shadow-2xl backdrop-blur">
      {label !== undefined && <p className="mb-1 font-mono text-[10px] text-mist-500">{label}</p>}
      {payload.map((row, i) => (
        <p key={i} className="flex items-center gap-1.5 text-[11.5px] text-mist-300">
          <span className="h-2 w-2 rounded-sm" style={{ background: row.color ?? "#8f76ff" }} />
          {row.name}: <b className="font-mono text-mist-100">{typeof row.value === "number" ? Math.round(row.value * 100) / 100 : row.value}{suffix}</b>
        </p>
      ))}
    </div>
  );
}

export function LegendToggle({
  items,
  hidden,
  onToggle,
}: {
  items: { key: string; label: string; color: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((it) => {
        const off = hidden.has(it.key);
        return (
          <button
            key={it.key}
            onClick={() => onToggle(it.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-medium transition-all",
              off ? "border-line text-mist-600 opacity-60" : "border-transparent text-mist-300",
            )}
            style={off ? undefined : { background: `${it.color}14`, borderColor: `${it.color}35` }}
            aria-pressed={!off}
          >
            <span className="h-2 w-2 rounded-sm" style={{ background: off ? "#4d5a78" : it.color }} />
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
/** Text alternative uses the exact source rows supplied to the chart. */
export function ChartData({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return <details className="mt-3 min-w-0 text-xs text-mist-400"><summary className="cursor-pointer">View chart data</summary><div className="max-h-64 overflow-auto"><table className="w-full text-left"><caption className="sr-only">Chart source data</caption><thead><tr>{columns.map((c) => <th key={c} scope="col" className="p-2">{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="p-2">{c}</td>)}</tr>)}</tbody></table></div></details>;
}
