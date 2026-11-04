> Historical phase record. These results describe the earlier implementation. Current MongoDB setup,
> migration status, and freshly observed checks are in MONGODB_MIGRATION.md and ARCHITECTURE.md.

# Implementation Tracker

Legend: [x] done · [~] done with documented environment limitation · [ ] pending

## Phase 1 hardening pass (scaffold & design-system completeness, re-verified)
- [x] shadcn/ui setup formalized: `components.json` (new-york, RSC, css vars) + primitives at `src/components/ui/` — CLI-compatible; existing `@/components/ui` imports unchanged
- [x] Environment validation: `src/server/env.ts` (Zod, lazy singleton, pure `parseEnv`), wired into `src/db` and the AI provider; 6 new unit tests
- [x] Route-level states: branded root `loading`, per-segment layout-matched skeletons (dashboard/board/analytics/page), `error.tsx` (root + in-shell), `global-error.tsx`, styled 404 (root + app segment) — all accessible (`role=alert`, `aria-busy`, `aria-live`)
- [x] Shell a11y: skip-to-content link (first tab stop), focusable `#main-content`, `aria-current="page"` on active nav
- [x] ESLint brought to **0 errors / 0 warnings**: replaced 4 setState-in-effect cascades with React's guarded render-time prop sync; documented the App-Router false-positive font rule
- [x] Defect found by QA & fixed: server reconciliation arriving mid-drag could cancel an active drag → task-state sync now defers until dragend (verified with repeated bidirectional drags)
- [x] Security refinement found by QA & fixed: login throttle counted successful logins (lockout of legitimate users) → now failure-only with reset on success; brute force still capped
- [x] Phase 1 browser QA (`scripts/qa-phase1.mjs`): **10/10 passed, zero runtime errors** (skip link, aria-current, drag both directions, 404 status+content, mobile slide-over nav)
- Note: no fake auth or analytics exist anywhere — authentication and analytics are the real implementations from Phases 2–6; Phase 1 structures host them.

## Phase 0 — Specification & plan
- [x] Inspect repository/environment (Next 16.2.6, React 19, Tailwind v4, Drizzle + local Postgres)
- [x] PROJECT_SPEC.md, ARCHITECTURE.md, TASKS.md, DECISIONS.md
- [x] Record environment-driven deviations (ADR-001 persistence, ADR-002 auth)

## Phase 1 — Scaffold & design system
- [x] Tailwind v4 theme tokens, fonts, layered background, scrollbars, motion
- [x] UI primitives (Button, Input, Select, Badge, Modal/Drawer via Radix, Toasts+Undo, Avatar, EmptyState, Skeleton)

## Phase 2 — Auth, workspaces, authorization (v2: explicit RBAC hardening)
- [x] scrypt password module + hashed opaque sessions + Origin check + failure-only login throttle
- [x] register/login/logout/me routes; guarded `/app` layout
- [x] Workspaces + memberships; invite/role/remove; workspace create/switch/rename; leave semantics
- [x] **Four explicit roles** owner > admin > project_manager > member; DB enum migrated non-destructively (`ALTER TYPE … ADD VALUE`, verified via psql)
- [x] **Capability matrix** `src/server/auth/permissions.ts` (18 capabilities, monotonic ladder, pure + unit-tested); single enforcement path `requireMembership` + `ensureCan` on every mutating service call
- [x] Owner protections: not removable/demotable, cannot leave; role changes owner-exclusive; `owner` not assignable (Zod); admins remove strictly-lower ranks
- [x] Tenant scoping: every query filtered by membership-verified workspaceId; cross-tenant → 404 (no existence disclosure)
- [x] UI gating mirrors matrix (settings/projects/shell) — server re-checks regardless
- [x] Secrets: `.gitignore` excludes `.env*` (only `.env.example` placeholders tracked); no credentials in source
- [x] **Negative tests** (`e2e/security.spec.ts`, all observed passing): 30 unauthenticated route probes → 401; member/PM/admin capability violations → 403; 9 cross-workspace reads + 16 mutations → 404; owner protection → 400; leave/remove → immediate revocation; Zod → 400; CSRF → 403; full register→workspace→invite→promote→leave lifecycle
- [x] Unit tests: permission matrix integrity/monotonicity/explicit role grants (20), role enum contracts in Zod (2)
- [x] Browser QA of role-based UI (10/10): PM sees project controls but no invite/role UI; owner sees full governance; labels/badges render

## Phase 3 — Projects, tasks, dependencies, history
- [x] Projects CRUD + archive; Tasks CRUD + soft delete/restore (undo)
- [x] Status lifecycle sets started_at/completed_at; append-only task_events
- [x] Dependencies with server-side cycle prevention; board DnD + list sort + positions; bulk ops

