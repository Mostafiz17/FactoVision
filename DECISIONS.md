# Architecture Decision Records

Current persistence is defined by ADR-001 and MONGODB_MIGRATION.md. SQL-specific details
in older phase records below describe historical implementation, not current setup instructions.

## ADR-001 ? MongoDB Atlas with the official Node.js driver (supersedes the original deviation)
The user requires Atlas. All active persistence now uses typed native-driver repositories,
UUID string IDs/references, BSON dates, explicit indexes/validators, and multi-document transactions.
Workspace coordination writes replace row locks; reference validation and transactional cascades
replace foreign keys. No legacy database adapter or dual-write path remains.
Environment: MONGODB_URI and MONGODB_DB. See ARCHITECTURE.md and MONGODB_MIGRATION.md.
**Status:** Implemented in source; Atlas provisioning/data cutover are separate deployment steps.

## ADR-002 — Session auth module instead of a third-party auth library
**Context.** Installed framework is Next.js 16.2.6 / React 19.2.6. Auth.js v5 is still beta with
unproven Next 16 support; Better-Auth requires CLI-generated schema and brings its own migration
surface; no OAuth secrets or email service exist in the sandbox, so any library would reduce to
credentials + sessions anyway.
**Decision.** Implement a minimal OWASP-ASVS-aligned module: scrypt hashing, 256-bit CSPRNG opaque
tokens stored as SHA-256 hashes, HttpOnly/SameSite=Lax cookies, 7-day expiry, login rotation, per-IP
throttling, Origin checks. Fully unit-tested. Migration path to Auth.js recorded in backlog.
**Status.** Accepted; revisit when a maintained library certifies Next 16 compatibility.

## ADR-003 — Modular monolith, pure domain core
Services own business rules and authorization; route handlers are thin adapters; analytics/risk math is
pure TypeScript with zero IO, enabling exhaustive deterministic unit tests. No microservices.

## ADR-004 — Event-sourced history for analytics
All flow metrics derive from the append-only `task_events` log (not mutable task fields), so reopens,
re-assignments, and historical WIP are reconstructable. Current-state fields are a projection kept in
the same transaction as the event write.

## ADR-005 — Deterministic-first AI
`InsightsProvider` interface with a rule-based deterministic narrator (always available, clearly
labelled) and an OpenAI-compatible provider enabled only when `OPENAI_API_KEY` is set server-side.
Responses always carry `mode` so the UI can never misrepresent generated text as AI when it is not.

## ADR-006 — Soft delete + restore for undo
Deletes set `deleted_at`; all queries filter it; undo clears it. Avoids destructive races with
optimistic UI and preserves event history integrity.

## ADR-007 — Optimistic client mutations
Client components apply changes immediately, reconcile with `router.refresh()` after the API confirms,
and roll back with an error toast on failure. No global client store; server remains source of truth.

## ADR-008 — shadcn-style primitives on Radix
The shadcn CLI targets scaffolded projects and adds codemod risk here; we vendor the same pattern
(cva + tailwind-merge + Radix Dialog/Dropdown/Popover/Tooltip) for accessible, theme-token-driven components.

## ADR-009 — Rate limiting scope
Login throttle is in-process (per instance). Acceptable for single-instance deployment; a shared store
(Redis/Postgres) is the documented upgrade for horizontal scaling.
**Refinement (Phase 1 QA):** only *failed* attempts count, and success clears the counter. Counting successes
locked out legitimate heavy users during automated QA while adding no brute-force protection.

## ADR-010 — Validated environment contract
`src/server/env.ts` parses `process.env` through Zod exactly once (lazy, so tooling can import modules
without a live environment). `MONGODB_URI` must be a MongoDB URI and `MONGODB_DB` must name the database; `OPENAI_API_KEY` is strictly optional;
`NODE_ENV` is a closed enum. The pure `parseEnv` is unit-tested; `db` and the AI provider consume `getEnv()`.

## ADR-011 — Route-level state system + shadcn CLI compatibility
Every segment gets a layout-matched `loading.tsx` skeleton (`aria-busy`), errors render an accessible
`ErrorPanel` (`role=alert`, digest reference, retry) via root and in-shell `error.tsx`, plus `global-error.tsx`
with inline styles as last resort and styled 404s. Unmatched URLs use the root not-found boundary (Next.js
semantics); the app-segment `not-found.tsx` serves future `notFound()` calls. `components.json` + the
`src/components/ui/` directory make the vendored primitives shadcn-CLI compatible (ADR-008).

