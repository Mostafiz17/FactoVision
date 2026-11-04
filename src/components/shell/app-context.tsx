"use client";

import { createContext, useContext } from "react";
import type { TaskStatus, WorkspaceDTO } from "@/lib/domain/types";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  avatarHue: number;
}

export interface CreateDefaults {
  status?: TaskStatus;
  projectId?: string;
  parentTaskId?: string;
}

export interface AppCtx {
  user: AppUser;
  workspace: WorkspaceDTO | null;
  openTask: (id: string) => void;
  openCreate: (defaults?: CreateDefaults) => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppShell");
  return ctx;
}