## Phase 3 v2 — Tasks, subtasks, lifecycle, concurrency (validated during Phase 4 work)
- [x] Legal status transition graph (`src/lib/domain/lifecycle.ts`), enforced server-side and mirrored in board/drawer
- [x] One-level subtasks (`parent_task_id`, same project), labels (normalized; `tags` kept as a deprecated alias), server-side filtered/sorted pagination (`GET /api/tasks` page envelope)
- [x] Optimistic concurrency: `tasks.version`; PATCH/DELETE require `expectedVersion` (409 on stale), bulk requires per-task revisions (428 if missing); conditional `UPDATE … WHERE version = ?` inside row-locked transactions
- [x] Workspace-scoped dependency rows (`task_dependencies.workspace_id`, backfilled from tasks before NOT NULL) and per-workspace locking for cycle checks/position allocation
- [x] Assignment events persist stable user ids (display names resolved at read time); event-sourced lead/cycle derivation with reopen semantics (unit-tested)
- [x] Indexes: status/position, project/status, assignee, due, parent, label GIN, dependency reverse, event (ws,type,created)/(task,created)
- [x] Defect found & fixed: board bulk-undo needed new revisions, but bulk returned only `affected` → now returns `expected` revisions
- [x] Older suites updated to the revision contract (no checks weakened; smoke gained 409/428 assertions)

## Phase 4 — Collaboration (observed results)
- [x] Comments with one-level replies (reply-to-reply and cross-task parents rejected) and validated mentions (members only, ≤10)
- [x] Notification triggers: assignment, mention, reply, comment, status, deadline_soon (≤24h), overdue
- [x] Recipient planning (`src/lib/domain/notifications.ts`): one notification per person per comment with precedence mention > reply > comment; actor never self-notified; non-members excluded
- [x] Duplicate prevention: unique `(user_id, dedupe_key)` + `ON CONFLICT DO NOTHING`; deadline keys embed the due instant (stable across sweeps, re-alerts if the deadline moves)
- [x] Deadline sweep runs on each notification poll for the caller's own tasks (no background workers); sweep failures are logged and never hide existing notifications
- [x] Unread/read: per-item toggle, mark-all, unread count, `unreadOnly` filter; updates scoped to the caller (foreign ids → 0 rows)
- [x] Keyset pagination (opaque `(created_at,id)` cursors, malformed → 400) for comments (oldest-first threads + replies), activity (workspace/project/task, newest-first) and notifications
- [x] Project activity feeds (`/app/activity?project=…`, linked from project cards)
- [x] Refresh strategy: 30s polling + refresh on tab focus; older pages preserved; transient poll failures keep last state
- [x] Tests: 9 domain unit tests (triggers, precedence, dedupe keys, deadline boundaries, cursor validation); `e2e/collaboration.spec.ts` 6 live tests (triggers, deadline dedupe, read/unread scope, visibility incl. cross-tenant + unauthenticated, pagination on 3 feeds, failure handling with no side effects); browser QA `scripts/qa-phase4.mjs` 10/10
- [ ] Not implemented (by design): realtime push (SSE/websockets), email delivery, comment edit/delete, notification preferences

## Phase 5 — Deterministic analytics
- [x] Pure domain: throughput/net, EWMA, percentiles, cycle/lead, on-time, WIP, CFD from events, forecast
- [x] Risk model (6 weighted factors, explainable contributions)
- [x] Vitest suites for every formula (counts reported in delivery summary)

## Phase 6 — Dashboards & explainability
- [x] Dashboard KPIs, Recharts throughput+EWMA, D3 CFD + cycle histogram, risk queue, workload
- [x] Analytics page: window/α/bins controls, definition panels, CSV/JSON export

## Phase 7 — Optional AI
- [x] Provider interface; deterministic narrator (default, labelled); OpenAI-compatible provider behind env key

## Phase 8 — Quality (observed results)
- [x] Vitest: **46/46 passed** (analytics math, risk invariants, cycle prevention, Zod contracts, scrypt/tokens, deterministic narrator)
- [x] Live integration smoke (`scripts/smoke.mjs`): **39/39 passed** — auth, CSRF origin, tenant isolation (cross-tenant → 404 on read/write/bulk/members/analytics), lifecycle events, cycle rejection, delete/undo/bulk, notifications, validation
- [x] Playwright E2E: **4/4 passed** in headless Chromium (browsers + system deps installed in-sandbox)
- [x] Visual QA (`scripts/qa.mjs`): 10 screenshots desktop 1440px + mobile 390px; **zero console/page errors**
- [x] Defect found & fixed: unlayered `.field` CSS overrode Tailwind width/height utilities (cascade layers) → moved component classes into `@layer components`; Insights panel height capped; histogram tick density reduced

