"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { ProjectDTO, Role } from "@/lib/domain/types";
import { can } from "@/server/auth/permissions";
import { CHART_COLORS, cn } from "@/lib/utils";
import { Button, EmptyState, FieldLabel, Input, Meter, Spinner, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/overlays";
import { useToast } from "@/components/toast";
import { useApp } from "@/components/shell/app-context";

export function ProjectsClient({ projects, workspaceId, role }: { projects: ProjectDTO[]; workspaceId: string; role: Role }) {
  const router = useRouter();
  const { push } = useToast();
  const { openCreate } = useApp();
  const [editing, setEditing] = useState<ProjectDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProjectDTO | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(CHART_COLORS[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const canCreate = can(role, "project.create");
  const canEdit = can(role, "project.edit");
  const canDelete = can(role, "project.delete");

  function openEditor(p: ProjectDTO | "new") {
    setEditing(p);
    if (p === "new") {
      setName("");
      setColor(CHART_COLORS[Math.floor(Math.random() * CHART_COLORS.length)]);
      setDescription("");
    } else {
      setName(p.name);
      setColor(p.color);
      setDescription(p.description);
    }
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (editing === "new") {
        await api("/api/projects", "POST", { workspaceId, name: name.trim(), color, description });
        push({ title: "Project created", description: name.trim(), tone: "success" });
      } else if (editing) {
        await api(`/api/projects/${editing.id}`, "PATCH", { name: name.trim(), color, description });
        push({ title: "Project updated", tone: "success" });
      }
      setEditing(null);
      router.refresh();
    } catch (e) {
      push({ title: "Save failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(p: ProjectDTO) {
    try {
      await api(`/api/projects/${p.id}`, "PATCH", { archived: !p.archived });
      push({ title: p.archived ? "Project unarchived" : "Project archived", description: p.name, tone: "info" });
      router.refresh();
    } catch (e) {
      push({ title: "Action failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/api/projects/${deleting.id}`, "DELETE");
      push({ title: "Project deleted", description: `${deleting.name} and its tasks were removed.`, tone: "info" });
      setDeleting(null);
      router.refresh();
    } catch (e) {
      push({ title: "Delete failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const visible = projects.filter((p) => showArchived || !p.archived);

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="panel-title text-xl font-bold text-mist-100">Projects</h1>
          <p className="text-[12px] text-mist-500">{projects.filter((p) => !p.archived).length} active · {projects.filter((p) => p.archived).length} archived</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-mist-400">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-3.5 w-3.5 accent-[#7c5cff]" />
          Show archived
        </label>
        {canCreate && (
          <Button size="sm" onClick={() => openEditor("new")}>
            <Icon name="plus" size={13} /> New project
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="folder" title="No projects yet" body="Projects group tasks and give the analytics a spine."
          action={<Button size="sm" onClick={() => openEditor("new")}><Icon name="plus" size={13} /> Create the first project</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p, i) => {
            const progress = p.taskCount === 0 ? 0 : (p.doneCount / p.taskCount) * 100;
            return (
              <div key={p.id} className={cn("card card-hover animate-rise relative overflow-hidden p-5", p.archived && "opacity-60")} style={{ animationDelay: `${i * 60}ms` }}>
                <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${p.color}, transparent)` }} />
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl font-mono text-[11px] font-bold" style={{ color: p.color, background: `${p.color}16`, border: `1px solid ${p.color}40` }}>
                    {p.key}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="panel-title truncate text-[15px] font-semibold text-mist-100">{p.name}</p>
                    <p className="text-[11px] text-mist-600">{p.archived ? "Archived" : "Active"} · {p.taskCount} tasks</p>
                  </div>
                  {canEdit && (
                    <button onClick={() => openEditor(p)} className="rounded-lg p-1.5 text-mist-500 hover:bg-ink-700 hover:text-mist-200" aria-label={`Edit ${p.name}`}>
                      <Icon name="edit" size={14} />
                    </button>
                  )}
                </div>
                <p className="mt-3 line-clamp-2 min-h-[2.4em] text-[12.5px] leading-[1.35] text-mist-400">{p.description || "No description."}</p>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between font-mono text-[10.5px] text-mist-500">
                    <span>{p.doneCount}/{p.taskCount} done</span>
                    <span style={{ color: p.color }}>{Math.round(progress)}%</span>
                  </div>
                  <Meter value={progress} color={p.color} />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Link href={`/app/board?project=${p.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full"><Icon name="board" size={12} /> Board</Button>
                  </Link>
                  <Link href={`/app/activity?project=${p.id}`} aria-label={`${p.name} activity`}>
                    <Button variant="ghost" size="sm"><Icon name="history" size={12} /> Activity</Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => openCreate({ projectId: p.id })}><Icon name="plus" size={12} /> Task</Button>
                  {canEdit && (
                    <button onClick={() => toggleArchive(p)} className="rounded-lg p-2 text-mist-500 hover:bg-ink-700 hover:text-amber-300" title={p.archived ? "Unarchive" : "Archive"} aria-label={p.archived ? "Unarchive" : "Archive"}>
                      <Icon name="archive" size={14} />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => setDeleting(p)} className="rounded-lg p-2 text-mist-500 hover:bg-rose-500/15 hover:text-rose-300" title="Delete project" aria-label="Delete project">
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New project" : "Edit project"} subtitle="Color and key flow through boards, cards and charts.">
        <div className="space-y-4">
          <div>
            <FieldLabel>Name</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Atlas Web App" autoFocus maxLength={200} />
          </div>
          <div>
            <FieldLabel>Color</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {CHART_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
                  className={cn("h-8 w-8 rounded-lg border-2 transition-transform", color === c ? "scale-110 border-white" : "border-transparent hover:scale-105")}
                  style={{ background: c }} />
              ))}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded-lg border border-line bg-ink-900" aria-label="Custom color" />
            </div>
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={8000} placeholder="What ships from here?" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !name.trim()}>{busy && <Spinner size={14} />} Save project</Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete project?" subtitle="This permanently removes the project and all of its tasks, events and comments.">
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-300">
          <b>{deleting?.name}</b> holds {deleting?.taskCount} tasks. Analytics will recompute without them. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Keep it</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={busy}>{busy && <Spinner size={14} />} Delete forever</Button>
        </div>
      </Modal>
    </div>
  );
}