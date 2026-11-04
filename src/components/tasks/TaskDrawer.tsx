"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  type MemberDTO,
  type ProjectDTO,
  type TaskDetailDTO,
  type TaskDTO,
  type TaskEventDTO,
  type TaskStatus,
} from "@/lib/domain/types";
import { canTransition, nextStatuses } from "@/lib/domain/lifecycle";
import { cn, RISK_HEX, STATUS_HEX, timeAgo } from "@/lib/utils";
import { Avatar, Button, EmptyState, Input, Select, Skeleton, Spinner, Textarea } from "@/components/ui";
import { Drawer, Tip } from "@/components/overlays";
import { Icon, type IconName } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useApp } from "@/components/shell/app-context";
import { PriorityBadge, RiskPill, TagChip } from "./bits";

const EVENT_ICON: Record<string, IconName> = {
  created: "plus",
  status_changed: "board",
  completed: "check",
  reopened: "undo",
  assigned: "users",
  priority_changed: "up",
  due_changed: "calendar",
  estimate_changed: "target",
  edited: "edit",
  labels_changed: "tag",
  parent_changed: "layers",
  commented: "message",
  dependency_added: "link",
  dependency_removed: "block",
  deleted: "trash",
  restored: "undo",
};

function statusText(v: string | null): string {
  if (!v) return "—";
  return (STATUS_LABEL as Record<string, string>)[v] ?? v;
}

export function eventText(e: TaskEventDTO): string {
  switch (e.type) {
    case "created": return `created this task in ${statusText(e.toValue)}`;
    case "status_changed": return `moved ${statusText(e.fromValue)} → ${statusText(e.toValue)}`;
    case "completed": return "completed this task";
    case "reopened": return `reopened it into ${statusText(e.toValue)}`;
    case "assigned": return `assigned ${e.fromLabel ?? e.fromValue ?? "Unassigned"} → ${e.toLabel ?? e.toValue ?? "Unassigned"}`;
    case "priority_changed": return `priority ${e.fromValue} → ${e.toValue}`;
    case "due_changed": return `due date ${e.fromValue ?? "none"} → ${e.toValue ?? "none"}`;
    case "estimate_changed": return `estimate ${e.fromValue ?? "—"} → ${e.toValue ?? "—"} pts`;
    case "edited":
      if (e.fromValue === "details") return "updated the description";
      if (e.fromValue === "project") return `moved it to project ${e.toValue}`;
      return `renamed it to “${e.toValue}”`;
    case "labels_changed": return `labels ${e.fromLabel ?? e.fromValue ?? "none"} → ${e.toLabel ?? e.toValue ?? "none"}`;
    case "parent_changed": return `parent ${e.fromLabel ?? e.fromValue ?? "none"} → ${e.toLabel ?? e.toValue ?? "none"}`;
    case "commented": return "commented";
    case "dependency_added": return `added blocker “${e.toValue}”`;
    case "dependency_removed": return `removed blocker “${e.toValue}”`;
    case "deleted": return "deleted this task";
    case "restored": return "restored this task";
    default: return e.type;
  }
}

type Tab = "details" | "risk" | "activity" | "comments";