## Phase 9 — Build & deployment docs (observed results)
- [x] .env.example, deterministic seed (118 tasks / 547 events), README run/deploy instructions
- [x] `next typegen` ✓ · `tsc --noEmit` ✓ (strict, no `any`) · `next build` ✓ · `/api/health` ✓ via platform build_and_start
- Environment-dependent notes: MongoDB Atlas not available (ADR-001); OPENAI_API_KEY unset → AI provider path untested against live OpenAI, deterministic mode verified; email invites intentionally replaced by one-time credentials (documented)

## Phase 5 — Deterministic analytics (observed results)
- [x] Dedicated domain module `src/lib/analytics/` (pure: no IO, no UI, no AI provider): time zones and DST, half-open
      local-day windows, event replay, nearest-rank statistics, half-up rounding, filters, report assembly
- [x] Metrics: throughput (created/completed/reopened/net), created-cohort completion rate, on-time rate, overdue
      count and share with age, cycle and lead time (count/mean/P50/P85/min/max), active and queued estimated
      workload with coverage, Monday-start weekly trends, blocked-task analysis with top blockers
- [x] Eligibility, reopen, deletion, missing-estimate, empty-dataset and rounding rules implemented and documented in
      `ANALYTICS.md` (formulas, boundaries, limitations per metric; PROJECT_SPEC §5 updated to point at it)
- [x] Persistence adapter with SQL `GROUP BY` for per-day counts (MongoDB unavailable: see ADR-001 and ADR-016)
- [x] Authorized service (membership, `analytics.read`, project-filter scope, input validation) and
      `GET /api/analytics/report` (days, tz, asOf, projectId, assigneeId, priority, label)
- [x] Dashboard flow metrics (throughput, timing, on-time, daily series, totals) now come from the same report;
      `StatSummary` values are nullable (no-data is null, not 0); UI shows “—”
- [x] Removed fabricated figures from the login brand panel (they were hardcoded, not computed)
- [x] Unit tests: **82** analytics tests across 5 files (hand-calculated fixture: 38 report, 14 time, 9 timeline,
      9 stats, plus the 12 integration tests below)
- [x] Database integration: **12** tests against PostgreSQL. SQL report equals pure report; SQL daily counts equal
      event-derived counts for 6 filter sets × 3 time zones; authorization and validation
- [x] Mutation checks: float nearest rank caught (1 failure); cohort ignoring deletion caught (5); SQL time zone
      hardcoded caught (1). An end-inclusive window survives, which is an equivalent mutant (see ANALYTICS.md §9)
- [x] Live endpoint check `scripts/analytics-live.mjs`: **30/30** (auth, tenancy, validation, consistency, replay, filters)
- [x] Full Vitest run: **170/170** across 15 files
- [x] Playwright (incl. existing security spec): **14/14** after reinstalling the Chromium cache
- [x] Smoke `scripts/smoke.mjs`: **41/41**; browser QA phase 1 **10/10**, phase 4 **10/10**
- [~] Browser QA phase 2 (`scripts/qa-phase2.mjs`): **10/10** against the current file. The Phase 2 summary reported
      21 checks, which this workspace's file does not contain (file has 10 assertions). Not reconstructed here.
- [~] `scripts/authz-tests.mjs` (the 97-check Phase 2 script) is **absent** from the workspace. Its coverage is
      repeated in `e2e/security.spec.ts`, which passes in this run. The 97 count is not re-observed in this phase.
- Environment: Chromium cache was cleared between turns; reinstalled with `npx playwright install chromium` + deps.
- Limitations are listed in ANALYTICS.md §11 (current-value attributes, current-state dependency edges, blocked time
  not measured, gross reopen counting, points not hours, O(workspace history) replay).

