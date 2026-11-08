"use client";

import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";
import type { CfdPoint } from "@/lib/domain/types";
import { STATUS_HEX } from "@/lib/utils";
import { ChartData, LegendToggle } from "./shared";

type Band = "backlog" | "todo" | "in_progress" | "review" | "done";
const BANDS: { key: Band; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

/** Custom D3 cumulative-flow-style area chart: end-of-day occupancy per status. */
export function CfdChart({ data, height = 260 }: { data: CfdPoint[]; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(280, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || data.length === 0) return;
    const keys = BANDS.filter((b) => !hidden.has(b.key)).map((b) => b.key);
    const margin = { top: 12, right: 10, bottom: 24, left: 34 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const dates = data.map((d) => new Date(d.date + "T00:00:00Z"));
    const x = d3.scaleTime().domain(d3.extent(dates) as [Date, Date]).range([0, w]);
    const maxY = d3.max(data, (d) => keys.reduce((a, k) => a + d[k], 0)) ?? 1;
    const y = d3.scaleLinear().domain([0, Math.max(1, maxY)]).nice().range([h, 0]);

    const stack = d3.stack<CfdPoint>().keys(keys)(data);
    const area = d3
      .area<d3.SeriesPoint<CfdPoint>>()
      .x((d) => x(new Date(d.data.date + "T00:00:00Z")))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX);

    g.append("g")
      .selectAll("path")
      .data(stack)
      .join("path")
      .attr("d", area)
      .attr("fill", (s) => STATUS_HEX[s.key as Band])
      .attr("fill-opacity", 0.38)
      .attr("stroke", (s) => STATUS_HEX[s.key as Band])
      .attr("stroke-width", 1.4)
      .attr("stroke-opacity", 0.9);

    const xAxis = d3.axisBottom<Date>(x).ticks(Math.min(7, data.length)).tickFormat(d3.timeFormat("%b %d")).tickSize(4);
    const yAxis = d3.axisLeft(y).ticks(4).tickSize(-w).tickPadding(8);
    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(xAxis)
      .call((sel) => sel.select(".domain").attr("stroke", "#1c2947"))
      .call((sel) => sel.selectAll("text").attr("fill", "#8c9ab8").style("font-family", "JetBrains Mono, monospace").style("font-size", "9.5px"))
      .call((sel) => sel.selectAll("line").attr("stroke", "#1c2947"));
    g.append("g")
      .call(yAxis)
      .call((sel) => sel.select(".domain").remove())
      .call((sel) => sel.selectAll("text").attr("fill", "#8c9ab8").style("font-family", "JetBrains Mono, monospace").style("font-size", "9.5px"))
      .call((sel) => sel.selectAll("line").attr("stroke", "#1c2947").attr("stroke-dasharray", "2 5"));

    const cursor = g.append("line").attr("y1", 0).attr("y2", h).attr("stroke", "#8f76ff").attr("stroke-width", 1).attr("stroke-dasharray", "3 3").style("opacity", 0);
    const bisect = d3.bisector<Date, Date>((d) => d).center;
    const tip = tipRef.current;

    g.append("rect")
      .attr("width", w)
      .attr("height", h)
      .attr("fill", "transparent")
      .on("mousemove", (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const idx = Math.max(0, Math.min(data.length - 1, bisect(dates, x.invert(mx))));
        const px = x(dates[idx]);
        cursor.attr("x1", px).attr("x2", px).style("opacity", 1);
        if (tip) {
          const d = data[idx];
          tip.style.opacity = "1";
          tip.style.left = `${Math.min(width - 150, margin.left + px + 10)}px`;
          tip.style.top = `${margin.top + 6}px`;
          tip.innerHTML =
            `<p style="font-family:JetBrains Mono,monospace;font-size:10px;color:#8c9ab8;margin-bottom:3px">${d.date}</p>` +
            keys
              .map(
                (k) =>
                  `<p style="display:flex;align-items:center;gap:5px;font-size:11px;color:#c0cbe3"><span style="width:7px;height:7px;border-radius:2px;background:${STATUS_HEX[k]}"></span>${BANDS.find((b) => b.key === k)?.label}: <b style="font-family:JetBrains Mono,monospace;color:#eef2fb">${d[k]}</b></p>`,
              )
              .join("");
        }
      })
      .on("mouseleave", () => {
        cursor.style("opacity", 0);
        if (tip) tip.style.opacity = "0";
      });
  }, [data, width, height, hidden]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="mb-2 flex justify-end">
        <LegendToggle
          items={BANDS.map((b) => ({ key: b.key, label: b.label, color: STATUS_HEX[b.key] }))}
          hidden={hidden}
          onToggle={(k) =>
            setHidden((prev) => {
              const next = new Set(prev);
              if (next.has(k)) next.delete(k);
              else next.add(k);
              return next;
            })
          }
        />
      </div>
      <ChartData columns={["Day", ...BANDS.map((b) => b.label)]} rows={data.map((d) => [d.date, ...BANDS.map((b) => d[b.key])])} />
      <svg ref={svgRef} className="w-full" style={{ height }} role="img" aria-label="Cumulative flow diagram" />
      <div
        ref={tipRef}
        className="pointer-events-none absolute z-10 rounded-lg border border-line bg-ink-800/95 px-3 py-2 opacity-0 shadow-2xl backdrop-blur transition-opacity"
      />
    </div>
  );
}