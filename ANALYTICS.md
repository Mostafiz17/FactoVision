# Analytics — formulas, eligibility, boundaries and limitations

Authoritative reference for Phase 5. The implementation lives in `src/lib/analytics/` (pure domain, no IO,
no UI, no AI provider). The database adapter is `src/server/modules/analytics/repository.ts`, the authorized
service is `service.ts`, and the HTTP surface is `GET /api/analytics/report`.

## 1. Architecture and where each rule is enforced

| Layer | File | Responsibility |
|---|---|---|
| Time | `src/lib/analytics/time.ts` | IANA zone offsets (via `Intl`), local day keys, Monday-start weeks, half-open windows |
| Replay | `src/lib/analytics/timeline.ts` | Per-task status and deletion timeline, completion samples (lead, cycle) |
| Population | `src/lib/analytics/filters.ts` | Filter semantics on the current task projection |
| Statistics | `src/lib/analytics/stats.ts` | Nearest-rank percentiles, empty-sample nulls, rounding |
| Report | `src/lib/analytics/report.ts` | Every metric, from one code path |
| Definitions | `src/lib/analytics/definitions.ts` | Text catalogue of formulas and limitations (no numbers) |
| Persistence | `src/server/modules/analytics/repository.ts` | Bounded loads; **MongoDB aggregation for per-day counts** |
| Authorization | `src/server/modules/analytics/service.ts` | Membership, `analytics.read`, filter scope, input validation |

**MongoDB.** Native $match/$lookup/$dateToString/$group pipelines count events by local day and type.
Task joins include workspace scope and current population filters. Replica-set integration tests compare
these counts to the pure event-derived report for six filter sets and three time zones.

Dependencies point downward: the domain imports only the standard library and shared domain types. It never imports
the MongoDB driver, Next.js, React or the AI provider.

## 2. Population and filters

- **Population** = tasks that match the filters **and** were created at or before `asOf`. Soft-deleted tasks are
  included in the population so that history stays intact. Snapshot metrics exclude them where stated.
- **Filters** (conjunctive; absent = match all): `projectId`, `assigneeId` (uuid or `none` for unassigned),
  `priority`, `label` (trimmed, lowercased).
- Filters use each task's **current** project, assignee, priority and labels. Historical attributes are not replayed.
  Example: a task moved from project A to B is in B's population for every window, including those before the move.
- Filter scope is checked in the service: a `projectId` from another workspace returns **404**, the same as a missing one.
- Dependency blockers are resolved **across** the workspace. A task in project P1 blocked by a task in P2 is blocked
  in the P1 report (see §5, blocked).

## 3. Time model

- **Time zone.** Every window and bucket uses local calendar days in an IANA zone (default `UTC`). Unknown zones → 400.
- **Day.** Local midnight to midnight. A New York spring-forward day (2026-03-08) is 23 h long; fall-back
  (2026-11-01) is 25 h. Tests assert both, plus Kolkata (+05:30) starting its days at 18:30 UTC.
- **Week.** Monday-start local weeks. Edge weeks are partial; each weekly bucket reports `daysInWindow`.
- **Window.** The `days` local calendar days ending on the day containing `asOf`. Half-open:
  `[start, endExclusive)`, where `start` is local midnight of the first day and `endExclusive` is local midnight of the
  day after `asOf`.
- **Replay cutoff.** `asOf` (default now; future instants → 400). Events after `asOf` are ignored. Membership is:
  `start ≤ t < endExclusive` **and** `t ≤ asOf`.
  Note: `endExclusive` is always after `asOf`, so the `asOf` cutoff is the effective upper bound. Keeping the
  half-open end check does not change results; it documents the definition.
- **Daily buckets.** Event instant → local day key via `Intl`. The same instant can fall on different days in
  different zones; tests cover this with 2026-03-14T03:30Z, which is 03-13 in New York and 03-14 in UTC.

## 4. Event replay (the basis of every historical metric)

Only `created`, `status_changed`, `completed`, `reopened`, `deleted` and `restored` events are replayed, and only
those at or before `asOf`.

- **Initial status:** `created.toValue`. Without a created event: the first transition's `fromValue`, else the current
  projection (a last resort; the application always writes a created event).
- **Creation instant:** `created.at`, or the projection `createdAt` when absent.
- **Status timeline:** each status-bearing event sets the status to its `toValue`. `completed` sets `done`.
- **Deletion timeline:** `deleted` sets deleted; `restored` clears it. A restored task is live again.
- **Same-millisecond order:** `created` first, then by event id. Deterministic, documented, and independent of input order.
- **Flow start:** the first entry into `in_progress` or `review` since creation or the last reopen. A task created
  directly in `in_progress`, `review` or `done` starts at creation.