## Phase 6 — Dashboard and deadline risk (observed results)
- [x] `GET /api/dashboard` (Phase 5 query contract: days, tz, asOf, project, assignee, priority, label — Zod 400s, foreign project 404, membership + analytics.read)
- [x] Dashboard: 8 summary cards, completion trend, cycle-time trend (P50/P85), workload distribution with capacity line, overdue list, project progress, blocked tasks with blockers and duration, ranked risk with intervals and confidence; URL-synced filters; loading, empty, error (retry) states
- [x] Accessibility: figures with title, summary and a data table from the same data; explicit label/select pairing; progressbars and risk items carry accessible values
- [x] Risk model v2.0.0 (RISK.md): configurable per workspace, revisioned, admin-only writes, used by board, drawer, analytics, dashboard and AI narrator
- [x] Defects found by tests and screenshots, fixed: wrapped labels polluted filter accessible names; "HIGH" confidence badge read as high risk; contradictory estimate-coverage copy; truncated axis labels
- [x] Tests: Vitest 192/192 (21 risk + 13 dashboard fixture→chart-data tests new); Playwright 22/22 incl. `e2e/dashboard.spec.ts` 8/8 (UI cells == API, filter refetch, empty/error states, config versioning, authz); smoke 43/43 (v1 checks replaced by stricter v2 checks); analytics-live 30/30; QA scripts 10/10 ×3
- One dashboard e2e run failed during a server restart (login timeout); two immediate reruns passed 8/8.

## Phase 7 — Optional AI insights (observed results)
- [x] Provider-independent server interface: evidence bundle in, validated insights out; OpenAI-compatible client is one implementation (`src/lib/ai/*`, `src/server/modules/ai/*`)
- [x] Model receives only authorized aggregates + ≤12 task references from the caller's dashboard — no DB access; prompt privacy asserted in tests (no foreign ids, no credentials)
- [x] Facts vs suggestions (`kind`), every item cites evidence ids; citations validated against the bundle; invalid items dropped and counted (`droppedInvalid` shown in UI)
- [x] Failure handling: timeout (abort), 429 rate_limited, 401/403 auth, 5xx/network server, bad_output — all classified and fallback to the deterministic narrator with an honest note; `mode:"ai"` only for validated model output
- [x] Per-user rate limit 10/10min → HTTP 429 with retry hint; limiter unit-tested with injected clock
- [x] Secrets server-side only (env-validated, Authorization header only — asserted); core analytics unaffected with AI disabled (verified live)
- [x] Tests: 31 new (evidence builder, output validation, rate limiter, deterministic narrator, mocked-fetch OpenAI client incl. payload privacy); mutation checks: citation filter removal → 2 failures, timeout classification removal → 1 failure; both restored
- [x] AI.md: configuration, cost model, privacy, limitations; ADR-018; .env.example updated (AI_MODEL, AI_TIMEOUT_MS)
- [~] Live AI path untestable in sandbox (no OPENAI_API_KEY); deterministic path verified live (scripts/ai-live.mjs)

## Phase 8 — Repository-wide audit (observed results; see AUDIT.md)
- [x] Audited auth, authorization, tenant isolation, Zod validation, SQL queries/indexes, dependencies,
      analytics correctness, error handling and secret management; 11 findings documented with severity
- [x] Fixed root causes: Next 16.2.6 critical advisory → 16.4.4; postcss high → 8.5.32 (+ non-breaking
      transitive fixes); session rotation; atomic registration/invite with 23505→409 race handling;
      fail-closed CSRF host check; duplicate-notification dedupe key; env-driven `drizzle.config.ts`
      (deleted hardcoded-credential JSON); typed AI fetch mocks (`any` removed)
- [x] Fixed two defects introduced/found during the audit itself: cyclic-`cause` infinite loop in
      `isUniqueViolation`, and the audit test's `__dirname`-rooted filesystem walk
- [x] New tests: 38 unit (static route/secret/type audit, CSRF, error mapping, env knobs, dedupe) +
      18 E2E (session rotation/revocation, duplicate registration, cross-workspace 10 reads/5 writes,
      empty datasets, date boundaries incl. DST and days=1/366, duplicate requests, failed external
      service UI state, full project→task→comment→completion journey)
- [x] Observed final gates: lint 0/0 · typegen ✓ · tsc ✓ · Vitest **258/258 (22 files)** · build ✓ ·
      `build_and_start` ✓ health 200 · Playwright **40/40** · smoke 44/44 · analytics-live 30/30 ·
      ai-live 17/17 · browser QA 10/10 ×3 · `drizzle-kit push` ✓ with TS config
- [x] `npm audit`: 28 (1 critical, 5 high, 21 moderate, 1 low) → **19 moderate, 0 critical/high/low**
- [x] Fixed cross-suite flake (F12): AI insights limiter is per-user; dashboard E2E, `ai-live` and `smoke` now use fresh invited users instead of sharing the seeded account. No assertion weakened; Playwright 40/40 twice, smoke 44/44 twice, ai-live 17/17 twice.
- [~] Checks that could not run and 8 unresolved risks with severities are listed in AUDIT.md §5–§6;
      **no production-readiness claim** is made

## Backlog (post-v1)
- [ ] Realtime updates (SSE), email invites, MongoDB Atlas adapter if mandated, Auth.js migration when Next 16 support stabilizes