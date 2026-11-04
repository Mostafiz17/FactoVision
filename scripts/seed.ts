/**
 * Deterministic demo seed. Creates the "Nova Product Lab" workspace with a
 * believable 60-day event history so every chart shows real, reproducible math.
 * Run: npx tsx scripts/seed.ts   (demo password for all users: demo1234)
 */
import { loadScriptEnv } from "./env";
import { randomUUID } from "node:crypto";
import { closeDatabase, withTransaction } from "../src/db";
import { store } from "../src/db/repository";
import type { DbTask } from "../src/db/schema";
import { hashPassword } from "../src/server/auth/password";
import type { EventType, Priority, TaskStatus } from "../src/lib/domain/types";

/* Deterministic PRNG (mulberry32) */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260214);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number, hourJitter = true): Date =>
  new Date(NOW - days * DAY - (hourJitter ? Math.floor(rnd() * 8) * 3_600_000 : 0));

const usedTitles = new Set<string>();
function title(verbs: string[], objects: string[]): string {
  for (let i = 0; i < 40; i++) {
    const t = `${pick(verbs)} ${pick(objects)}`;
    if (!usedTitles.has(t)) {
      usedTitles.add(t);
      return t;
    }
  }
  const t = `${pick(verbs)} ${pick(objects)} · phase ${usedTitles.size}`;
  usedTitles.add(t);
  return t;
}

const VERBS = ["Ship", "Refactor", "Polish", "Instrument", "Harden", "Migrate", "Design", "Test", "Profile", "Document"];
const OBJECTS: Record<string, string[]> = {
  ATL: ["onboarding flow", "billing webhook retries", "board virtualization", "SSO callback handling", "CSV export", "notification digest", "keyboard shortcuts", "empty states", "rate limiter", "session refresh", "audit log", "dark-mode tokens", "command palette", "avatar uploads", "search indexing", "toast queue", "focus traps", "skeleton loaders", "error boundaries", "invite links"],
  MOB: ["push permission priming", "offline cache", "gesture navigation", "haptic feedback", "deep links", "widget snapshot", "biometric unlock", "sync conflict UI", "badge counts", "share sheet", "low-power mode", "app icon variants", "crash breadcrumbs", "startup trace"],
  DAT: ["event ingestion schema", "rollup jobs", "retention policy", "percentile UDFs", "backfill runner", "dbt models", "anomaly flags", "warehouse indexes", "PII scrubbing", "CDC connector", "partition pruning", "freshness alerts", "cost dashboards", "query fingerprints"],
};
const TAGS = ["frontend", "backend", "design", "infra", "api", "ux", "bug", "research", "perf", "a11y"];
const PRIORITIES_POOL: Priority[] = ["low", "medium", "medium", "medium", "high", "high", "urgent"];
const POINTS = [1, 2, 2, 3, 3, 5, 5, 8];

interface EvRow {
  id: string; workspaceId: string; taskId: string; actorId: string;
  type: EventType; fromValue: string | null; toValue: string | null; createdAt: Date;
}

