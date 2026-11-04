# FactoVision by Factoryze - Analytics-Driven Task Manager - Product Specification

## 1. Goal
A production-minded team workspace combining task management, collaboration, mathematically
defined productivity analytics, explainable deadline-risk scoring, and **optional** AI insights.
Deterministic analytics are the foundation; the product is fully functional with no AI provider.

## 2. Personas & core jobs
- **Team lead (admin/owner):** plan projects, balance workload, see delivery risk early, manage members.
- **Contributor (member):** triage a board, move work through statuses, comment, track own deadlines.
- **Stakeholder:** read dashboards (throughput, cycle time, on-time delivery, forecast) with definitions attached.

## 3. Functional requirements
### Auth & tenancy
- FR-1 Email + password registration and login; server-verified sessions; logout.
- FR-2 Users can belong to multiple workspaces with roles `owner | admin | project_manager | member`.
- FR-3 Every tenant-owned read/write is scoped to a workspace the caller belongs to (server-enforced; non-members receive 404, never data or existence leaks).
- FR-4 Admins+ invite members (existing account or provisioned account with one-time temp credential); only owners change roles; owners can never be removed, demoted, or leave (no orphaned workspaces); any non-owner may leave; admins remove strictly-lower ranks only.
- FR-4a **Explicit permission matrix** (single source of truth: `src/server/auth/permissions.ts`, enforced server-side on every route; UI gating mirrors it but is never trusted):

  | Capability | member | project_manager | admin | owner |
  |---|:-:|:-:|:-:|:-:|
  | Work on tasks (create/update/status/assign/bulk/comment/dependencies, soft delete + undo) | ✓ | ✓ | ✓ | ✓ |
  | Read analytics, activity, notifications, member list | ✓ | ✓ | ✓ | ✓ |
  | Manage own saved views | ✓ | ✓ | ✓ | ✓ |
  | Leave workspace (self) | ✓ | ✓ | ✓ | ✗ (cannot orphan) |
  | Create / edit / archive projects | ✗ | ✓ | ✓ | ✓ |
  | Rename workspace | ✗ | ✗ | ✓ | ✓ |
  | Invite members · remove lower ranks | ✗ | ✗ | ✓ | ✓ |
  | Delete projects | ✗ | ✗ | ✓ | ✓ |
  | Change member roles | ✗ | ✗ | ✗ | ✓ |

  Grants are monotonic up the ladder `member < project_manager < admin < owner`; `owner` is never assignable via API (Zod-rejected).

### Work management
- FR-5 Projects per workspace: create, edit, archive, delete (with cascade rules), color + key.
- FR-6 Tasks: title, description, status (`backlog, todo, in_progress, review, done`), priority
  (`low, medium, high, urgent`), assignee, estimate (points), due date, tags, board position.
- FR-7 Kanban board with drag & drop across columns and reordering; list view with sorting; both share filters.
- FR-8 Task dependencies (blocks / is-blocked-by) with server-side cycle prevention.
- FR-9 Comments on tasks; workspace activity feed; in-app notifications (assigned, commented, status of own task) with unread state.
- FR-10 Search, filter (project, assignee, priority, tag), sort, saved views (persisted per user+workspace), bulk selection with bulk status/assign/delete, undo after destructive actions (soft delete + restore).

### History & analytics (all deterministic, defined in §5)
- FR-11 Append-only task event log drives all historical analytics (creation, status transitions, reopens, assignment, due/estimate/priority changes, comments).
- FR-12 Dashboard: throughput (+EWMA trend), cumulative flow diagram, cycle-time distribution with P50/P85, WIP vs limit, on-time delivery, forecast (P50/P85 backlog clearance), per-member workload, risk queue.
- FR-13 Analytics page: adjustable window (14/30/60/90 days), EWMA α control, histogram bin control, legend toggles, metric definition panels with formulas and actual inputs, CSV/JSON export of the exact computed data.
- FR-14 Explainable risk score per open task: weighted factor model; UI shows every factor value, weight, contribution, and a plain-language explanation.

### Optional AI
- FR-15 Provider-independent server interface. With `OPENAI_API_KEY` present, an OpenAI-compatible provider summarizes **computed** analytics. Without a key, a clearly-labelled deterministic rule-based narrator is used. The UI always discloses which mode produced the text. AI never blocks core features.

## 4. Non-functional requirements
- Strict TypeScript (no `any`), Zod at every trust boundary, modular monolith.
- Accessible (keyboard, focus management via Radix primitives, contrast-checked palette), responsive ≥360px.
- Loading, empty, error, success states everywhere; optimistic mutations with rollback + toast.
- Secrets only via environment variables; no credentials committed.
- Unit tests colocated with domain logic (Vitest); Playwright E2E suite included (browser download environment-dependent).

## 5. Metric definitions

