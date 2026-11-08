"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  type MemberDTO,
  type Priority,
  type ProjectDTO,
  type SavedViewDTO,
  type TaskDTO,
  type TaskPageDTO,
  type TaskPagination,
  type TaskStatus,
  type ViewConfig,
} from "@/lib/domain/types";
import { canTransition } from "@/lib/domain/lifecycle";
import { cn, PRIORITY_HEX, STATUS_HEX } from "@/lib/utils";
import { Avatar, Button, EmptyState, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger, Tip } from "@/components/overlays";
import { useToast } from "@/components/toast";
import { useApp } from "@/components/shell/app-context";
import { DueChip, PriorityBadge, RiskPill, TagChip } from "@/components/tasks/bits";

const PRIORITY_RANK: Record<Priority, number> = { urgent: 3, high: 2, medium: 1, low: 0 };

interface Filters {
  q: string;
  projectId: string;
  assigneeId: string;
  priority: string;
  tag: string;
  sort: string;
  layout: "board" | "list";
}

const DEFAULT_FILTERS: Filters = { q: "", projectId: "", assigneeId: "", priority: "", tag: "", sort: "manual", layout: "board" };

function sortTasks(tasks: TaskDTO[], sort: string): TaskDTO[] {
  const xs = [...tasks];
  switch (sort) {
    case "risk":
      return xs.sort((a, b) => (b.risk?.score ?? -1) - (a.risk?.score ?? -1));
    case "due":
      return xs.sort((a, b) => (a.dueDate ? Date.parse(a.dueDate) : Infinity) - (b.dueDate ? Date.parse(b.dueDate) : Infinity));
    case "priority":
      return xs.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
    case "created":
      return xs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    case "title":
      return xs.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return xs.sort((a, b) => a.position - b.position || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
}

export function BoardClient({
  tasks: serverTasks,
  pagination: serverPagination,
  projects,
  members,
  views: serverViews,
  labels,
  workspaceId,
  initialQ,
  initialProjectId = "",
}: {
  tasks: TaskDTO[];
  pagination: TaskPagination;
  projects: ProjectDTO[];
  members: MemberDTO[];
  views: SavedViewDTO[];
  labels: string[];
  workspaceId: string;
  initialQ: string;
  initialProjectId?: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const { openTask, openCreate } = useApp();
  const [tasks, setTasks] = useState(serverTasks);
  const [pagination, setPagination] = useState(serverPagination);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const queryGeneration = useRef(0);
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, q: initialQ, projectId: initialProjectId });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const [viewName, setViewName] = useState("");
  const [views, setViews] = useState(serverViews);
  const [celebrate, setCelebrate] = useState(0);

  /*
   * Server → client reconciliation (ADR-007). React's sanctioned "adjust state
   * when props change" pattern: a guarded render-time sync against the previous
   * props, instead of setState-in-effect cascades. Optimistic local state is
   * replaced only when the server actually hands us new data.
   */
  const [prevProps, setPrevProps] = useState({
    tasks: serverTasks,
    pagination: serverPagination,
    views: serverViews,
    q: initialQ,
    project: initialProjectId,
  });
  const tasksChanged = prevProps.tasks !== serverTasks;
  const paginationChanged = prevProps.pagination !== serverPagination;
  const viewsChanged = prevProps.views !== serverViews;
  const qChanged = prevProps.q !== initialQ;
  const projectChanged = prevProps.project !== initialProjectId;
  // Never replace task state mid-drag: swapping the dragged DOM node cancels
  // the native drag. Deferred until dragend/drop clears dragId.
  const applyTasks = tasksChanged && dragId === null;
  if (applyTasks || paginationChanged || viewsChanged || qChanged || projectChanged) {
    setPrevProps({
      tasks: applyTasks ? serverTasks : prevProps.tasks,
      pagination: serverPagination,
      views: serverViews,
      q: initialQ,
      project: initialProjectId,
    });
    if (applyTasks) setTasks(serverTasks);
    if (paginationChanged) setPagination(serverPagination);
    if (viewsChanged) setViews(serverViews);
    if (qChanged || projectChanged) {
      setFilters((f) => ({
        ...f,
        ...(qChanged ? { q: initialQ } : {}),
        ...(projectChanged ? { projectId: initialProjectId } : {}),
      }));
    }
  }

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const allTags = labels;

  const filtered = tasks;
  const query = new URLSearchParams({ workspaceId, pageSize: "50", sort: filters.sort === "manual" ? "position" : filters.sort });
  if (filters.q) query.set("q", filters.q);
  if (filters.projectId) query.set("projectId", filters.projectId);
  if (filters.assigneeId) query.set("assigneeId", filters.assigneeId);
  if (filters.priority) query.set("priority", filters.priority);
  if (filters.tag) query.set("label", filters.tag);
  const queryString = query.toString();
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++queryGeneration.current;
    const timer = window.setTimeout(() => {
      setQueryLoading(true);
      api<TaskPageDTO>("/api/tasks?" + queryString, "GET", undefined, controller.signal).then((page) => {
        if (generation !== queryGeneration.current || controller.signal.aborted) return;
        setTasks(page.tasks); setPagination(page.pagination); setSelection(new Set());
      }).catch((e: unknown) => {
        if (!controller.signal.aborted) push({ title: "Could not filter tasks", description: e instanceof Error ? e.message : undefined, tone: "error" });
      }).finally(() => { if (!controller.signal.aborted) setQueryLoading(false); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [queryString, serverTasks, push]);

  const activeFilterCount = [filters.q, filters.projectId, filters.assigneeId, filters.priority, filters.tag].filter(Boolean).length;
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const patchTask = useCallback(
    async (id: string, expectedVersion: number, body: Record<string, unknown>, prevTasks: TaskDTO[]) => {
      try {
        await api(`/api/tasks/${id}`, "PATCH", { ...body, expectedVersion });
        router.refresh();
      } catch (e) {
        setTasks(prevTasks);
        push({ title: "Move failed — reverted", description: e instanceof Error ? e.message : undefined, tone: "error" });
      }
    },
    [router, push],
  );

  async function loadMore() {
    if (!pagination.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const generation = queryGeneration.current;
      const nextPage = pagination.page + 1;
      const result = await api<TaskPageDTO>(
        `/api/tasks?${queryString}&page=${nextPage}`,
      );
      if (generation !== queryGeneration.current) return;
      setTasks((current) => {
        const known = new Set(current.map((t) => t.id));
        return [...current, ...result.tasks.filter((t) => !known.has(t.id))];
      });
      setPagination(result.pagination);
    } catch (e) {
      push({ title: "Could not load more tasks", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setLoadingMore(false);
    }
  }

  function handleDrop(status: TaskStatus, beforeId: string | null) {
    if (queryLoading) return;
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    setDropBefore(null);
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    if (!canTransition(task.status, status)) {
      push({ title: "That move is not a legal transition", description: `${task.status.replace("_", " ")} → ${status.replace("_", " ")}`, tone: "error" });
      return;
    }
    const prev = tasks;
    const column = sortTasks(tasks.filter((t) => t.status === status && t.id !== id), "manual");
    let index = column.length;
    if (beforeId && beforeId !== id) {
      const bi = column.findIndex((t) => t.id === beforeId);
      if (bi >= 0) index = bi;
    }
    setTasks((xs) => xs.map((t) => (t.id === id ? { ...t, status, position: index } : t)));
    if (status === "done" && task.status !== "done") {
      setCelebrate((c) => c + 1);
      push({ title: "Completed · +1 throughput", description: task.title, tone: "success" });
    }
    patchTask(id, task.revision, { status, position: index }, prev);
  }

  function toggleSelect(id: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(action: "status" | "assign" | "delete", extra: Record<string, unknown>) {
    const ids = [...selection];
    if (ids.length === 0) return;
    const prev = tasks;
    const expected = tasks
      .filter((t) => selection.has(t.id))
      .map((t) => ({ id: t.id, revision: t.revision }));
    if (action === "delete") setTasks((xs) => xs.filter((t) => !selection.has(t.id)));
    setSelection(new Set());
    try {
      const result = await api<{ affected: number; expected: { id: string; revision: number }[] }>(
        "/api/tasks/bulk",
        "POST",
        { workspaceId, ids, action, expected, ...extra },
      );
      router.refresh();
      if (action === "delete") {
        push({
          title: `${result.affected} task${result.affected === 1 ? "" : "s"} deleted`,
          tone: "info",
          action: {
            label: "Undo",
            onClick: async () => {
              await api("/api/tasks/bulk", "POST", {
                workspaceId,
                ids,
                action: "restore",
                expected: result.expected,
              });
              router.refresh();
              push({ title: "Tasks restored", tone: "success" });
            },
          },
        });
      } else {
        push({ title: `${result.affected} task${result.affected === 1 ? "" : "s"} updated`, tone: "success" });
      }
    } catch (e) {
      setTasks(prev);
      push({ title: "Bulk action failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  async function saveView() {
    const name = viewName.trim();
    if (!name) return;
    const config: ViewConfig = { ...filters };
    try {
      const res = await api<{ view: SavedViewDTO }>("/api/views", "POST", { workspaceId, name, config });
      setViews((v) => [...v, res.view]);
      setViewName("");
      push({ title: "View saved", description: name, tone: "success" });
    } catch (e) {
      push({ title: "Could not save view", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  async function deleteView(id: string) {
    setViews((v) => v.filter((x) => x.id !== id));
    try {
      await api("/api/views", "DELETE", { workspaceId, id });
    } catch {
      setViews((current) => current.some((v) => v.id === id) ? current : [...current, ...views.filter((v) => v.id === id)]);
      push({ title: "Could not delete view", tone: "error" });
    }
  }

  const card = (t: TaskDTO, listMode = false) => {
    const project = projectById.get(t.projectId);
    const selected = selection.has(t.id);
    const blocked = t.blockedBy.some((d) => d.status !== "done");
    return (
      <div
        key={t.id}
        draggable={!listMode && !queryLoading && activeFilterCount === 0 && filters.sort === "manual" && !pagination.hasMore}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", t.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(t.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverCol(null);
          setDropBefore(null);
        }}
        onDragOver={(e) => {
          if (listMode || !dragId) return;
          e.preventDefault();
          e.stopPropagation();
          setOverCol(t.status);
          setDropBefore(t.id);
        }}
        onClick={() => openTask(t.id)}
        className={cn(
          "group relative cursor-pointer rounded-xl border bg-ink-850 p-3 transition-all",
          selected ? "border-pulse-500 shadow-[0_0_0_1px_rgba(124,92,255,0.4)]" : "border-line hover:border-ink-600 hover:bg-ink-800",
          dragId === t.id && "dragging-card",
          !listMode && dropBefore === t.id && dragId !== t.id && "border-t-2 border-t-pulse-400",
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openTask(t.id); } }}
        aria-label={t.title}
      >
        <div className="flex items-start gap-2">
          <span
            className={cn("mt-0.5 transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => toggleSelect(t.id)}
              className="h-3.5 w-3.5 cursor-pointer accent-[#7c5cff]"
              aria-label={`Select ${t.title}`}
            />
          </span>
          <p className={cn("flex-1 text-[13px] font-medium leading-[1.35] text-mist-200", t.status === "done" && "text-mist-500 line-through decoration-mist-600")}>
            {t.title}
          </p>
          {!listMode && <Icon name="grip" size={13} className="mt-0.5 shrink-0 cursor-grab text-mist-600 opacity-0 group-hover:opacity-100" />}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5.5">
          {project && (
            <span className="font-mono text-[9.5px] font-bold" style={{ color: project.color }}>{project.key}</span>
          )}
          <PriorityBadge priority={t.priority} />
          {t.risk && <RiskPill score={t.risk.score} band={t.risk.band} />}
          {blocked && (
            <Tip label={`Blocked by ${t.blockedBy.filter((d) => d.status !== "done").map((d) => d.title).join(", ")}`}>
              <span className="text-amber-400"><Icon name="block" size={11} /></span>
            </Tip>
          )}
          <DueChip iso={t.dueDate} done={t.status === "done"} />
          {t.estimatePoints !== null && <span className="font-mono text-[10px] text-mist-600">{t.estimatePoints}pt</span>}
          <span className="flex-1" />
          {t.assignee ? (
            <Avatar name={t.assignee.name} hue={t.assignee.avatarHue} size={20} />
          ) : (
            <span className="h-5 w-5 rounded-full border border-dashed border-ink-600" title="Unassigned" />
          )}
        </div>
        {t.labels.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1 pl-5.5">
            {t.labels.slice(0, 3).map((tag) => <TagChip key={tag} tag={tag} />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      {/* header + controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="panel-title text-xl font-bold text-mist-100">Board</h1>
            <p className="text-[12px] text-mist-500">
            {filtered.length} shown · loaded {tasks.length} of {pagination.total} tasks · drag to move · click for the full story
          </p>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Icon name="eye" size={13} /> Views {views.length > 0 && <span className="rounded bg-ink-700 px-1 font-mono text-[10px]">{views.length}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-mist-600">Saved views</p>
            {views.length === 0 && <p className="px-2 py-2 text-[12px] text-mist-500">No saved views yet.</p>}
            {views.map((v) => (
              <div key={v.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-ink-750">
                <button className="flex-1 truncate text-left text-[12.5px] text-mist-200" onClick={() => setFilters({ ...v.config })}>
                  {v.name}
                </button>
                <button onClick={() => deleteView(v.id)} className="text-mist-600 hover:text-rose-300" aria-label={`Delete view ${v.name}`}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
            <div className="mt-2 flex gap-1.5 border-t border-line p-2 pt-2.5">
              <Input aria-label="Saved view name" value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Save current as…" className="h-8 flex-1 text-[12px]" maxLength={40} />
              <Button aria-label="Save view" size="sm" variant="outline" onClick={saveView} disabled={!viewName.trim()}>
                <Icon name="save" size={12} />
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex rounded-lg border border-line bg-ink-850 p-0.5">
          {(["board", "list"] as const).map((l) => (
            <button
              key={l}
              onClick={() => set({ layout: l })}
              className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-all", filters.layout === l ? "bg-pulse-600/30 text-pulse-200" : "text-mist-500 hover:text-mist-300")}
              aria-pressed={filters.layout === l}
            >
              <Icon name={l === "board" ? "board" : "list"} size={13} /> {l === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => openCreate()}>
          <Icon name="plus" size={13} /> New task
        </Button>
      </div>

      {/* filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-[240px]">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist-600" />
          <Input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Filter tasks…" className="h-8.5 pl-8 text-[12.5px]" />
        </div>
        <Select value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })} className="h-8.5 w-auto py-0 text-[12px]" aria-label="Filter by project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select value={filters.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })} className="h-8.5 w-auto py-0 text-[12px]" aria-label="Filter by assignee">
          <option value="">Everyone</option>
          <option value="none">Unassigned</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Select value={filters.priority} onChange={(e) => set({ priority: e.target.value })} className="h-8.5 w-auto py-0 text-[12px]" aria-label="Filter by priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </Select>
        <Select value={filters.tag} onChange={(e) => set({ tag: e.target.value })} className="h-8.5 w-auto py-0 text-[12px]" aria-label="Filter by tag">
          <option value="">Any tag</option>
          {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </Select>
        <Select value={filters.sort} onChange={(e) => set({ sort: e.target.value })} className="h-8.5 w-auto py-0 text-[12px]" aria-label="Sort">
          <option value="manual">Manual order</option>
          <option value="risk">Highest risk</option>
          <option value="due">Due date</option>
          <option value="priority">Priority</option>
          <option value="created">Newest</option>
          <option value="title">Title A–Z</option>
        </Select>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ ...DEFAULT_FILTERS, layout: filters.layout })}>
            <Icon name="x" size={12} /> Clear ({activeFilterCount})
          </Button>
        )}
      </div>

      {queryLoading && <p role="status">Updating tasks...</p>}
      {(activeFilterCount > 0 || pagination.hasMore || filters.sort !== "manual") && <p className="mb-3 text-xs text-mist-500">Clear filters, select manual order and load all tasks to drag. Change status from task details at any time.</p>}
      {/* board */}
      {filters.layout === "board" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STATUSES.map((status) => {
            const col = sortTasks(filtered.filter((t) => t.status === status), filters.sort);
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(status);
                  setDropBefore(null);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol((c) => (c === status ? null : c));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(status, dropBefore);
                }}
                className={cn("flex min-h-[300px] flex-col rounded-2xl border border-line/70 bg-ink-900/50 p-2 transition-colors", overCol === status && dragId && "drop-target")}
              >
                <div className="relative mb-2 flex items-center gap-2 px-1.5 pt-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: STATUS_HEX[status], boxShadow: `0 0 8px ${STATUS_HEX[status]}88` }} />
                  <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-mist-300">{STATUS_LABEL[status]}</p>
                  <span className="rounded bg-ink-750 px-1.5 font-mono text-[10px] text-mist-500">{col.length}</span>
                  <span className="flex-1" />
                  <button onClick={() => openCreate({ status })} className="rounded-md p-1 text-mist-600 hover:bg-ink-700 hover:text-pulse-300" aria-label={`Add task to ${STATUS_LABEL[status]}`}>
                    <Icon name="plus" size={13} />
                  </button>
                  {status === "done" && celebrate > 0 && (
                    <span key={celebrate} className="pointer-events-none absolute right-6 top-2">
                      {[...Array(6)].map((_, i) => (
                        <span
                          key={i}
                          className="absolute h-1.5 w-1.5 rounded-full"
                          style={{
                            background: ["#a3e635", "#22d3ee", "#8f76ff", "#fbbf24", "#e879f9", "#4c8dff"][i],
                            ["--sx" as string]: `${Math.cos((i / 6) * Math.PI * 2) * 26}px`,
                            ["--sy" as string]: `${Math.sin((i / 6) * Math.PI * 2) * 26}px`,
                            animation: "spark 600ms ease-out forwards",
                          }}
                        />
                      ))}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {col.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line/60 py-8 text-[11px] text-mist-600">
                      {dragId ? "Drop here" : "Empty"}
                    </div>
                  ) : (
                    col.map((t) => card(t))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* list view */
        <div className="card overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState icon="filter" title="No tasks match" body="Loosen the filters or create a new task." action={<Button size="sm" onClick={() => openCreate()}><Icon name="plus" size={13} /> New task</Button>} />
            </div>
          ) : (
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-mist-600">
                  <th className="w-8 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[#7c5cff]"
                      checked={selection.size > 0 && selection.size === filtered.length}
                      onChange={(e) => setSelection(e.target.checked ? new Set(filtered.map((t) => t.id)) : new Set())}
                      aria-label="Select all"
                    />
                  </th>
                  {([["title", "Task"], ["", "Status"], ["priority", "Priority"], ["", "Assignee"], ["due", "Due"], ["risk", "Risk"]] as [string, string][]).map(([key, label], i) => (
                    <th key={i} className="px-3 py-2.5 font-semibold">
                      {key ? (
                        <button className={cn("uppercase hover:text-mist-300", filters.sort === key && "text-pulse-300")} onClick={() => set({ sort: key })}>
                          {label} {filters.sort === key && "↓"}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortTasks(filtered, filters.sort).map((t) => {
                  const project = projectById.get(t.projectId);
                  return (
                    <tr key={t.id} className="cursor-pointer border-b border-line/50 transition-colors hover:bg-ink-800/60" onClick={() => openTask(t.id)}>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="h-3.5 w-3.5 accent-[#7c5cff]" checked={selection.has(t.id)} onChange={() => toggleSelect(t.id)} aria-label={`Select ${t.title}`} />
                      </td>
                      <td className="max-w-[320px] px-3 py-2.5">
                        <button className={cn("truncate text-left text-[13px] font-medium text-mist-200", t.status === "done" && "text-mist-500 line-through")} onClick={(e) => { e.stopPropagation(); openTask(t.id); }}>{t.title}</button>
                        <p className="font-mono text-[9.5px]" style={{ color: project?.color }}>{project?.key} {t.tags.map((x) => `#${x}`).join(" ")}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: STATUS_HEX[t.status] }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_HEX[t.status] }} />
                          {STATUS_LABEL[t.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5"><span style={{ color: PRIORITY_HEX[t.priority] }}><PriorityBadge priority={t.priority} /></span></td>
                      <td className="px-3 py-2.5">
                        {t.assignee ? (
                          <span className="flex items-center gap-1.5 text-[12px] text-mist-300">
                            <Avatar name={t.assignee.name} hue={t.assignee.avatarHue} size={20} /> {t.assignee.name.split(" ")[0]}
                          </span>
                        ) : (
                          <span className="text-[11px] text-mist-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5"><DueChip iso={t.dueDate} done={t.status === "done"} /></td>
                      <td className="px-3 py-2.5">{t.risk ? <RiskPill score={t.risk.score} band={t.risk.band} /> : <span className="text-[11px] text-mist-600">done</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {pagination.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore || queryLoading}>
            {loadingMore ? <span className="animate-spin">◌</span> : <Icon name="down" size={13} />}
            {loadingMore ? "Loading tasks…" : `Load more · ${tasks.length} of ${pagination.total}`}
          </Button>
        </div>
      )}

      {/* bulk action bar */}
      {selection.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl border border-pulse-600/40 bg-ink-800/95 px-4 py-3 shadow-2xl backdrop-blur animate-pop">
          <span className="font-mono text-[12px] font-bold text-pulse-300">{selection.size} selected</span>
          <span className="h-4 w-px bg-line" />
          <Select className="h-8 w-auto py-0 text-[12px]" value="" onChange={(e) => e.target.value && bulk("status", { status: e.target.value })} aria-label="Move selected to status">
            <option value="">Move to…</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <Select className="h-8 w-auto py-0 text-[12px]" value="" onChange={(e) => e.target.value && bulk("assign", { assigneeId: e.target.value === "none" ? null : e.target.value })} aria-label="Assign selected">
            <option value="">Assign to…</option>
            <option value="none">Unassign</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Button variant="danger" size="sm" onClick={() => bulk("delete", {})}>
            <Icon name="trash" size={12} /> Delete
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setSelection(new Set())}>
            <Icon name="x" size={12} /> Clear
          </Button>
        </div>
      )}
    </div>
  );
}
