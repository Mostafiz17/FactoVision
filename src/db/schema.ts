import type { EventType, Priority, Role, TaskStatus } from "@/lib/domain/types";

// UUID string IDs and references, including MongoDB _id; sessions use token hashes.
// Never convert these IDs to ObjectId: the public API remains UUID-based.
export interface Entity { id: string; createdAt: Date }
export interface DbUser extends Entity { email: string; name: string; passwordHash: string; avatarHue: number }
export interface DbInvitation extends Entity { workspaceId: string; email: string; role: Exclude<Role, "owner">; invitedBy: string; expiresAt: Date }
export interface DbAuthLimit extends Entity { count: number; expiresAt: Date }
export interface DbSession extends Entity { userId: string; expiresAt: Date }
export interface DbWorkspace extends Entity { name: string; slug: string; createdBy: string | null; mutationVersion: number }
export interface DbMembership extends Entity { workspaceId: string; userId: string; role: Role }
export interface DbProject extends Entity { workspaceId: string; name: string; key: string; color: string; description: string; archived: number }
export interface DbTask extends Entity {
  workspaceId: string; projectId: string; title: string; description: string;
  status: TaskStatus; priority: Priority; assigneeId: string | null; creatorId: string | null;
  parentTaskId: string | null; estimatePoints: number | null; dueDate: Date | null;
  position: number; tags: string[]; version: number; startedAt: Date | null;
  completedAt: Date | null; statusSince: Date; deletedAt: Date | null; updatedAt: Date;
}
export interface DbDependency extends Entity { workspaceId: string; taskId: string; dependsOnId: string }
export interface DbTaskEvent extends Entity { workspaceId: string; taskId: string; actorId: string | null; type: EventType; fromValue: string | null; toValue: string | null }
export interface DbComment extends Entity { workspaceId: string; taskId: string; authorId: string | null; parentCommentId: string | null; mentions: string[]; body: string }
export interface DbNotification extends Entity { workspaceId: string; userId: string; actorId: string | null; taskId: string | null; kind: string; message: string; dedupeKey: string | null; readAt: Date | null }
export interface DbSavedView extends Entity { workspaceId: string; userId: string; name: string; config: unknown }
export interface DbRiskConfig extends Entity { workspaceId: string; modelVersion: string; revision: number; config: unknown; updatedBy: string | null; updatedAt: Date }
export interface Collections {
  invitations: DbInvitation; auth_limits: DbAuthLimit;
  users: DbUser; sessions: DbSession; workspaces: DbWorkspace; memberships: DbMembership;
  projects: DbProject; tasks: DbTask; task_dependencies: DbDependency; task_events: DbTaskEvent;
  comments: DbComment; notifications: DbNotification; saved_views: DbSavedView; risk_configs: DbRiskConfig;
}