**Phase 5 status:** the authoritative, tested definitions for the flow, timing, on-time, overdue, workload,
weekly and blocked metrics now live in `src/lib/analytics/` and are documented exhaustively in **`ANALYTICS.md`**
(eligibility, time zones, reopens, missing estimates, rounding, empty datasets, limitations). The lines below
remain the product-level definitions; where they differ in detail, `ANALYTICS.md` governs:
- Cycle time starts at the first entry into in_progress or review since creation or the last reopen (not at
  the projection `startedAt`, which a move back to todo resets). Cycle samples exclude completions with no flow start.
- On-time and overdue use the current due date (due-date history is not replayed).
Let `W = [T0, T1]` be the analysis window in days, `C(d)` completions on day `d`
(count of `completed` events), `R(d)` reopens on day `d`.
- **Throughput** `X(d) = C(d)`; net throughput `= Σ C(d) − Σ R(d)`. Reopens are reported, never hidden.
- **Cycle time** for tasks completing in `W` with a start: `completedAt − startedAt` (days). Reported: mean, median (P50), P85 (nearest-rank percentile).
- **Lead time** `completedAt − createdAt` (days), same statistics.
- **WIP** = count of tasks currently in `in_progress` or `review`. Default per-member WIP limit = 3 (adjustable what-if control).
- **On-time rate** = completed-with-due tasks where `completedAt ≤ dueDate` ÷ completed-with-due tasks. No due date ⇒ excluded (denominator disclosed).
- **EWMA throughput** `λ_t = α·X(t) + (1−α)·λ_{t−1}`, `λ_0 = X(0)`, default `α = 0.3`.
- **Forecast**: empirical daily-completion percentiles `q50, q85` over `W` (zero days included).
  Backlog `B` = open tasks. Optimistic clearance `= B / max(q85, ε)`, conservative `= B / max(q50, ε)` days.
- **CFD**: for each day, count of tasks in each status at end of day, reconstructed from the event log.
- **Risk score** — superseded by model v2.0.0, see **RISK.md** (the v1 table below is historical). `S = 100 · Σ wᵢfᵢ` with `Σ wᵢ = 1`, factors clamped to `[0,1]`:
  | factor | weight | definition |
  |---|---|---|
  | deadline pressure | 0.30 | no due date → 0.25 baseline; overdue → 1; else `clamp(1 − daysLeft / p85Cycle)` |
  | aging | 0.20 | started: `clamp(daysInProgress / p85Cycle)`; else `clamp(daysInStatus / (2·p85Cycle))` |
  | blocked | 0.20 | unresolved blocking dependencies ÷ total blocking dependencies (0 if none) |
  | workload | 0.15 | `clamp(assigneeActiveTasks / wipLimit)`; unassigned → 0.4 |
  | estimate uncertainty | 0.10 | missing estimate → 0.6; else `clamp(points / 8)` |
  | priority exposure | 0.05 | urgent 1.0, high 0.75, medium 0.5, low 0.25 |
  Bands: `S < 34` low, `34 ≤ S < 67` medium, `≥ 67` high. `p85Cycle` falls back to 5 days when fewer than 3 completed samples exist (disclosed in UI).

## 5a. Phase 5 additions (see ANALYTICS.md for the full contract)
- **Completion rate:** created-cohort, = done at asOf ÷ created in window and not deleted at asOf.
- **Overdue:** open tasks with dueDate < asOf; share over open tasks that have a due date.
- **Active / queued estimated workload:** points over estimated tasks; missing estimates disclosed, never imputed.
- **Weekly trends:** Monday-start local weeks in the requested time zone, with partial edge weeks flagged.
- **Blocked analysis:** open tasks with an unresolved, non-deleted blocker; top blockers by open tasks held back.
- **Eligibility, boundaries and rounding:** half-open local-day windows, replay cutoff at asOf, half-up rounding,
  nulls (never zeros) for empty samples.

## 6. Acceptance criteria (checked against the running app)
- AC-1 Register/login/logout works; unauthenticated `/app/*` and API access is rejected server-side.
- AC-2 A member of workspace A cannot read or mutate workspace B data via any route (403/404) — covered by automated negative tests: 30 unauthenticated route probes (401), 9 cross-workspace reads + 16 cross-workspace mutations (404), role-ladder violations (403), owner protections (400), leave/removal revocation (immediate 404), validation (400) and CSRF (403) — `e2e/security.spec.ts`.
- AC-3 Create → edit → drag across all statuses → comment → complete → reopen leaves a correct event trail; analytics recompute from events.
- AC-4 Delete offers undo; restored task returns with identical fields.
- AC-5 Every dashboard number matches its published formula for the seeded dataset (unit-tested domain functions).
- AC-6 Risk drawer shows all six factors with weights summing to 1 and contributions summing to the score.
- AC-7 AI panel truthfully reports `deterministic` vs `ai` mode; app is fully usable with no key.
- AC-8 `next typegen`, `tsc --noEmit`, `next build`, Vitest all pass; health endpoint returns ok.

## 7. Out of scope (documented)
Real-time websockets, email delivery, billing, SSO/SAML, file attachments, production infrastructure provisioning, microservices.