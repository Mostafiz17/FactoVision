"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import type { NotificationDTO, NotificationPageDTO, Role, WorkspaceDTO } from "@/lib/domain/types";
import { ROLE_LABEL } from "@/lib/domain/types";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar, Button, EmptyState, Input, FieldLabel } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Modal, Popover, PopoverContent, PopoverTrigger } from "@/components/overlays";
import { useToast } from "@/components/toast";
import { AppContext, type AppUser, type CreateDefaults } from "./app-context";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: "Mission control", icon: "pulse" },
  { href: "/app/board", label: "Board", icon: "board" },
  { href: "/app/projects", label: "Projects", icon: "folder" },
  { href: "/app/analytics", label: "Analytics", icon: "chart" },
  { href: "/app/activity", label: "Activity", icon: "history" },
  { href: "/app/settings", label: "Settings", icon: "settings" },
];

function persistWorkspace(browserDocument: Document, id: string) {
  browserDocument.cookie = `cadence_ws=${id}; path=/; max-age=31536000; samesite=lax`;
}

export function AppShell({
  user,
  workspaces,
  workspace,
  notifications: initialFeed,
  children,
}: {
  user: AppUser;
  workspaces: WorkspaceDTO[];
  workspace: WorkspaceDTO | null;
  notifications: NotificationPageDTO;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();
  const [mobileNav, setMobileNav] = useState(false);
  const taskId = useSearchParams().get("task");
  const [createDefaults, setCreateDefaults] = useState<CreateDefaults | null>(null);
  const [newWsOpen, setNewWsOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [wsBusy, setWsBusy] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [feed, setFeed] = useState<NotificationPageDTO>(initialFeed);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const notifications = feed.items;
  const unread = feed.unreadCount;

  /*
   * Polling strategy (no realtime infra configured): refresh the first page every
   * 30s and whenever the tab regains focus. Older pages fetched via the cursor are
   * preserved; ids are de-duplicated. Each poll also runs the server-side
   * deadline sweep, so due-soon/overdue alerts appear without background jobs.
   */
  const refreshNotifications = useCallback(async () => {
    if (!workspace) return;
    try {
      const page = await api<NotificationPageDTO>(`/api/notifications?workspaceId=${workspace.id}&limit=20`);
      setFeed((prev) => {
        const fresh = new Set(page.items.map((n) => n.id));
        const older = prev.items.filter((n) => !fresh.has(n.id) && page.items.length > 0 && n.createdAt < page.items[page.items.length - 1].createdAt);
        return { items: [...page.items, ...older], nextCursor: older.length > 0 ? prev.nextCursor : page.nextCursor, unreadCount: page.unreadCount };
      });
    } catch {
      /* transient polling failure: keep last known state, retry on next tick */
    }
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    const timer = window.setInterval(() => void refreshNotifications(), 30_000);
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshNotifications();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [workspace, refreshNotifications]);

  async function loadOlderNotifications() {
    if (!workspace || !feed.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api<NotificationPageDTO>(`/api/notifications?workspaceId=${workspace.id}&limit=20&cursor=${encodeURIComponent(feed.nextCursor)}`);
      setFeed((prev) => {
        const known = new Set(prev.items.map((n) => n.id));
        return { items: [...prev.items, ...page.items.filter((n) => !known.has(n.id))], nextCursor: page.nextCursor, unreadCount: page.unreadCount };
      });
    } catch (e) {
      push({ title: "Could not load older notifications", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function setRead(ids: string[] | undefined, read: boolean) {
    if (!workspace) return;
    const prev = feed;
    const targets = ids ? new Set(ids) : null;
    const now = new Date().toISOString();
    setFeed((f) => {
      const items = f.items.map((n) => (!targets || targets.has(n.id) ? { ...n, readAt: read ? (n.readAt ?? now) : null } : n));
      const delta = f.items.filter((n) => (!targets || targets.has(n.id)) && (read ? !n.readAt : !!n.readAt)).length;
      return { ...f, items, unreadCount: ids ? Math.max(0, f.unreadCount + (read ? -delta : delta)) : read ? 0 : f.unreadCount + delta };
    });
    try {
      await api("/api/notifications", "PATCH", { workspaceId: workspace.id, ids, read });
    } catch (e) {
      setFeed(prev);
      push({ title: "Could not update notifications", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  const openTask = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("task", id);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const closeTask = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    window.history.replaceState(null, "", url.toString());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = useMemo(
    () => ({ user, workspace, openTask, openCreate: (d?: CreateDefaults) => setCreateDefaults(d ?? {}) }),
    [user, workspace, openTask],
  );

  function switchWorkspace(id: string) {
    persistWorkspace(document, id);
    router.refresh();
  }

  async function createWorkspace() {
    if (!newWsName.trim()) return;
    setWsBusy(true);
    try {
      const res = await api<{ workspace: WorkspaceDTO }>("/api/workspaces", "POST", { name: newWsName.trim() });
      persistWorkspace(document, res.workspace.id);
      setNewWsOpen(false);
      setNewWsName("");
      push({ title: "Workspace created", description: res.workspace.name, tone: "success" });
      router.refresh();
    } catch (e) {
      push({ title: "Could not create workspace", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setWsBusy(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", "POST");
    router.push("/login");
    router.refresh();
  }

  async function markAllRead() {
    await setRead(undefined, true);
  }

  async function openNotification(n: NotificationDTO) {
    if (!n.readAt) void setRead([n.id], true);
    if (n.taskId) openTask(n.taskId);
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV.map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileNav(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all",
              active
                ? "bg-gradient-to-r from-pulse-600/25 to-pulse-600/5 text-mist-100"
                : "text-mist-400 hover:bg-ink-750 hover:text-mist-200",
            )}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-pulse-300 to-pulse-600 shadow-glow" />}
            <Icon name={item.icon} size={16} className={active ? "text-pulse-300" : "text-mist-500 group-hover:text-mist-300"} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-6 pt-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-pulse-400 to-pulse-700 text-white shadow-glow">
          <Icon name="pulse" size={18} />
        </span>
        <div>
          <p className="panel-title text-[15px] font-bold leading-4">{BRAND.name}</p>
          <p className="mt-0.5 text-[10px] font-medium tracking-wide text-mist-500">{BRAND.attribution}</p>
        </div>
      </div>
      {nav}
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <Avatar name={user.name} hue={user.avatarHue} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-mist-200">{user.name}</p>
            <p className="truncate text-[11px] text-mist-600">{workspace ? `${ROLE_LABEL[workspace.role]} · ${workspace.name}` : user.email}</p>
          </div>
          <button onClick={logout} className="rounded-lg p-1.5 text-mist-500 hover:bg-ink-700 hover:text-rose-300" title="Sign out" aria-label="Sign out">
            <Icon name="logout" size={15} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <AppContext.Provider value={ctx}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-pulse-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-glow"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        {/* fixed sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-ink-900/80 backdrop-blur-xl lg:block">
          {sidebar}
        </aside>
        {mobileNav && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm animate-fade" onClick={() => setMobileNav(false)} />
            <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-ink-900 animate-fade">{sidebar}</aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
          {/* sticky topbar */}
          <header className="sticky top-0 z-30 border-b border-line bg-ink-950/75 backdrop-blur-xl">
            <div className="flex h-14 items-center gap-2 px-4 sm:gap-3 sm:px-6">
              <button className="rounded-lg p-2 text-mist-400 hover:bg-ink-750 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation">
                <Icon name="menu" size={17} />
              </button>

              <Menu>
                <MenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-xl border border-line bg-ink-850 px-3 py-1.5 text-[13px] font-semibold text-mist-200 hover:border-pulse-600/60">
                    <span className="h-2 w-2 rounded-full bg-gradient-to-br from-cyan-300 to-pulse-500" />
                    <span className="max-w-[140px] truncate">{workspace?.name ?? "No workspace"}</span>
                    <Icon name="chevDown" size={13} className="text-mist-500" />
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  <MenuLabel>Workspaces</MenuLabel>
                  {workspaces.map((w) => (
                    <MenuItem key={w.id} onSelect={() => switchWorkspace(w.id)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", w.id === workspace?.id ? "bg-lime-400" : "bg-ink-600")} />
                      <span className="flex-1 truncate">{w.name}</span>
                      <span className="text-[10px] uppercase text-mist-600">{ROLE_LABEL[w.role as Role]}</span>
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem onSelect={() => setNewWsOpen(true)}>
                    <Icon name="plus" size={13} /> New workspace
                  </MenuItem>
                </MenuContent>
              </Menu>

              <div className="relative hidden flex-1 sm:block sm:max-w-xs">
                <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-600" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      router.push(`/app/board?q=${encodeURIComponent(search)}`);
                      setSearch("");
                    }
                  }}
                  placeholder="Search tasks…  ( / )"
                  className="field h-8.5 w-full pl-8 text-[13px]"
                  aria-label="Search tasks"
                />
              </div>

              <div className="flex-1 sm:hidden" />

              {workspace && (
                <Button size="sm" onClick={() => setCreateDefaults({})} className="hidden sm:inline-flex">
                  <Icon name="plus" size={14} /> New task
                </Button>
              )}
              {workspace && (
                <button
                  className="rounded-lg bg-pulse-600 p-2 text-white sm:hidden"
                  onClick={() => setCreateDefaults({})}
                  aria-label="New task"
                >
                  <Icon name="plus" size={15} />
                </button>
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <button className="relative rounded-lg p-2 text-mist-400 hover:bg-ink-750 hover:text-mist-100" aria-label={`Notifications (${unread} unread)`}>
                    <Icon name="bell" size={17} />
                    {unread > 0 && (
                      <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[9px] font-bold text-white" style={{ animation: "ping-dot 2s ease-out infinite" }}>
                        {unread}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(360px,calc(100vw-2rem))]">
                  <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                    <p className="panel-title text-[13px] font-semibold">Notifications</p>
                    {unread > 0 && (
                      <button onClick={markAllRead} className="text-[11px] font-semibold text-pulse-300 hover:text-pulse-200">
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-[340px] overflow-y-auto p-1.5">
                    {notifications.length === 0 ? (
                      <p className="px-3 py-8 text-center text-[13px] text-mist-500">Nothing yet — mentions, assignments and status changes land here.</p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={cn(
                            "group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-ink-750",
                            !n.readAt && "bg-pulse-600/8",
                          )}
                        >
                          <button onClick={() => openNotification(n)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                            {n.actor ? (
                              <Avatar name={n.actor.name} hue={n.actor.avatarHue} size={26} />
                            ) : (
                              <span className={cn("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full", n.kind === "overdue" ? "bg-rose-500/20 text-rose-300" : "bg-amber-400/15 text-amber-300")}>
                                <Icon name={n.kind === "overdue" ? "alert" : "clock"} size={13} />
                              </span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12.5px] leading-4.5 text-mist-300">
                                {n.actor ? <><b className="text-mist-100">{n.actor.name}</b> {n.message}</> : <b className="text-mist-100">{n.message}</b>}
                              </span>
                              <span className="mt-0.5 block font-mono text-[10px] text-mist-600">{n.kind.replace("_", " ")} · {timeAgo(n.createdAt)}</span>
                            </span>
                          </button>
                          <button
                            onClick={() => void setRead([n.id], !n.readAt)}
                            className="mt-1 shrink-0 rounded p-0.5 text-mist-600 hover:text-pulse-300"
                            aria-label={n.readAt ? "Mark as unread" : "Mark as read"}
                            title={n.readAt ? "Mark as unread" : "Mark as read"}
                          >
                            <span className={cn("block h-2 w-2 rounded-full border", n.readAt ? "border-mist-600" : "border-pulse-400 bg-pulse-400")} />
                          </button>
                        </div>
                      ))
                    )}
                    {feed.nextCursor && (
                      <button onClick={loadOlderNotifications} disabled={loadingOlder} className="mt-1 w-full rounded-lg py-2 text-center text-[11.5px] font-semibold text-pulse-300 hover:bg-ink-750 disabled:opacity-50">
                        {loadingOlder ? "Loading…" : "Load older"}
                      </button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <Menu>
                <MenuTrigger asChild>
                  <button aria-label="Account menu" className="rounded-full">
                    <Avatar name={user.name} hue={user.avatarHue} size={30} ring />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel>{user.email}</MenuLabel>
                  <MenuItem onSelect={() => router.push("/app/settings")}>
                    <Icon name="settings" size={13} /> Workspace settings
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger onSelect={logout}>
                    <Icon name="logout" size={13} /> Sign out
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </header>

          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
            {workspace ? (
              children
            ) : (
              <div className="mx-auto mt-16 max-w-md">
                <EmptyState
                  icon="layers"
                  title="No workspace yet"
                  body="Create a workspace to start planning projects and generating analytics."
                  action={
                    <Button onClick={() => setNewWsOpen(true)}>
                      <Icon name="plus" size={14} /> Create workspace
                    </Button>
                  }
                />
              </div>
            )}
          </main>
        </div>
      </div>

      {/* global overlays */}
      {workspace && (
        <>
          <TaskDrawer taskId={taskId} onClose={closeTask} workspaceId={workspace.id} onOpenTask={openTask} />
          <TaskFormModal
            open={createDefaults !== null}
            defaults={createDefaults ?? {}}
            onClose={() => setCreateDefaults(null)}
            workspaceId={workspace.id}
          />
        </>
      )}
      <Modal open={newWsOpen} onClose={() => setNewWsOpen(false)} title="New workspace" subtitle="A separate, tenant-isolated space for a team or product.">
        <div className="space-y-4">
          <div>
            <FieldLabel>Workspace name</FieldLabel>
            <Input value={newWsName} onChange={(e) => setNewWsName(e.target.value)} placeholder="Orbital Research" autoFocus maxLength={80} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNewWsOpen(false)}>Cancel</Button>
            <Button onClick={createWorkspace} disabled={wsBusy || !newWsName.trim()}>Create workspace</Button>
          </div>
        </div>
      </Modal>
    </AppContext.Provider>
  );
}