## ADR-012 — Drag-safe optimistic reconciliation
Server→client task sync uses React's guarded render-time "adjust state on prop change" pattern (replacing
setState-in-effect cascades flagged by react-hooks v6). While a drag is active (`dragId !== null`) incoming
server task state is deferred — swapping the dragged DOM node mid-gesture cancels native HTML5 drag.
Sync applies on dragend/drop. Verified with repeated bidirectional drag tests.

## ADR-013 — Explicit four-role capability matrix (Phase 2)
**Context.** The brief requires owner, admin, project manager, and member permissions defined explicitly.
The original three-role ladder folded project governance into admin.
**Decision.** Added `project_manager` to the DB enum (non-destructive `ALTER TYPE … ADD VALUE` via
drizzle-kit push) and introduced `src/server/auth/permissions.ts`: a pure, exhaustive
`Capability → minimum Role` matrix with a strictly monotonic ladder. Enforcement is a single path —
`requireMembership` + `ensureCan` — used by every mutating service function; route handlers stay thin.
Notable choices: (a) task delete stays member-level because it is a *soft* delete with undo (reversible
actions need less authority); (b) project *delete* (irreversible, cascades events/comments) requires
admin; (c) role changes are owner-exclusive and `owner` is not assignable through any API (Zod-rejected);
(d) owners cannot leave (no orphaned workspaces) and cannot be removed/demoted; (e) any non-owner may
leave, with access revoked immediately; (f) the matrix is importable by client components so UI gating
mirrors server truth — but the server never trusts it.
**Verified by:** 20 unit assertions on the matrix (incl. monotonicity + integrity), and `e2e/security.spec.ts`
negative tests (unauthenticated 401 ×30 routes, role violations 403, cross-tenant reads/mutations 404 ×25,
owner protections 400, leave/removal revocation, Zod 400s, CSRF 403) — all observed passing.

## ADR-014 — Optimistic concurrency + legal lifecycle (Phase 3 v2)
Tasks carry an integer `version`. Every mutation states the revision it was based on; the server updates with
`WHERE version = expected` inside a row-locked transaction and returns 409 on mismatch. Bulk actions require a
revision per task (428 otherwise) and return the new revisions so undo stays safe. Status changes follow an explicit
transition graph (`done → todo` is the only exit from Done), making each rework cycle auditable. Dependency rows
carry `workspace_id` so graph reads/cycle checks never scan other tenants; existing rows were backfilled before the
column became NOT NULL. Persistence remains PostgreSQL per ADR-001 (no Atlas instance exists in this environment).

## ADR-015 — Collaboration: idempotent notifications, poll-driven deadlines, keyset feeds (Phase 4)
- Notification recipients are planned by a pure function (precedence mention > reply > comment, no self-notify,
  members only) and persisted with a `dedupe_key`; a unique `(user_id, dedupe_key)` index plus `ON CONFLICT DO
  NOTHING` makes writes idempotent under retries and repeated sweeps.
- No realtime infrastructure is configured, so the client polls every 30s and on focus. Each poll runs a deadline
  sweep limited to the caller's assigned tasks; this avoids background workers at the cost of alerts appearing only
  when the assignee is active (documented limitation; a scheduled job is the upgrade path).
- Feeds use keyset cursors over `(created_at, id)`. All rows in paginated tables are written with explicit
  millisecond JS timestamps so cursor equality is exact and the composite indexes serve ordering.
- Replies are one level deep (simpler, predictable notification semantics). Mentions are explicit member ids sent by
  the composer, validated server-side; only ids whose `@Name` remains in the text are sent.

## ADR-016 — Deterministic analytics domain: replay, half-open windows, SQL push-down (Phase 5)
**Context.** The product needs cycle time, lead time, on-time, overdue, workload, weekly trends and blocked
analysis that can be reproduced exactly and explained. The brief asks for MongoDB aggregation where appropriate; the
platform database is PostgreSQL (ADR-001), and no MongoDB instance exists in this environment.
**Decision.**
- Pure domain module `src/lib/analytics` (no IO). All metrics come from one report builder, so the dashboard and the
  analytics endpoint cannot disagree.
- Historical metrics replay the append-only event log up to `asOf`. Flow start resets on reopen. Lead is anchored to
  creation. Deleted tasks remain in history but leave snapshots and the cohort.
- Local-day windows in an IANA time zone via `Intl`, half-open `[start, endExclusive)`, plus the `asOf` cutoff.
  Weeks start on Monday.
