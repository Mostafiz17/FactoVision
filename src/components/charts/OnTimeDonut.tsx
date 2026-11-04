"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTip } from "./shared";

export function OnTimeDonut({ onTime, late, height = 180 }: { onTime: number; late: number; height?: number }) {
  const total = onTime + late;
  if (total === 0) {
    return (
      <div className="flex items-center justify-center text-[12.5px] text-mist-600" style={{ height }}>
        No due-dated completions in this window
      </div>
    );
  }
  const data = [
    { name: "On time", value: onTime },
    { name: "Late", value: late },
  ];
  const rate = Math.round((onTime / total) * 100);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<ChartTip />} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="92%" paddingAngle={3} strokeWidth={0} startAngle={90} endAngle={-270}>
            <Cell fill="#a3e635" />
            <Cell fill="#fb4d6d" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl font-bold" style={{ color: rate >= 85 ? "#a3e635" : rate >= 60 ? "#fbbf24" : "#fb4d6d" }}>
          {rate}%
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-mist-600">on time</span>
      </div>
    </div>
  );
}