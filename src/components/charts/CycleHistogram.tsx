"use client";

import { ChartData } from "./shared";
import * as d3 from "d3";
// The production bundler can drop this prototype extension from the d3 barrel.
import "d3-transition";
import { useEffect, useRef, useState } from "react";

/** Custom D3 histogram of cycle times with P50 / P85 markers. */
export function CycleHistogram({
  values,
  p50,
  p85,
  bins,
  height = 230,
}: {
  values: number[];
  p50: number | null;
  p85: number | null;
  bins: number;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

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
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    if (values.length === 0) {
      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#8c9ab8")
        .style("font-size", "12px")
        .text("No completions in this window yet");
      return;
    }
    const margin = { top: 20, right: 10, bottom: 24, left: 30 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const maxV = Math.max(1, d3.max(values) ?? 1);
    const x = d3.scaleLinear().domain([0, Math.ceil(maxV)]).range([0, w]);
    const histogram = d3.bin<number, number>().domain(x.domain() as [number, number]).thresholds(x.ticks(bins));
    const binsData = histogram(values);
    const y = d3.scaleLinear().domain([0, d3.max(binsData, (b) => b.length) ?? 1]).nice().range([h, 0]);

    const grad = svg.append("defs").append("linearGradient").attr("id", "histGrad").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
    grad.append("stop").attr("offset", "0").attr("stop-color", "#22d3ee").attr("stop-opacity", 0.9);
    grad.append("stop").attr("offset", "1").attr("stop-color", "#7c5cff").attr("stop-opacity", 0.5);

    const tip = tipRef.current;
    g.selectAll("rect.bar")
      .data(binsData)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (b) => x(b.x0 ?? 0) + 1)
      .attr("width", (b) => Math.max(1, x(b.x1 ?? 0) - x(b.x0 ?? 0) - 2))
      .attr("y", h)
      .attr("height", 0)
      .attr("rx", 3)
      .attr("fill", "url(#histGrad)")
      .on("mousemove", (event: MouseEvent, b) => {
        if (!tip) return;
        const [mx] = d3.pointer(event, svgEl);
        tip.style.opacity = "1";
        tip.style.left = `${Math.min(width - 140, mx + 12)}px`;
        tip.style.top = "8px";
        tip.innerHTML = `<p style="font-size:11px;color:#c0cbe3">${(b.x0 ?? 0).toFixed(1)}–${(b.x1 ?? 0).toFixed(1)} days</p><p style="font-family:JetBrains Mono,monospace;font-size:12px;color:#eef2fb"><b>${b.length}</b> task${b.length === 1 ? "" : "s"}</p>`;
      })
      .on("mouseleave", () => {
        if (tip) tip.style.opacity = "0";
      })
      .transition()
      .duration(500)
      .delay((_, i) => i * 24)
      .attr("y", (b) => y(b.length))
      .attr("height", (b) => h - y(b.length));

    const marker = (value: number, color: string, label: string) => {
      const px = x(Math.min(value, x.domain()[1]));
      g.append("line").attr("x1", px).attr("x2", px).attr("y1", -6).attr("y2", h).attr("stroke", color).attr("stroke-width", 1.4).attr("stroke-dasharray", "4 3");
      g.append("text")
        .attr("x", px)
        .attr("y", -9)
        .attr("text-anchor", "middle")
        .attr("fill", color)
        .style("font-family", "JetBrains Mono, monospace")
        .style("font-size", "9.5px")
        .style("font-weight", "600")
        .text(`${label} ${value}d`);
    };
    if (p50 !== null) marker(p50, "#a3e635", "P50");
    if (p85 !== null) {
      if (p50 === null || Math.abs(x(p85) - x(p50)) > 46) marker(p85, "#fbbf24", "P85");
      else {
        const px = x(Math.min(p85, x.domain()[1]));
        g.append("line").attr("x1", px).attr("x2", px).attr("y1", -6).attr("y2", h).attr("stroke", "#fbbf24").attr("stroke-width", 1.4).attr("stroke-dasharray", "4 3");
        g.append("text").attr("x", px + 4).attr("y", 4).attr("fill", "#fbbf24").style("font-family", "JetBrains Mono, monospace").style("font-size", "9.5px").text(`P85 ${p85}d`);
      }
    }

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(Math.min(7, bins + 1)).tickSize(4).tickFormat((v) => `${v}d`))
      .call((sel) => sel.select(".domain").attr("stroke", "#1c2947"))
      .call((sel) => sel.selectAll("text").attr("fill", "#8c9ab8").style("font-family", "JetBrains Mono, monospace").style("font-size", "9.5px"))
      .call((sel) => sel.selectAll("line").attr("stroke", "#1c2947"));
    g.append("g")
      .call(d3.axisLeft(y).ticks(4).tickSize(-w).tickPadding(8))
      .call((sel) => sel.select(".domain").remove())
      .call((sel) => sel.selectAll("text").attr("fill", "#8c9ab8").style("font-family", "JetBrains Mono, monospace").style("font-size", "9.5px"))
      .call((sel) => sel.selectAll("line").attr("stroke", "#1c2947").attr("stroke-dasharray", "2 5"));
  }, [values, p50, p85, bins, width, height]);

  return (
    <div ref={wrapRef} className="relative">
      <ChartData columns={["Completion sample", "Days"]} rows={values.map((v, i) => [i + 1, v])} />
      <svg ref={svgRef} className="w-full" style={{ height }} role="img" aria-label="Cycle time distribution histogram" />
      <div ref={tipRef} className="pointer-events-none absolute z-10 rounded-lg border border-line bg-ink-800/95 px-3 py-2 opacity-0 shadow-2xl backdrop-blur transition-opacity" />
    </div>
  );
}