- **Reopen:** `reopened` (done → todo) clears the flow start and is counted separately.
- **Completion sample:** one per `completed` event. `leadDays = completedAt − createdAt`;
  `cycleDays = completedAt − flowStart`, or null if no flow start exists (never estimated).

Limitation: moving a task back from `in_progress` to `todo` does not reset the flow start, so the cycle runs from the
first start. The projection field `startedAt` is reset by that move and is **not** used by analytics.

## 5. Metric definitions

Notation: window W = [start, endExclusive); cutoff = asOf; "open" = status ∈ {backlog, todo, in_progress, review},
not deleted at asOf, created at or before asOf.

### 5.1 Throughput

- `completed` = number of completion samples with `completedAt ∈ W`.
- `reopened` = number of `reopened` events with instant ∈ W.
- `created` = number of population tasks with creation instant ∈ W.
- `net` = completed − reopened.
- Daily series: the same three counts per local day. The weekly series sums the days.
- **Eligibility:** population tasks, including those deleted after the event.
- **Limitation:** gross flow. A task completed, reopened and completed again counts twice.

### 5.2 Completion rate (created-cohort)

- **Eligible** = population tasks created in W that are not deleted at asOf.
- **Completed** = eligible tasks whose status at asOf is `done`.
- `rate = completed ÷ eligible`, or **null** if eligible = 0.
- **Limitations:** tasks created before W are excluded even when completed inside W (throughput covers them). A task
  completed then reopened before asOf is not completed. Deleted tasks leave the denominator.

### 5.3 On-time completion rate

- **Eligible** = completion samples in W whose task has a due date.
- **On-time** = eligible completions with `completedAt ≤ dueDate` (equality is on time).
- `rate = on-time ÷ eligible`, or **null** if eligible = 0. Undated completions are reported only through the eligible count.
- **Limitations:** uses the task's **current** due date. Retroactive due-date edits change past results. Each
  reopen-and-recomplete is judged separately against the same due date.

### 5.4 Overdue

- **Overdue count** = open tasks with `dueDate < asOf` (strict: a due instant equal to asOf is not overdue).
- **openWithDue** = open tasks with a due date. **share** = overdue ÷ openWithDue (null if 0).
- **ageDays** = `asOf − dueDate` for overdue tasks, summarized with the cycle-time statistics (null when empty).
- **Limitation:** current due date (as above).

### 5.5 Cycle time and lead time

- Samples: completion samples in W. Cycle samples are those with a non-null `cycleDays`.
- **count, mean, P50, P85, min, max.** Nearest rank: `rank = ceil(p · n / 100)` computed as integers, so
  (55/100)·100 = 55.00000000000001 cannot push P55 of 1…100 up to 56.
- Empty sample → every statistic is **null**, never 0.
- **Limitation:** lead is anchored to the original creation, so reworked tasks have long lead times by design.

### 5.6 Active and queued estimated workload

- **Active** = open tasks in `in_progress` or `review` (the WIP statuses from PROJECT_SPEC §5).
- **Queued** = open tasks in `backlog` or `todo`. Active and queued partition the open set.
- For each group: `count`; `estimated` = tasks with an estimate; `unestimated` = count − estimated;
  `points` = Σ estimate over estimated tasks (unestimated tasks contribute 0); `coverage` = estimated ÷ count
  (null if count = 0).
- **Active by assignee:** points and count per assignee, sorted by points descending, then assignee id; unassigned last.
- **Missing estimates** are never imputed. They are excluded from points and disclosed through `unestimated` and `coverage`.
- **Limitations:** estimates are current values. Points are not hours and are not comparable across teams.

### 5.7 Weekly trends

- One bucket per Monday-start local week that overlaps the window: `daysInWindow`, `created`, `completed`, `reopened`,
  `net`, `onTimeEligible`, `onTime`, `onTimeRate`, `cycleCount`, `cycleMedianDays`.
- Week counts sum to the window totals (tested). On-time and cycle figures are assigned to the week of the
  **completion**. `onTimeRate` and `cycleMedianDays` are null when the week has no eligible or cycle samples.

### 5.8 Blocked-task analysis

- **Unresolved blocker** = a blocker task that exists at asOf, is not deleted, and is not `done` at asOf.
- **Blocked** = open population tasks with at least one unresolved blocker. **share** = blocked ÷ open (null if open = 0).
- `blockedEstimatedPoints` = Σ estimate of blocked tasks (unestimated contribute 0).
- **topBlockers** = up to 5 unresolved blockers ranked by the number of **open population** tasks they hold back
  (ties: title ascending). A blocker outside the population still counts when the blocked task is inside it.
- **Limitations:** dependency edges are current-state, so an edge added after asOf still applies on replay. Time spent
  blocked is not measured, because dependency events record the blocker's title rather than its id.