async function main(): Promise<void> {
  loadScriptEnv();
  console.log("Seeding empty FactoVision demo database…");
  if (process.env.NODE_ENV === "production") throw new Error("Demo seed is disabled in production");
  if (await store.users.count({}) > 0) throw new Error("Seed requires an empty database; no existing data was changed");
  const summary = await withTransaction(async () => {

  const passwordHash = await hashPassword("demo1234");
  const mkUser = (name: string, email: string, hue: number) => ({ id: randomUUID(), name, email, passwordHash, avatarHue: hue });
  const ava = mkUser("Ava Chen", "ava@cadence.dev", 258);
  const noah = mkUser("Noah Park", "noah@cadence.dev", 190);
  const mira = mkUser("Mira Solis", "mira@cadence.dev", 320);
  const leo = mkUser("Leo Fontaine", "leo@cadence.dev", 32);
  const zoe = mkUser("Zoe Okafor", "zoe@cadence.dev", 96);
  await store.users.insertMany([ava, noah, mira, leo, zoe]);
  const team = [ava, noah, mira, leo, zoe];
  const doers = [mira, mira, leo, leo, leo, zoe, noah, ava];

  const ws = { id: randomUUID(), name: "Nova Product Lab", slug: "nova-product-lab", createdBy: ava.id };
  await store.workspaces.insert(ws);
  await store.memberships.insertMany([
    { workspaceId: ws.id, userId: ava.id, role: "owner" as const },
    { workspaceId: ws.id, userId: noah.id, role: "admin" as const },
    { workspaceId: ws.id, userId: mira.id, role: "project_manager" as const },
    { workspaceId: ws.id, userId: leo.id, role: "member" as const },
    { workspaceId: ws.id, userId: zoe.id, role: "member" as const },
  ]);

  const atlas = { id: randomUUID(), workspaceId: ws.id, name: "Atlas Web App", key: "ATL", color: "#7c5cff", description: "Customer-facing workspace: board, dashboards, collaboration." };
  const mobile = { id: randomUUID(), workspaceId: ws.id, name: "Mobile Companion", key: "MOB", color: "#22d3ee", description: "iOS/Android companion with offline-first sync." };
  const data = { id: randomUUID(), workspaceId: ws.id, name: "Data Platform", key: "DAT", color: "#a3e635", description: "Event pipeline, warehouse models and analytics rollups." };
  await store.projects.insertMany([atlas, mobile, data]);
  const projectPool = [atlas, atlas, atlas, mobile, mobile, data, data];

  type TaskRow = Partial<DbTask>;
  const taskRows: TaskRow[] = [];
  const eventRows: EvRow[] = [];
  const ev = (taskId: string, actorId: string, type: EventType, from: string | null, to: string | null, at: Date) =>
    eventRows.push({ id: randomUUID(), workspaceId: ws.id, taskId, actorId, type, fromValue: from, toValue: to, createdAt: at });

  const columnPos: Record<string, number> = {};
  const nextPos = (s: TaskStatus) => (columnPos[s] = (columnPos[s] ?? -1) + 1);

  /* ---- ~90 historically completed tasks across 60 days ---- */
  const completedIds: string[] = [];
  for (let d = 60; d >= 1; d--) {
    const dow = new Date(NOW - d * DAY).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    let count = weekend ? (rnd() < 0.3 ? 1 : 0) : 1 + Math.floor(rnd() * 3);
    if (!weekend && rnd() < 0.22) count += 1; // burst days
    for (let i = 0; i < count; i++) {
      const project = pick(projectPool);
      const assignee = pick(doers);
      const cycle = 0.4 + Math.pow(rnd(), 1.5) * 6.2;
      const lead = cycle + 0.3 + rnd() * 5;
      const completedAt = ago(d);
      const startedAt = new Date(completedAt.getTime() - cycle * DAY);
      const createdAt = new Date(completedAt.getTime() - lead * DAY);
      const dueDate = new Date(completedAt.getTime() + (rnd() < 0.82 ? rnd() * 3 : -(0.2 + rnd() * 2)) * DAY);
      const viaReview = rnd() < 0.65;
      const id = randomUUID();
      const t: TaskRow = {
        id, workspaceId: ws.id, projectId: project.id,
        title: title(VERBS, OBJECTS[project.key]),
        description: "Delivered and verified against acceptance criteria.",
        status: "done", priority: pick(PRIORITIES_POOL), assigneeId: assignee.id, creatorId: pick(team).id,
        estimatePoints: rnd() < 0.14 ? null : pick(POINTS), dueDate,
        position: nextPos("done"), tags: [pick(TAGS), ...(rnd() < 0.4 ? [pick(TAGS)] : [])],
        startedAt, completedAt, statusSince: completedAt, createdAt, updatedAt: completedAt,
      };
      taskRows.push(t);
      completedIds.push(id);
      ev(id, t.creatorId ?? ava.id, "created", null, "todo", createdAt);
      ev(id, ava.id, "assigned", null, assignee.id, new Date(createdAt.getTime() + 3_600_000));
      ev(id, assignee.id, "status_changed", "todo", "in_progress", startedAt);
      if (viaReview) ev(id, assignee.id, "status_changed", "in_progress", "review", new Date(completedAt.getTime() - 0.25 * cycle * DAY));
      ev(id, assignee.id, "completed", viaReview ? "review" : "in_progress", "done", completedAt);
    }
  }

  /* ---- open tasks with intentional risk stories ---- */
  interface OpenSpec {
    project: typeof atlas; title: string; status: TaskStatus; priority: Priority;
    assignee: (typeof team)[number] | null; ageDays: number; statusAge: number;
    dueIn: number | null; points: number | null; tags: string[]; desc: string;
  }
  const openSpecs: OpenSpec[] = [
    { project: atlas, title: "Fix payment retry double-charge", status: "in_progress", priority: "urgent", assignee: leo, ageDays: 9, statusAge: 6, dueIn: -2, points: 5, tags: ["bug", "backend"], desc: "Stripe webhook retries can double-apply credits. Idempotency keys are missing on the retry path." },
    { project: atlas, title: "Ship workspace audit log", status: "in_progress", priority: "high", assignee: leo, ageDays: 12, statusAge: 8, dueIn: 1, points: 8, tags: ["backend", "api"], desc: "Append-only audit trail for admin actions with export." },
    { project: mobile, title: "Offline sync conflict resolution UI", status: "in_progress", priority: "high", assignee: leo, ageDays: 7, statusAge: 4, dueIn: 3, points: 8, tags: ["ux", "frontend"], desc: "Three-way merge view for conflicting edits made offline." },
    { project: data, title: "Backfill percentile rollups", status: "review", priority: "high", assignee: leo, ageDays: 6, statusAge: 2, dueIn: 2, points: 3, tags: ["infra"], desc: "Recompute P50/P85 rollups for the last 90 days." },
    { project: atlas, title: "Board drag performance on Safari", status: "in_progress", priority: "medium", assignee: mira, ageDays: 4, statusAge: 2, dueIn: 5, points: 3, tags: ["perf", "frontend"], desc: "Drag ghost flickers at 120Hz; profile compositing layers." },
    { project: atlas, title: "Redesign notification center", status: "review", priority: "medium", assignee: mira, ageDays: 8, statusAge: 1, dueIn: 6, points: 5, tags: ["design", "ux"], desc: "Grouped by day, unread affordances, keyboard navigation." },
    { project: data, title: "PII scrubbing for event exports", status: "in_progress", priority: "high", assignee: zoe, ageDays: 5, statusAge: 3, dueIn: -1, points: 5, tags: ["backend", "infra"], desc: "Hash emails and strip IPs in warehouse exports." },
    { project: mobile, title: "Biometric unlock fallback flow", status: "review", priority: "medium", assignee: zoe, ageDays: 3, statusAge: 1, dueIn: 8, points: 2, tags: ["frontend"], desc: "Passcode fallback when Face ID fails twice." },
    { project: atlas, title: "Keyboard shortcut cheat sheet", status: "todo", priority: "low", assignee: ava, ageDays: 10, statusAge: 10, dueIn: 14, points: 1, tags: ["ux", "a11y"], desc: "Press ? to open the shortcut overlay." },
    { project: atlas, title: "Granular role permissions matrix", status: "todo", priority: "high", assignee: noah, ageDays: 6, statusAge: 6, dueIn: 2, points: 8, tags: ["backend", "api"], desc: "Per-project permission overrides for members." },
    { project: data, title: "Freshness alert thresholds", status: "todo", priority: "medium", assignee: zoe, ageDays: 4, statusAge: 4, dueIn: 7, points: 3, tags: ["infra"], desc: "Page when ingestion lag exceeds 15 minutes." },
    { project: mobile, title: "Widget snapshot renderer", status: "todo", priority: "medium", assignee: null, ageDays: 15, statusAge: 15, dueIn: 4, points: 5, tags: ["frontend"], desc: "Server-rendered widget snapshots for iOS home screen." },
    { project: atlas, title: "Public API rate limit headers", status: "todo", priority: "low", assignee: noah, ageDays: 3, statusAge: 3, dueIn: null, points: 2, tags: ["api"], desc: "X-RateLimit-* headers per RFC draft." },
    { project: data, title: "Warehouse cost attribution tags", status: "backlog", priority: "medium", assignee: null, ageDays: 20, statusAge: 20, dueIn: null, points: null, tags: ["infra", "research"], desc: "Tag queries by team for chargeback." },
    { project: mobile, title: "Android predictive back gesture", status: "backlog", priority: "low", assignee: null, ageDays: 18, statusAge: 18, dueIn: null, points: 3, tags: ["frontend"], desc: "Adopt predictive back ahead of API 35 requirement." },
    { project: atlas, title: "Realtime presence avatars", status: "backlog", priority: "medium", assignee: null, ageDays: 12, statusAge: 12, dueIn: 21, points: 5, tags: ["frontend", "research"], desc: "SSE-based presence with cursor colors." },
    { project: data, title: "Anomaly detection spike", status: "backlog", priority: "low", assignee: null, ageDays: 25, statusAge: 25, dueIn: null, points: null, tags: ["research"], desc: "Evaluate z-score vs seasonal decomposition on throughput." },
    { project: atlas, title: "Import from Jira CSV", status: "backlog", priority: "medium", assignee: ava, ageDays: 9, statusAge: 9, dueIn: 30, points: 5, tags: ["backend"], desc: "Map epics→projects, sprints→tags." },
  ];
  const openIds: Record<string, string> = {};
  for (const s of openSpecs) {
    const id = randomUUID();
    openIds[s.title] = id;
    const createdAt = ago(s.ageDays);
    const statusSince = ago(s.statusAge);
    const started = s.status === "in_progress" || s.status === "review";
    taskRows.push({
      id, workspaceId: ws.id, projectId: s.project.id, title: s.title, description: s.desc,
      status: s.status, priority: s.priority, assigneeId: s.assignee?.id ?? null, creatorId: ava.id,
      estimatePoints: s.points, dueDate: s.dueIn === null ? null : new Date(NOW + s.dueIn * DAY),
      position: nextPos(s.status), tags: s.tags,
      startedAt: started ? statusSince : null, completedAt: null, statusSince, createdAt, updatedAt: statusSince,
    });
    ev(id, ava.id, "created", null, "backlog", createdAt);
    if (s.assignee) ev(id, ava.id, "assigned", null, s.assignee.id, new Date(createdAt.getTime() + 7_200_000));
    if (s.status !== "backlog") ev(id, s.assignee?.id ?? ava.id, "status_changed", "backlog", "todo", new Date(createdAt.getTime() + DAY * 0.5));
    if (started) ev(id, s.assignee?.id ?? ava.id, "status_changed", "todo", "in_progress", statusSince);
    if (s.status === "review") ev(id, s.assignee?.id ?? ava.id, "status_changed", "in_progress", "review", ago(Math.max(0.2, s.statusAge - 1)));
  }

  /* ---- three reopened tasks (rework shows up honestly in analytics) ---- */
  const reopenSpecs = [
    { title: "Session refresh race on tab wake", project: atlas, assignee: mira, doneAgo: 6, reopenAgo: 3 },
    { title: "Badge count drift after sync", project: mobile, assignee: zoe, doneAgo: 9, reopenAgo: 5 },
    { title: "Rollup job timezone offset", project: data, assignee: noah, doneAgo: 4, reopenAgo: 2 },
  ];
  for (const r of reopenSpecs) {
    const id = randomUUID();
    openIds[r.title] = id;
    const createdAt = ago(r.doneAgo + 5);
    const startedAt = ago(r.doneAgo + 2);
    const doneAt = ago(r.doneAgo);
    const reopenedAt = ago(r.reopenAgo);
    taskRows.push({
      id, workspaceId: ws.id, projectId: r.project.id, title: r.title,
      description: "Reopened after QA found an edge case — see comments.",
      status: "in_progress", priority: "high", assigneeId: r.assignee.id, creatorId: ava.id,
      estimatePoints: 3, dueDate: new Date(NOW + 2 * DAY), position: nextPos("in_progress"),
      tags: ["bug"], startedAt: reopenedAt, completedAt: null, statusSince: reopenedAt, createdAt, updatedAt: reopenedAt,
    });
    ev(id, ava.id, "created", null, "todo", createdAt);
    ev(id, r.assignee.id, "status_changed", "todo", "in_progress", startedAt);
    ev(id, r.assignee.id, "completed", "in_progress", "done", doneAt);
    ev(id, ava.id, "reopened", "done", "todo", reopenedAt);
    ev(id, r.assignee.id, "status_changed", "todo", "in_progress", reopenedAt);
  }

  await store.tasks.insertMany(taskRows);

  /* ---- dependencies (blocked stories) ---- */
  const depPairs: [string, string][] = [
    [openIds["Ship workspace audit log"], openIds["Granular role permissions matrix"]],
    [openIds["Offline sync conflict resolution UI"], openIds["Widget snapshot renderer"]],
    [openIds["Fix payment retry double-charge"], openIds["Public API rate limit headers"]],
    [openIds["Backfill percentile rollups"], completedIds[completedIds.length - 1]],
    [openIds["Redesign notification center"], openIds["Keyboard shortcut cheat sheet"]],
  ];
  await store.taskDependencies.insertMany(depPairs.map(([taskId, dependsOnId]) => ({ workspaceId: ws.id, taskId, dependsOnId, createdAt: ago(1.5) })));
  for (const [taskId] of depPairs) ev(taskId, ava.id, "dependency_added", null, "linked blocker", ago(1.5));

  await store.taskEvents.insertMany(eventRows);

  /* ---- comments ---- */
  const commentSpecs: { taskKey: string; author: (typeof team)[number]; body: string; daysAgo: number }[] = [
    { taskKey: "Fix payment retry double-charge", author: ava, body: "Repro: kill the worker mid-retry, replay the webhook. Credits apply twice. Blocking release.", daysAgo: 1.8 },
    { taskKey: "Fix payment retry double-charge", author: leo, body: "Root cause found — idempotency key is regenerated on retry. Patch up tomorrow, needs a migration.", daysAgo: 0.9 },
    { taskKey: "Offline sync conflict resolution UI", author: mira, body: "Design uploaded the three-way merge mock. Left pane = server, right = local, center = merged.", daysAgo: 2.5 },
    { taskKey: "Offline sync conflict resolution UI", author: leo, body: "Blocked until the widget snapshot renderer lands the shared serializer.", daysAgo: 1.2 },
    { taskKey: "Redesign notification center", author: zoe, body: "Keyboard nav verified with VoiceOver. One nit: unread dot contrast on hover.", daysAgo: 0.6 },
    { taskKey: "PII scrubbing for event exports", author: noah, body: "Legal signed off on SHA-256 + per-workspace salt. Don't log raw emails in the backfill.", daysAgo: 1.4 },
    { taskKey: "Session refresh race on tab wake", author: mira, body: "QA edge case: two tabs waking simultaneously both refresh and one token gets revoked. Adding a mutex.", daysAgo: 2.2 },
    { taskKey: "Rollup job timezone offset", author: noah, body: "Bucketing now uses UTC day keys everywhere — matching the analytics definitions doc.", daysAgo: 1.1 },
  ];
  const commentRows = commentSpecs.map((c) => ({
    id: randomUUID(), workspaceId: ws.id, taskId: openIds[c.taskKey], authorId: c.author.id,
    body: c.body, createdAt: ago(c.daysAgo),
  }));
  await store.comments.insertMany(commentRows);
  for (const c of commentSpecs) ev(openIds[c.taskKey], c.author.id, "commented", null, c.body.slice(0, 80), ago(c.daysAgo));

  /* ---- notifications for Ava (2 unread) ---- */
  await store.notifications.insertMany([
    { workspaceId: ws.id, userId: ava.id, actorId: leo.id, taskId: openIds["Fix payment retry double-charge"], kind: "comment", message: "commented on “Fix payment retry double-charge”", createdAt: ago(0.9), readAt: null },
    { workspaceId: ws.id, userId: ava.id, actorId: zoe.id, taskId: openIds["Redesign notification center"], kind: "comment", message: "commented on “Redesign notification center”", createdAt: ago(0.6), readAt: null },
    { workspaceId: ws.id, userId: ava.id, actorId: mira.id, taskId: openIds["Session refresh race on tab wake"], kind: "status", message: "reopened “Session refresh race on tab wake”", createdAt: ago(3), readAt: ago(2.5) },
    { workspaceId: ws.id, userId: ava.id, actorId: noah.id, taskId: openIds["Granular role permissions matrix"], kind: "assigned", message: "was assigned “Granular role permissions matrix”", createdAt: ago(5), readAt: ago(4.5) },
    { workspaceId: ws.id, userId: ava.id, actorId: leo.id, taskId: openIds["Backfill percentile rollups"], kind: "status", message: "moved “Backfill percentile rollups” to review", createdAt: ago(2), readAt: ago(1.5) },
  ]);

  /* ---- saved views for Ava ---- */
  await store.savedViews.insertMany([
    {
      workspaceId: ws.id, userId: ava.id, name: "High priority · Atlas",
      config: { q: "", projectId: atlas.id, assigneeId: "", priority: "high", tag: "", sort: "risk", layout: "board" },
    },
    {
      workspaceId: ws.id, userId: ava.id, name: "Leo's load",
      config: { q: "", projectId: "", assigneeId: leo.id, priority: "", tag: "", sort: "due", layout: "list" },
    },
  ]);

  return { users: team.length, tasks: taskRows.length, completed: completedIds.length, events: eventRows.length, comments: commentRows.length };
  });
  console.log("Seed committed:", summary);
  console.log("Demo login: ava@cadence.dev / demo1234 (also noah@, mira@, leo@, zoe@cadence.dev)");
  await closeDatabase();
}

main().catch(async () => {
  console.error("Demo seed failed; check MongoDB configuration and ensure the target is empty. No partial seed is committed.");
  await closeDatabase();
  process.exit(1);
});
