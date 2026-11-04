"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, type MemberDTO, type ProjectDTO } from "@/lib/domain/types";
import { Button, FieldLabel, Input, Select, Spinner, Textarea } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { useToast } from "@/components/toast";
import type { CreateDefaults } from "@/components/shell/app-context";

export function TaskFormModal({
  open,
  defaults,
  onClose,
  workspaceId,
}: {
  open: boolean;
  defaults: CreateDefaults;
  onClose: () => void;
  workspaceId: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={defaults.parentTaskId ? "New subtask" : "New task"} subtitle="Task lifecycle events are recorded atomically with each change." wide>
      {open && <TaskForm key={workspaceId} defaults={defaults} onClose={onClose} workspaceId={workspaceId} />}
    </Modal>
  );
}

function TaskForm({ defaults: initialDefaults, onClose, workspaceId }: {
  defaults: CreateDefaults;
  onClose: () => void;
  workspaceId: string;
}) {
  // Capture defaults for this opening; subsequent parent renders must not erase edits.
  const [defaults] = useState(initialDefaults);
  const router = useRouter();
  const { push } = useToast();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [parentTitle, setParentTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<string>(defaults.status ?? "backlog");
  const [priority, setPriority] = useState("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [estimate, setEstimate] = useState("");
  const [due, setDue] = useState("");
  const [labels, setLabels] = useState("");

  useEffect(() => {
    let active = true;
    const parentRequest = defaults.parentTaskId
      ? api<{ task: { title: string } }>(`/api/tasks/${defaults.parentTaskId}`)
      : Promise.resolve(null);
    Promise.all([
      api<{ projects: ProjectDTO[] }>(`/api/projects?workspaceId=${workspaceId}`),
      api<{ members: MemberDTO[] }>(`/api/workspaces/${workspaceId}/members`),
      parentRequest,
    ])
      .then(([projectResult, memberResult, parentResult]) => {
        if (!active) return;
        const activeProjects = projectResult.projects.filter((project) => !project.archived);
        setProjects(activeProjects);
        setMembers(memberResult.members);
        setProjectId(defaults.projectId ?? activeProjects[0]?.id ?? "");
        setParentTitle(parentResult?.task.title ?? null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        push({ title: "Could not load projects", description: error instanceof Error ? error.message : undefined, tone: "error" });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [defaults, workspaceId, push]);

  async function submit() {
    if (!title.trim() || !projectId) return;
    setBusy(true);
    try {
      await api("/api/tasks", "POST", {
        workspaceId,
        projectId,
        parentTaskId: defaults.parentTaskId ?? null,
        title: title.trim(),
        description,
        status,
        priority,
        assigneeId: assigneeId || null,
        estimatePoints: estimate === "" ? null : Number(estimate),
        dueDate: due || null,
        labels: labels.split(",").map((label) => label.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      });
      push({ title: defaults.parentTaskId ? "Subtask created" : "Task created", description: title.trim(), tone: "success" });
      onClose();
      router.refresh();
    } catch (error) {
      push({ title: "Could not create task", description: error instanceof Error ? error.message : undefined, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-pulse-300"><Spinner size={22} /></div>
      ) : projects.length === 0 ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm text-amber-300">Create a project first — tasks always belong to one.</p>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-4">
          {defaults.parentTaskId && (
            <p className="rounded-lg border border-pulse-500/30 bg-pulse-600/10 px-3 py-2 text-[12px] text-pulse-200">
              Subtask of <b>{parentTitle ?? "the selected task"}</b> · subtasks stay in the parent’s project.
            </p>
          )}
          <div>
            <FieldLabel>Title</FieldLabel>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ship the thing" autoFocus required maxLength={200} />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Context, acceptance criteria, links…" maxLength={8000} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <FieldLabel>Project</FieldLabel>
              <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={!!defaults.parentTaskId}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>Status</FieldLabel>
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <Select value={priority} onChange={(event) => setPriority(event.target.value)}>
                {PRIORITIES.map((value) => <option key={value} value={value}>{PRIORITY_LABEL[value]}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>Assignee</FieldLabel>
              <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>Estimate (pts)</FieldLabel>
              <Input type="number" min={0} max={100} step={1} value={estimate} onChange={(event) => setEstimate(event.target.value)} placeholder="—" />
            </div>
            <div>
              <FieldLabel>Due date</FieldLabel>
              <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </div>
          </div>
          <div>
            <FieldLabel>Labels <span className="normal-case text-mist-600">(comma separated)</span></FieldLabel>
            <Input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder="frontend, perf" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !title.trim()}>{busy && <Spinner size={14} />} Create task</Button>
          </div>
        </form>
      )}
    </>
  );
}