export function TaskDrawer({
  taskId,
  onClose,
  workspaceId,
  onOpenTask,
}: {
  taskId: string | null;
  onClose: () => void;
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  return (
    <Drawer open={taskId !== null} onClose={onClose} label="Task details">
      {taskId !== null && (
        <TaskDrawerContent key={`${workspaceId}:${taskId}`} taskId={taskId} onClose={onClose} workspaceId={workspaceId} onOpenTask={onOpenTask} />
      )}
    </Drawer>
  );
}

function TaskDrawerContent({ taskId, onClose, workspaceId, onOpenTask }: {
  taskId: string;
  onClose: () => void;
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const { openCreate } = useApp();
  const [detail, setDetail] = useState<TaskDetailDTO | null>(null);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [allTasks, setAllTasks] = useState<TaskDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("details");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [estimateText, setEstimateText] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [depPick, setDepPick] = useState("");

  const fetchDetail = useCallback(
    (id: string, isActive: () => boolean = () => true) =>
      api<{ task: TaskDetailDTO }>(`/api/tasks/${id}`)
        .then((res) => {
          if (!isActive()) return;
          setDetail(res.task);
          setTitle(res.task.title);
          setDesc(res.task.description);
          setEstimateText(res.task.estimatePoints === null ? "" : String(res.task.estimatePoints));
        })
        .catch((e: unknown) => {
          if (isActive()) setError(e instanceof Error ? e.message : "Failed to load task");
        })
        .finally(() => { if (isActive()) setLoading(false); }),
    [],
  );

  useEffect(() => {
    let active = true;
    void fetchDetail(taskId, () => active);
    api<{ members: MemberDTO[] }>(`/api/workspaces/${workspaceId}/members`).then((r) => { if (active) setMembers(r.members); }).catch(() => undefined);
    api<{ projects: ProjectDTO[] }>(`/api/projects?workspaceId=${workspaceId}`).then((r) => { if (active) setProjects(r.projects); }).catch(() => undefined);
    api<{ tasks: TaskDTO[] }>(`/api/tasks?workspaceId=${workspaceId}&pageSize=100`).then((r) => { if (active) setAllTasks(r.tasks); }).catch(() => undefined);
    return () => { active = false; };
  }, [taskId, workspaceId, fetchDetail]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      if (!taskId || !detail) return;
      const prev = detail;
      const optimistic = { ...detail, ...(body as unknown as Partial<TaskDetailDTO>), revision: detail.revision + 1 };
      if (Array.isArray(body.labels)) optimistic.tags = body.labels as string[];
      setDetail(optimistic);
      try {
        await api(`/api/tasks/${taskId}`, "PATCH", { ...body, expectedVersion: detail.revision });
        await fetchDetail(taskId);
        router.refresh();
      } catch (e) {
        setDetail(prev);
        push({ title: "Update failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
      }
    },
    [taskId, detail, fetchDetail, router, push],
  );

  async function removeTask() {
    if (!taskId || !detail) return;
    const id = taskId;
    const name = detail.title;
    const revision = detail.revision;
    onClose();
    try {
      const deleted = await api<{ revision: number }>(`/api/tasks/${id}`, "DELETE", { expectedVersion: revision });
      router.refresh();
      push({
        title: "Task deleted",
        description: name,
        tone: "info",
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await api(`/api/tasks/${id}`, "PATCH", { restore: true, expectedVersion: deleted.revision });
              router.refresh();
              push({ title: "Task restored", tone: "success" });
            } catch (e) {
              push({ title: "Restore failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
            }
          },
        },
      });
    } catch (e) {
      push({ title: "Delete failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  async function sendComment() {
    if (!taskId || !comment.trim() || !detail) return;
    setSending(true);
    const body = comment.trim();
    // Only keep mentions whose @Name is still present in the final text.
    const ids = mentionIds.filter((id) => {
      const m = members.find((x) => x.id === id);
      return m ? body.includes(`@${m.name}`) : false;
    });
    const parentId = replyTo?.id ?? null;
    setComment("");
    try {
      const res = await api<{ comment: TaskDetailDTO["comments"][number] }>(`/api/tasks/${taskId}/comments`, "POST", { body, parentId, mentionIds: ids });
      setDetail((d) => (d ? { ...d, comments: [...d.comments, res.comment] } : d));
      setReplyTo(null);
      setMentionIds([]);
      router.refresh();
    } catch (e) {
      setComment(body);
      push({ title: "Comment failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setSending(false);
    }
  }

  function addMention(memberId: string) {
    const m = members.find((x) => x.id === memberId);
    if (!m) return;
    setMentionIds((ids) => (ids.includes(m.id) ? ids : [...ids, m.id].slice(0, 10)));
    setComment((c) => `${c}${c && !c.endsWith(" ") ? " " : ""}@${m.name} `);
  }

  async function addDep() {
    if (!taskId || !depPick) return;
    try {
      await api(`/api/tasks/${taskId}/dependencies`, "POST", { dependsOnId: depPick });
      setDepPick("");
      await fetchDetail(taskId);
      router.refresh();
    } catch (e) {
      push({ title: "Dependency rejected", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  async function removeDep(depId: string) {
    if (!taskId) return;
    try {
      await api(`/api/tasks/${taskId}/dependencies`, "DELETE", { dependsOnId: depId });
      await fetchDetail(taskId);
      router.refresh();
    } catch (e) {
      push({ title: "Could not remove dependency", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  const project = detail ? projects.find((p) => p.id === detail.projectId) : undefined;
  const depOptions = detail
    ? allTasks.filter((t) => t.id !== detail.id && !detail.blockedBy.some((d) => d.id === t.id))
    : [];

  return (
    <>
      {loading || (!detail && !error) ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error ? (
        <div className="p-6">
          <EmptyState icon="alert" title="Task unavailable" body={error} action={<Button variant="outline" onClick={onClose}>Close</Button>} />
        </div>
      ) : detail ? (
        <>
          {/* header */}
          <div className="border-b border-line px-5 pb-4 pt-5">
            <div className="flex items-center gap-2">
              {project && (
                <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-semibold" style={{ color: project.color, borderColor: `${project.color}44`, background: `${project.color}12` }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
                  {project.key}
                </span>
              )}
              {detail.risk && <RiskPill score={detail.risk.score} band={detail.risk.band} />}
              {detail.blockedBy.some((d) => d.status !== "done") && (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-300">
                  <Icon name="block" size={10} /> Blocked
                </span>
              )}
              <span className="flex-1" />
              <Tip label="Delete task (undo available)">
                <button onClick={removeTask} className="rounded-lg p-1.5 text-mist-500 hover:bg-rose-500/15 hover:text-rose-300" aria-label="Delete task">
                  <Icon name="trash" size={15} />
                </button>
              </Tip>
              <button onClick={onClose} className="rounded-lg p-1.5 text-mist-500 hover:bg-ink-700 hover:text-mist-200" aria-label="Close">
                <Icon name="x" size={16} />
              </button>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== detail.title && patch({ title: title.trim() })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="panel-title mt-3 w-full bg-transparent text-lg font-semibold text-mist-100 outline-none placeholder:text-mist-600 focus:rounded-md focus:ring-2 focus:ring-pulse-500/40"
              aria-label="Task title"
              maxLength={200}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select
                value={detail.status}
                onChange={(e) => {
                  const next = e.target.value as TaskStatus;
                  if (canTransition(detail.status, next)) void patch({ status: next });
                }}
                className="h-8 w-auto py-0 text-[12.5px]"
                style={{ color: STATUS_HEX[detail.status] }}
                aria-label="Status"
              >
                <option value={detail.status}>{STATUS_LABEL[detail.status]}</option>
                {nextStatuses(detail.status).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
              <Select value={detail.priority} onChange={(e) => patch({ priority: e.target.value })} className="h-8 w-auto py-0 text-[12.5px]" aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
              <PriorityBadge priority={detail.priority} />
            </div>
          </div>

          {/* tabs */}
          <div className="flex gap-1 border-b border-line px-5 pt-2">
            {(
              [
                ["details", "Details"],
                ["risk", "Risk"],
                ["activity", `Activity · ${detail.events.length}`],
                ["comments", `Comments · ${detail.comments.length}`],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "relative rounded-t-lg px-3 py-2 text-[12.5px] font-semibold transition-colors",
                  tab === t ? "text-pulse-300" : "text-mist-500 hover:text-mist-300",
                )}
              >
                {label}
                {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-pulse-400 to-cyan-400" />}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === "details" && (
              <div className="space-y-5 animate-fade">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-mist-600">Assignee</p>
                    <Select value={detail.assignee?.id ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })} className="h-8.5 py-0 text-[12.5px]">
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-mist-600">Due date</p>
                    <Input
                      type="date"
                      className="h-8.5 py-0 text-[12.5px]"
                      value={detail.dueDate ? detail.dueDate.slice(0, 10) : ""}
                      onChange={(e) => patch({ dueDate: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-mist-600">Estimate (pts)</p>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      className="h-8.5 py-0 text-[12.5px]"
                      value={estimateText}
                      placeholder="—"
                      onChange={(e) => setEstimateText(e.target.value)}
                      onBlur={() => {
                        const next = estimateText === "" ? null : Number(estimateText);
                        if (next !== detail.estimatePoints && (next === null || (next >= 0 && next <= 100))) {
                          void patch({ estimatePoints: next });
                        }
                      }}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-mist-600">Project</p>
                    <Select value={detail.projectId} onChange={(e) => patch({ projectId: e.target.value })} className="h-8.5 py-0 text-[12.5px]">
                      {projects.filter((p) => !p.archived || p.id === detail.projectId).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-mist-600">Description</p>
                  <Textarea
                    rows={4}
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    onBlur={() => desc !== detail.description && patch({ description: desc })}
                    placeholder="Add context, acceptance criteria, links…"
                  />
                </div>

                <div>
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-mist-600">Labels</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {detail.labels.map((label) => (
                      <button key={label} onClick={() => patch({ labels: detail.labels.filter((x) => x !== label) })} title="Remove label" className="group">
                        <TagChip tag={label} />
                      </button>
                    ))}
                    <Input
                      className="h-6.5 w-28 rounded px-2 py-0 font-mono text-[11px]"
                      placeholder="+ label ⏎"
                      onKeyDown={(e) => {
                        const value = (e.target as HTMLInputElement).value.trim().toLowerCase();
                        if (e.key === "Enter" && value && !detail.labels.includes(value)) {
                          e.preventDefault();
                          void patch({ labels: [...detail.labels, value].slice(0, 8) });
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                  </div>
                </div>

                {detail.parent && (
                  <div className="rounded-xl border border-pulse-500/25 bg-pulse-600/8 p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-pulse-300">Subtask of</p>
                    <button onClick={() => onOpenTask(detail.parent?.id ?? "")} className="text-left text-[12.5px] font-semibold text-mist-200 hover:text-pulse-300">
                      {detail.parent.title}
                    </button>
                  </div>
                )}

                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-mist-600">Subtasks</p>
                    <span className="font-mono text-[10px] text-mist-600">{detail.completedSubtaskCount}/{detail.subtaskCount}</span>
                    <span className="flex-1" />
                    {!detail.parentTaskId && (
                      <Button size="xs" variant="outline" onClick={() => openCreate({ parentTaskId: detail.id, projectId: detail.projectId })}>
                        <Icon name="plus" size={11} /> Add subtask
                      </Button>
                    )}
                  </div>
                  {detail.subtasks.length === 0 ? (
                    <p className="text-[12px] text-mist-600">No subtasks yet. Break this task into smaller, independently tracked work.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.subtasks.map((child) => (
                        <button key={child.id} onClick={() => onOpenTask(child.id)} className="flex w-full items-center gap-2 rounded-lg border border-line bg-ink-850 px-2.5 py-2 text-left hover:border-pulse-600/50">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_HEX[child.status] }} />
                          <span className="min-w-0 flex-1 truncate text-[12px] text-mist-300">{child.title}</span>
                          <span className="text-[10px] text-mist-600">{STATUS_LABEL[child.status]}</span>
                          {child.assignee && <Avatar name={child.assignee.name} hue={child.assignee.avatarHue} size={19} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-mist-600">Blocked by</p>
                  {detail.blockedBy.length === 0 ? (
                    <p className="text-[12.5px] text-mist-600">No blockers — this task can flow freely.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.blockedBy.map((d) => (
                        <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line bg-ink-850 px-2.5 py-2">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_HEX[d.status] }} />
                          <button onClick={() => onOpenTask(d.id)} className="flex-1 truncate text-left text-[12.5px] text-mist-300 hover:text-pulse-300">
                            {d.title}
                          </button>
                          <span className="text-[10px] text-mist-600">{STATUS_LABEL[d.status]}</span>
                          <button onClick={() => removeDep(d.id)} className="text-mist-600 hover:text-rose-300" aria-label="Remove dependency">
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Select value={depPick} onChange={(e) => setDepPick(e.target.value)} className="h-8 flex-1 py-0 text-[12px]">
                      <option value="">Add a blocker…</option>
                      {depOptions.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </Select>
                    <Button size="sm" variant="outline" onClick={addDep} disabled={!depPick}>
                      <Icon name="link" size={12} /> Link
                    </Button>
                  </div>
                  {detail.blocks.length > 0 && (
                    <p className="mt-2 text-[11.5px] text-mist-600">
                      This task blocks: {detail.blocks.map((b) => b.title).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            )}

            {tab === "risk" && (
              <div className="animate-fade">
                {detail.risk ? (
                  <RiskBreakdown detail={detail} />
                ) : (
                  <EmptyState icon="check" title="Completed — no active risk" body="Risk scoring applies to open tasks. Reopen this task to score it again." />
                )}
              </div>
            )}

            {tab === "activity" && (
              <div className="animate-fade space-y-0.5">
                {detail.events.map((e, i) => (
                  <div key={e.id} className="relative flex gap-3 pb-4">
                    {i < detail.events.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-line" />}
                    <span
                      className={cn(
                        "z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                        e.type === "completed" ? "border-lime-400/40 bg-lime-400/15 text-lime-300"
                          : e.type === "reopened" || e.type === "deleted" ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                          : "border-line bg-ink-800 text-mist-400",
                      )}
                    >
                      <Icon name={EVENT_ICON[e.type] ?? "history"} size={11} />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-[12.5px] leading-4.5 text-mist-300">
                        <b className="text-mist-100">{e.actor?.name ?? "System"}</b> {eventText(e)}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-mist-600">{timeAgo(e.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "comments" && (
              <div className="animate-fade space-y-4">
                {detail.comments.length === 0 ? (
                  <EmptyState icon="message" title="No comments yet" body="Decisions and context live here — mention teammates with @ to notify them." />
                ) : (
                  detail.comments.filter((c) => !c.parentId).map((thread) => (
                    <div key={thread.id} className="space-y-2">
                      <CommentBubble c={thread} onReply={() => setReplyTo({ id: thread.id, author: thread.author?.name ?? "comment" })} />
                      {detail.comments.filter((r) => r.parentId === thread.id).map((r) => (
                        <div key={r.id} className="ml-9 border-l border-line pl-3">
                          <CommentBubble c={r} />
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* footer */}
          <div className="border-t border-line px-5 py-3">
            {tab === "comments" ? (
              <div className="space-y-2">
                {replyTo && (
                  <p className="flex items-center gap-2 rounded-md bg-pulse-600/10 px-2 py-1 text-[11.5px] text-pulse-200">
                    <Icon name="undo" size={11} /> Replying to {replyTo.author}
                    <button onClick={() => setReplyTo(null)} className="ml-auto text-mist-500 hover:text-mist-200" aria-label="Cancel reply"><Icon name="x" size={11} /></button>
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <Textarea
                    rows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendComment();
                    }}
                    placeholder={replyTo ? "Write a reply… (⌘↵ to send)" : "Write a comment… (⌘↵ to send)"}
                    className="flex-1"
                    aria-label="Comment"
                  />
                  <div className="flex flex-col gap-1.5">
                    <Select value="" onChange={(e) => e.target.value && addMention(e.target.value)} className="h-8 w-[120px] py-0 text-[11.5px]" aria-label="Mention a teammate">
                      <option value="">@ Mention…</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select>
                    <Button size="sm" onClick={() => void sendComment()} disabled={sending || !comment.trim()}>
                      {sending ? <Spinner size={13} /> : <Icon name="send" size={13} />} Send
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-mist-600">
                <span>created {timeAgo(detail.createdAt)}</span>
                <span>·</span>
                <span>updated {timeAgo(detail.updatedAt)}</span>
                {detail.startedAt && (
                  <>
                    <span>·</span>
                    <span>started {timeAgo(detail.startedAt)}</span>
                  </>
                )}
                {detail.completedAt && (
                  <>
                    <span>·</span>
                    <span className="text-lime-400/80">completed {timeAgo(detail.completedAt)}</span>
                  </>
                )}
              </p>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}

const CONFIDENCE_TEXT: Record<string, string> = {
  high: "High confidence — the inputs are complete.",
  medium: "Medium confidence — some inputs are estimated.",
  low: "Low confidence — key inputs are missing; treat the score as a range.",
};

function RiskBreakdown({ detail }: { detail: TaskDetailDTO }) {
  const risk = detail.risk;
  if (!risk) return null;
  const color = RISK_HEX[risk.band];
  const R = 44;
  const C = 2 * Math.PI * R;
  const sorted = [...risk.factors].sort((a, b) => b.contribution - a.contribution);
  const spansBands = risk.bandRange.from !== risk.bandRange.to;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-5">
        <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`Risk score ${risk.score} of 100, ${risk.band}; plausible range ${risk.interval.low} to ${risk.interval.high}`}>
          <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="55" cy="55" r={R} fill="none" stroke="#1c2947" strokeWidth="9" />
            <circle cx="55" cy="55" r={R} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="9"
              strokeDasharray={`${(C * (risk.interval.high - risk.interval.low)) / 100} ${C}`}
              strokeDashoffset={-(C * risk.interval.low) / 100} />
            <circle cx="55" cy="55" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - risk.score / 100)} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-2xl font-bold" style={{ color }}>{risk.score}</span>
            <span className="font-mono text-[9.5px] text-mist-500">{risk.interval.low}–{risk.interval.high}</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="panel-title text-sm font-semibold capitalize" style={{ color }}>
            {risk.band} deadline risk{spansBands && <span className="ml-1 font-normal normal-case text-mist-400">(could be {risk.bandRange.from}–{risk.bandRange.to})</span>}
          </p>
          <p className="mt-1 text-[12.5px] leading-5 text-mist-400">{CONFIDENCE_TEXT[risk.confidence]}</p>
          {risk.missingInputs.length > 0 && (
            <p className="mt-1 text-[11.5px] text-amber-300">Missing: {risk.missingInputs.join(", ")}</p>
          )}
          <p className="mt-1.5 font-mono text-[10.5px] text-mist-600">
            model v{risk.modelVersion} · config rev {risk.configRevision} · velocity {risk.velocity.pointsPerDay} pt/day ({risk.velocity.source})
          </p>
        </div>
      </div>
      <ul className="space-y-2.5" aria-label="Contributing factors">
        {sorted.map((f) => (
          <li key={f.key} className="rounded-xl border border-line bg-ink-850 p-3">
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[12.5px] font-semibold text-mist-200">
                {f.label}{f.missing && <span className="ml-1.5 rounded bg-amber-400/15 px-1 text-[9.5px] font-semibold uppercase text-amber-300">estimated</span>}
              </p>
              <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-mist-400">w={f.weight}</span>
              <span className="font-mono text-[12px] font-bold" style={{ color }}>+{f.contribution}</span>
            </div>
            <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700" aria-hidden="true">
              <div className="absolute h-full rounded-full opacity-30" style={{ left: `${f.low * 100}%`, width: `${(f.high - f.low) * 100}%`, background: color }} />
              <div className="h-full rounded-full" style={{ width: `${f.value * 100}%`, background: `linear-gradient(90deg, ${color}66, ${color})` }} />
            </div>
            <p className="mt-1.5 text-[11.5px] leading-4 text-mist-500">
              {f.explanation} <span className="font-mono text-mist-600">value {f.value}{f.low !== f.high ? ` (range ${f.low}–${f.high})` : ""}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-4 text-mist-600">
        Score = Σ contributions = {risk.score}. The shaded band shows the plausible range when inputs are missing or estimated.
      </p>
    </div>
  );
}

function CommentBubble({ c, onReply }: { c: TaskDetailDTO["comments"][number]; onReply?: () => void }) {
  const names = c.mentions.map((m) => `@${m.name}`);
  const parts = names.length
    ? c.body.split(new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g"))
    : [c.body];
  return (
    <div className="flex gap-2.5">
      {c.author ? <Avatar name={c.author.name} hue={c.author.avatarHue} size={26} /> : <span className="h-[26px] w-[26px] rounded-full bg-ink-700" />}
      <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-line bg-ink-850 px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <p className="text-[12.5px] font-semibold text-mist-100">{c.author?.name ?? "Former member"}</p>
          <p className="font-mono text-[10px] text-mist-600">{timeAgo(c.createdAt)}</p>
          {onReply && (
            <button onClick={onReply} className="ml-auto text-[11px] font-semibold text-mist-500 hover:text-pulse-300">Reply</button>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-mist-300">
          {parts.map((part, i) => (names.includes(part) ? <span key={i} className="rounded bg-pulse-600/20 px-0.5 font-medium text-pulse-200">{part}</span> : <span key={i}>{part}</span>))}
        </p>
      </div>
    </div>
  );
}
