import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Priority, RiskBand, TaskStatus } from "@/lib/domain/types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const STATUS_HEX: Record<TaskStatus, string> = {
  backlog: "#64748b",
  todo: "#4c8dff",
  in_progress: "#8f76ff",
  review: "#22d3ee",
  done: "#a3e635",
};
export const PRIORITY_HEX: Record<Priority, string> = {
  low: "#6d7a99",
  medium: "#4c8dff",
  high: "#fbbf24",
  urgent: "#fb4d6d",
};
export const RISK_HEX: Record<RiskBand, string> = {
  low: "#a3e635",
  medium: "#fbbf24",
  high: "#fb4d6d",
};
export const CHART_COLORS = ["#8f76ff", "#22d3ee", "#a3e635", "#fbbf24", "#fb4d6d", "#e879f9", "#4c8dff", "#f97316"];

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function dueLabel(iso: string | null): { text: string; tone: "overdue" | "soon" | "ok" | "none" } {
  if (!iso) return { text: "No due date", tone: "none" };
  const days = (new Date(iso).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return { text: `${Math.max(1, Math.ceil(-days))}d overdue`, tone: "overdue" };
  if (days < 1) return { text: "Due today", tone: "soon" };
  if (days < 3) return { text: `${Math.ceil(days)}d left`, tone: "soon" };
  return { text: `${Math.ceil(days)}d left`, tone: "ok" };
}

export function fmtDays(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (!Number.isFinite(v)) return "∞";
  if (v >= 100) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}