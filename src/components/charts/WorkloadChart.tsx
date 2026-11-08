"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MemberLoad } from "@/lib/domain/types";
import { ChartData, ChartTip } from "./shared";

export function WorkloadChart({ workload, wipLimit, height = 220 }: { workload: MemberLoad[]; wipLimit: number; height?: number }) {
  const rows = workload.map((m) => ({
    name: m.name.split(" ")[0],
    "In flight (WIP)": m.wip,
    "Completed in window": m.completed,
  }));
  return (
    <><ChartData columns={["Member", "In flight", "Completed"]} rows={workload.map((m) => [m.name, m.wip, m.completed])} /><ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: -6 }} barGap={3}>
        <CartesianGrid stroke="#1c2947" strokeDasharray="3 5" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={{ stroke: "#1c2947" }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={64} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(124,92,255,0.07)" }} />
        <ReferenceLine x={wipLimit} stroke="#fbbf24" strokeDasharray="5 4" label={{ value: `WIP limit ${wipLimit}`, fill: "#fbbf24", fontSize: 10, position: "insideTopRight" }} />
        <Bar dataKey="In flight (WIP)" fill="#8f76ff" radius={[0, 4, 4, 0]} maxBarSize={12} />
        <Bar dataKey="Completed in window" fill="#a3e635" fillOpacity={0.8} radius={[0, 4, 4, 0]} maxBarSize={12} />
      </BarChart>
    </ResponsiveContainer></>
  );
}