- Empty samples produce nulls (never zero). Rounding is half-up on outputs, with binary noise removed first.
- Per-day counts are pushed down as one `GROUP BY` (local day × type). The domain can also derive them from events;
  an integration test asserts the two agree for several filters and time zones.
- Filters use current attributes. Historical attributes are not replayed (documented limitation).
**Consequences.** Accuracy and explainability over raw speed: the replay loads the workspace's history at or before
`asOf`, so the cost grows with history rather than with the window. The rollup upgrade path is recorded in
ANALYTICS.md §10 and is not implemented. Dashboard numbers changed slightly where the event-based definitions
differ from the old projection-based ones (cycle now uses the flow start; on-time uses events).
**Verification.** 82 analytics unit tests (hand-calculated fixture), 12 database integration tests, 30 live endpoint
checks, mutation checks on three injected defects, and a query plan for the daily aggregation.

## ADR-017 — Dashboard view model and deadline-risk model v2 (Phase 6)
**Decision.** (1) Replace the six-factor v1 risk heuristic with a versioned, per-workspace configurable four-factor
model built on the inputs the brief names (remaining effort vs time available, blocked duration, dependencies,
workload) and report uncertainty as an interval + confidence instead of a single number. v1 and its tests were
removed; v2 has its own hand-calculated tests. One scoring path serves every screen. (2) Dashboard data is a pure
view model (`src/lib/dashboard/model.ts`) over the Phase 5 report so fixtures pin exact chart data. (3) Risk is
scored workspace-wide, then narrowed to the filtered population, so filters never change a task's score.
(4) Recharts for all new charts; D3 is not used for new views — the risk interval is a few inline SVG shapes, and the
existing D3 CFD/histogram remain on the Analytics page. (5) Charts are `aria-hidden`; each figure exposes a title,
a summary and a data table generated from the same array.
**Consequences.** Dashboard and drawer scores changed relative to v1. Dependency edges now store `created_at`
(legacy edges got the migration time — documented in RISK.md).

## ADR-018 — Evidence-bundle AI contract (Phase 7)
**Decision.** The model never sees the database or raw DTOs: it receives a numbered evidence bundle (E01…En) built
from the caller's authorized dashboard, plus a closed 12-task reference list. Output is validated twice — Zod shape,
then citation check against the bundle; uncited or miscited items are dropped and counted (`droppedInvalid`, shown in
the UI). Insights declare `kind: fact | suggestion` so observations and advice are never conflated. Provider
failures are classified (timeout / rate_limited / auth / server / bad_output) and always fall back to the
deterministic narrator with an honest provider note; `mode: "ai"` is returned only for validated model output. A
per-user fixed-window limiter (10/10min) protects spend. Full details, costs and privacy analysis: AI.md.
**Rejected alternatives.** Giving the model tool/function access to query data (unbounded tenant surface);
streaming raw analytics JSON (no citation contract, unverifiable claims); client-side calls (secret exposure).

## ADR-019 — Phase 8 audit outcomes
- `next` is pinned to 16.4.4 to clear the critical advisory; `postcss` 8.5.32 and non-breaking transitive
  patches clear all high/low advisories. 19 moderate dev-tooling advisories remain; `audit fix --force`
  (breaking) was deliberately not applied.
- Login rotates the presented session token (deletes the old row before inserting a new one). Other device
  sessions remain valid.
- Registration and member invitation are single transactions relying on DB unique constraints; 23505 maps
  to HTTP 409 instead of an unhandled 500. This is the race-free alternative to pre-read existence checks.
- `drizzle.config.ts` is the single source for schema tooling credentials and reads `DATABASE_URL`; no
  connection string is stored in source control.
- Comment notification idempotency uses a content+minute key, not the new row id. API-level mutation
  idempotency (`Idempotency-Key`) remains a documented Medium risk, not implemented.
- Full evidence and residual-risk severity table: AUDIT.md.

## ADR-020 ? Coordinated MongoDB migration (4 November 2026)
Native driver 7, AsyncLocalStorage transaction sessions, explicit metadata setup/readiness verification,
workspace serialization, optimistic task/config revisions, session TTL plus read-time expiry,
partial unique notification dedupe, native daily aggregation, and empty-target offline imports.
Existing DTOs, UI and domain formulas are retained. Tests use a disposable replica set.
See MONGODB_MIGRATION.md for verification evidence and operational cutover limitations.
