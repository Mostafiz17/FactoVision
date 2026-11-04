"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ActivityDTO, ActivityPageDTO, MemberDTO, ProjectDTO } from "@/lib/domain/types";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar, Button, EmptyState, Select, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { eventText } from "@/components/tasks/TaskDrawer";
import { useApp } from "@/components/shell/app-context";
import { useToast } from "@/components/toast";

const GROUPS: { key: string; label: string; icon: IconName; types: string[] }[] = [
  { key: "all", label: "Everything", icon: "history", types: [] },
  { key: "flow", label: "Status & flow", icon: "board", types: ["status_changed", "completed", "reopened", "created"] },
  { key: "comments", label: "Comments", icon: "message", types: ["commented"] },
  { key: "people", label: "Assignments", icon: "users", types: ["assigned"] },
  { key: "changes", label: "Edits & links", icon: "edit", types: ["edited", "labels_changed", "parent_changed", "priority_changed", "due_changed", "estimate_changed", "dependency_added", "dependency_removed", "deleted", "restored"] },
];

export function ActivityClient({
  initial,
  members,
  projects,
  workspaceId,
  initialProjectId,
}: {
  initial: ActivityPageDTO;
  members: MemberDTO[];
  projects: ProjectDTO[];
  workspaceId: string;
  initialProjectId: string;
}) {
  const { openTask } = useApp();
  const { push } = useToast();
  const [items, setItems] = useState<ActivityDTO[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [loading, setLoading] = useState(false);
  const [group, setGroup] = useState("all");
  const [memberId, setMemberId] = useState("");

  async function fetchPage(nextProject: string, after: string | null) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ workspaceId, limit: "50" });
      if (nextProject) qs.set("projectId", nextProject);
      if (after) qs.set("cursor", after);
      const page = await api<ActivityPageDTO>(`/api/activity?${qs.toString()}`);
      setItems((prev) => {
        if (!after) return page.items;
        const known = new Set(prev.map((a) => a.id));
        return [...prev, ...page.items.filter((a) => !known.has(a.id))];
      });
      setCursor(page.nextCursor);
    } catch (e) {
      push({ title: "Could not load activity", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  function changeProject(next: string) {
    setProjectId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("project", next);
    else url.searchParams.delete("project");
    window.history.replaceState(null, "", url.toString());
    void fetchPage(next, null);
  }

  const filtered = useMemo(() => {
    const g = GROUPS.find((x) => x.key === group);
    return items.filter((a) => {
      if (g && g.types.length > 0 && !g.types.includes(a.type)) return false;
      if (memberId && a.actor?.id !== memberId) return false;
      return true;
    });
  }, [items, group, memberId]);

  const byDay = useMemo(() => {
    const map = new Map<string, ActivityDTO[]>();
    for (const a of filtered) {
      const key = new Date(a.createdAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    return [...map.entries()];
  }, [filtered]);

  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-5">
        <h1 className="panel-title text-xl font-bold text-mist-100">{project ? `${project.name} · activity` : "Activity"}</h1>
        <p className="text-[12px] text-mist-500">The append-only event log — the same source every metric is computed from.</p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {GROUPS.map((g) => (
          <button key={g.key} onClick={() => setGroup(g.key)} aria-pressed={group === g.key}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-all",
              group === g.key ? "border-pulse-500/60 bg-pulse-600/20 text-pulse-200" : "border-line text-mist-500 hover:text-mist-300",
            )}>
            <Icon name={g.icon} size={12} /> {g.label}
          </button>
        ))}
        <span className="flex-1" />
        <Select value={projectId} onChange={(e) => changeProject(e.target.value)} className="h-8.5 w-auto py-0 text-[12px]" aria-label="Filter by project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="h-8.5 w-auto py-0 text-[12px]" aria-label="Filter by member">
          <option value="">Everyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-pulse-300"><Spinner size={22} /></div>
      ) : byDay.length === 0 ? (
        <EmptyState icon="history" title="Nothing matches" body={cursor ? "No matching events on loaded pages — load older activity." : "Try a different filter — or go make some history on the board."} />
      ) : (
        <div className="space-y-6">
          {byDay.map(([day, dayItems]) => (
            <div key={day} className="animate-rise">
              <p className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mist-600">{day}</p>
              <div className="card divide-y divide-line/50">
                {dayItems.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                    {a.actor ? <Avatar name={a.actor.name} hue={a.actor.avatarHue} size={28} /> : <span className="h-7 w-7 rounded-full bg-ink-700" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-5 text-mist-300">
                        <b className="text-mist-100">{a.actor?.name ?? "System"}</b> {eventText({ ...a, actor: a.actor })}
                      </p>
                      <button onClick={() => openTask(a.taskId)} className="mt-0.5 block max-w-full truncate text-[12px] text-pulse-300/90 hover:text-pulse-200 hover:underline">
                        {a.taskTitle}
                      </button>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-mist-600">{timeAgo(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {cursor && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => void fetchPage(projectId, cursor)} disabled={loading}>
            {loading ? <Spinner size={13} /> : <Icon name="down" size={13} />} Load older activity
          </Button>
        </div>
      )}
    </div>
  );
}