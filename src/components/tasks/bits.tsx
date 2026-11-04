"use client";

import type { Priority, RiskBand, TaskStatus } from "@/lib/domain/types";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/domain/types";
import { cn, dueLabel, PRIORITY_HEX, RISK_HEX, STATUS_HEX } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge color={STATUS_HEX[status]} dot>{STATUS_LABEL[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: PRIORITY_HEX[priority] }}>
      <Icon name={priority === "urgent" ? "zap" : priority === "high" ? "up" : priority === "low" ? "down" : "chevRight"} size={11} />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function RiskPill({ score, band, size = "sm" }: { score: number; band: RiskBand; size?: "sm" | "lg" }) {
  const color = RISK_HEX[band];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-mono font-semibold",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
      )}
      style={{ color, borderColor: `${color}45`, background: `${color}12` }}
      title={`Deadline risk ${score}/100 (${band})`}
    >
      <Icon name="target" size={size === "sm" ? 10 : 12} />
      {Math.round(score)}
    </span>
  );
}

export function DueChip({ iso, done }: { iso: string | null; done?: boolean }) {
  const d = dueLabel(iso);
  if (d.tone === "none") return null;
  const color = done ? "#6d7a99" : d.tone === "overdue" ? "#fb4d6d" : d.tone === "soon" ? "#fbbf24" : "#93a1bc";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10.5px]" style={{ color }}>
      <Icon name="calendar" size={10} />
      {done && iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.text}
    </span>
  );
}

export function TagChip({ tag }: { tag: string }) {
  return (
    <span className="rounded border border-line bg-ink-800 px-1.5 py-px font-mono text-[10px] text-mist-400">
      #{tag}
    </span>
  );
}