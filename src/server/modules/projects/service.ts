import { store, workspaceTransaction } from "@/db/repository";
import type { DbMembership, DbProject } from "@/db/schema";
import type { ProjectDTO } from "@/lib/domain/types";
import { ensureCan, requireMembership } from "@/server/auth/guard";
import { ApiError } from "@/server/http";
import type { z } from "zod";
import type { projectCreateSchema, projectPatchSchema } from "@/server/validation";

function toDTO(p: DbProject, taskCount: number, doneCount: number): ProjectDTO {
  return { id: p.id, name: p.name, key: p.key, color: p.color, description: p.description, archived: p.archived === 1, createdAt: p.createdAt.toISOString(), taskCount, doneCount };
}
export async function listProjects(userId: string, workspaceId: string): Promise<ProjectDTO[]> {
  await requireMembership(userId, workspaceId);
  const rows = await store.projects.find({ workspaceId }, { sort: { createdAt: 1 } });
  const taskRows = await store.tasks.find({ workspaceId, deletedAt: null });
  return rows.map((p) => {
    const children = taskRows.filter((t) => t.projectId === p.id);
    return toDTO(p, children.length, children.filter((t) => t.status === "done").length);
  });
}
export async function createProject(userId: string, input: z.infer<typeof projectCreateSchema>): Promise<ProjectDTO> {
  return workspaceTransaction(input.workspaceId, async () => {
    const membership = await requireMembership(userId, input.workspaceId);
    ensureCan(membership.role, "project.create");
    const key = input.key ?? input.name.split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 4).padEnd(2, "X");
    return toDTO(await store.projects.insert({ workspaceId: input.workspaceId, name: input.name, key, color: input.color, description: input.description ?? "" }), 0, 0);
  });
}
async function loadProject(userId: string, projectId: string): Promise<{ project: DbProject; membership: DbMembership }> {
  const project = await store.projects.one({ id: projectId });
  if (!project) throw new ApiError(404, "Project not found");
  return { project, membership: await requireMembership(userId, project.workspaceId) };
}
export async function updateProject(userId: string, projectId: string, input: z.infer<typeof projectPatchSchema>): Promise<ProjectDTO> {
  const original = await loadProject(userId, projectId);
  return workspaceTransaction(original.project.workspaceId, async () => {
    const { project, membership } = await loadProject(userId, projectId);
    ensureCan(membership.role, input.archived !== undefined ? "project.archive" : "project.edit");
    const saved = await store.projects.update({ id: projectId, workspaceId: project.workspaceId }, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.archived !== undefined ? { archived: input.archived ? 1 : 0 } : {}),
    });
    if (!saved) throw new ApiError(404, "Project not found");
    return toDTO(saved, 0, 0);
  });
}
/** Explicit transactional cascades replace foreign-key deletion behavior. */
export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const original = await loadProject(userId, projectId);
  await workspaceTransaction(original.project.workspaceId, async () => {
    const { project, membership } = await loadProject(userId, projectId);
    ensureCan(membership.role, "project.delete");
    const workspaceId = project.workspaceId;
    const ids = (await store.tasks.find({ workspaceId, projectId })).map((t) => t.id);
    await store.taskDependencies.remove({ workspaceId, $or: [{ taskId: { $in: ids } }, { dependsOnId: { $in: ids } }] });
    await store.taskEvents.remove({ workspaceId, taskId: { $in: ids } });
    await store.comments.remove({ workspaceId, taskId: { $in: ids } });
    await store.notifications.remove({ workspaceId, taskId: { $in: ids } });
    await store.tasks.updateMany({ workspaceId, parentTaskId: { $in: ids } }, { parentTaskId: null });
    await store.tasks.remove({ workspaceId, projectId });
    await store.projects.remove({ id: projectId, workspaceId });
  });
}
