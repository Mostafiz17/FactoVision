"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint } from "@/lib/domain/types";
import { fmtDate } from "@/lib/utils";
import { ChartData, ChartTip, LegendToggle } from "./shared";

export function ThroughputChart({ data, height = 250 }: { data: DailyPoint[]; height?: number }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const rows = useMemo(
    () => data.map((d) => ({ ...d, label: fmtDate(d.date + "T00:00:00Z") })),
    [data],
  );
  const toggle = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <LegendToggle
          items={[
            { key: "completed", label: "Completed", color: "#8f76ff" },
            { key: "created", label: "Created", color: "#4c8dff" },
            { key: "reopened", label: "Reopened", color: "#fb4d6d" },
            { key: "ewma", label: "EWMA λ", color: "#22d3ee" },
          ]}
          hidden={hidden}
          onToggle={toggle}
        />
      </div>
      <ChartData columns={["Day", "Created", "Completed", "Reopened", "Trend"]} rows={data.map((d) => [d.date, d.created, d.completed, d.reopened, d.ewma])} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -26 }} barGap={1}>
          <defs>
            <linearGradient id="tpBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8f76ff" stopOpacity={0.95} />
              <stop offset="1" stopColor="#6a48f2" stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1c2947" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#1c2947" }} minTickGap={28} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(124,92,255,0.07)" }} />
          {!hidden.has("created") && (
            <Bar dataKey="created" name="Created" fill="#4c8dff" fillOpacity={0.28} radius={[3, 3, 0, 0]} maxBarSize={14} />
          )}
          {!hidden.has("completed") && (
            <Bar dataKey="completed" name="Completed" fill="url(#tpBar)" radius={[3, 3, 0, 0]} maxBarSize={14} />
          )}
          {!hidden.has("reopened") && (
            <Bar dataKey="reopened" name="Reopened" fill="#fb4d6d" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={14} />
          )}
          {!hidden.has("ewma") && (
            <Line
              dataKey="ewma"
              name="EWMA λ"
              stroke="#22d3ee"
              strokeWidth={2.2}
              dot={false}
              type="monotone"
              style={{ filter: "drop-shadow(0 0 5px rgba(34,211,238,0.5))" }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}