## 6. Eligibility at a glance

| Metric | Population | Time basis | Snapshot exclusions |
|---|---|---|---|
| Throughput, daily, weekly counts | Filtered tasks, deleted included | Event instants in W | — |
| Completion rate (cohort) | Created in W | Creation in W, status at asOf | Deleted at asOf |
| Cycle / lead time | Completions in W | Completion instant in W | — |
| On-time rate | Completions in W with a due date | Completion instant | — |
| Overdue | Open | Due < asOf | Deleted at asOf, created after asOf |
| Workload (active / queued) | Open | Snapshot at asOf | Deleted at asOf |
| Blocked | Open | Snapshot at asOf | Deleted blockers |

## 7. Rounding

- Days (mean, percentiles, min, max, cycle samples, medians, ages): **2 decimals**.
- Ratios (rates, shares, coverage): **4 decimals** (0.3333). Presentation may format as percentages.
- Points: **2 decimals**. Counts: integers.
- Rounding is **half-up for non-negative values**, applied only to outputs. Intermediate values keep full precision.
  The implementation first removes binary noise (`toPrecision(12)`), so 2.675 → 2.68 and 5.125 → 5.13.

## 8. Empty datasets

- No eligible samples → statistic objects have `count: 0` and null values; ratios are null.
- A ratio with a **zero numerator and a non-zero denominator** is 0 (not null). Example: project P2 has an eligible
  cohort but no completions, so its completion rate is 0.
- A workspace with no tasks → zero counts, null rates, a zeroed daily series and a zeroed weekly series.
- The API returns empty results as data (200), never as an error.

## 9. Verification

Current migration results are recorded in MONGODB_MIGRATION.md. Mutation and SQL query-plan notes
below are historical evidence from the earlier persistence adapter; the current adapter is MongoDB-native.

- **Hand-calculated fixture** (`src/lib/analytics/__tests__/fixture.ts`): 11 tasks, 3 projects (P3 is empty),
  2 users, 3 dependency edges, one deleted and restored task, one reopen. Every expected value in
  `report.test.ts` was computed by hand from the fixture timestamps before the tests were run.
- **Pure tests** (`src/lib/analytics/__tests__/`): time zones and DST, windows, nearest rank, rounding, replay, the
  baseline report, the 14-day weekly split, as-of replay, each filter, partition additivity, empty datasets,
  boundaries (overdue and on-time equality), deterministic input order, the pre-aggregated path, deleted and reopened
  tasks, and time-zone bucketing.
- **Database integration** (`src/server/modules/analytics/__tests__/integration.test.ts`): loads the fixture into
  a disposable MongoDB replica set and checks that the MongoDB-backed report equals the pure report; that aggregated daily counts equal
  event-derived counts for six filter sets × three time zones; and authorization (non-member 404, foreign project 404,
  member allowed) and validation (unknown zone, bad days, future asOf → 400).
- **Mutation checks** (run during this phase; original files restored afterwards):
  - Float-based nearest rank → 1 test fails (P55 of 1…100).
  - Cohort that ignores deletion → 5 tests fail.
  - SQL time-zone expression hardcoded to UTC → the time-zone SQL-vs-derived check fails.
  - End-inclusive window → **no test fails**. This is an equivalent mutant: the `asOf` cutoff already excludes
    the instant, as explained in §3.
- **Query plan** (`EXPLAIN ANALYZE`, 529 events / 118 tasks): the event filter uses `events_ws_type_created_idx`.
  The table is too small for a timing claim; this shows the index is used, not a scaling result.

## 10. Performance and scaling limits

- Per request, the service loads every task in the workspace, every event of the replayed types at or before `asOf`,
  every dependency edge, and one aggregation result of at most (days × 3) rows. History must be replayed to compute
  flow metrics, so event volume is not reduced by the window. This is O(workspace history).
- The upgrade path, not implemented: a per-day rollup table maintained by the write path, plus per-task cycle
  summaries. Both would turn the replay into incremental updates. This is out of scope for Phase 5.

## 11. Limitations (summary)

1. Attributes other than status and deletion are current values: project, assignee, priority, labels, due dates, estimates.
2. Dependency edges are current-state (affects as-of replay of the blocked analysis).
3. Blocked time is not measured; dependency events do not carry the blocker id.
4. Flow start does not reset on a move back to `todo` (the cycle runs from the first start).
5. Gross flow: reopen-and-recomplete counts twice in throughput and timing.
6. Estimates are points, not hours; points are not comparable across teams.
7. Same-millisecond events are ordered deterministically but arbitrarily (created first, then id).
8. Metrics describe recorded activity. They do not measure effort, quality or individual performance.
