# Deadline-risk model v2.0.0

Implementation: `src/lib/risk/model.ts` (scoring), `src/lib/risk/assess.ts` (inputs from replayed events),
`src/server/modules/risk/service.ts` (config storage, workspace scoring). One model scores every open task for the
board, task drawer, analytics risk queue, dashboard and AI narrator. v1 (six-factor, aging/priority based) was
removed (ADR-017).

## Score
`score = Σ round1(100 · wᵢ · vᵢ)`, vᵢ ∈ [0,1], Σwᵢ = 1. Contributions sum exactly to the score.
Bands: score ≥ highFrom → high; ≥ mediumFrom → medium; else low (defaults 67 / 34).

| Factor (default weight) | Inputs | Value |
|---|---|---|
| Schedule pressure (0.40) | remaining effort (estimate), time available (due − asOf), velocity | overdue or due = asOf → 1; else clamp((points ÷ pt/day) ÷ days available) |
| Blocked duration (0.20) | earliest creation time of a currently unresolved blocker edge | clamp(days blocked ÷ blockedSaturationDays[5]) |
| Unresolved dependencies (0.15) | count of blockers not done/deleted at asOf | clamp(count ÷ dependencySaturation[3]) |
| Assignee workload (0.25) | Σ estimate of the assignee's active (in progress/review) open tasks | clamp(load ÷ capacityPoints[8]); unassigned → policy 0.5 |

**Velocity** (pt/day, calendar days, 30-day look-back, completions attributed to the current assignee): the assignee's
own rate if they have ≥ 3 estimated completions; else the team rate (Σ points ÷ days ÷ distinct completers) if the team
has ≥ 3; else the configured default (1 pt/day).

## Uncertainty
Each factor carries [low, high]; the score interval is Σ 100·wᵢ·[lowᵢ, highᵢ].
- Missing due date, or missing estimate before the deadline → value = missingAssumption (0.5), range [0,1].
- Blocked with an unknown start → value 0.5, range [0,1].
- Team/default velocity → schedule recomputed at rate × (1 ± 0.5).
- Unestimated active tasks of the assignee → assumed 3 pt each (range 0–6 pt).
Confidence from interval width: < 10 high, < 25 medium, else low (part of the model version). `bandRange` shows when
the plausible range spans several bands. `missingInputs` lists what would narrow it.

## Configuration and versioning
- Per-workspace config in `risk_configs` (weights, parameters, bands), validated by `riskConfigSchema`.
- `GET /api/risk/config` (any member) · `PUT` (admin/owner, capability `risk.configure`) with `expectedRevision`
  (409 on stale). Every save increments `revision`. Results carry `modelVersion`, `configRevision` and a config
  fingerprint (FNV-1a of canonical JSON).
- A stored config for another model version, or one that no longer validates, is ignored in favour of defaults.
- Editable in Settings → Deadline-risk model.

## Limitations
1. No partial-progress tracking: remaining effort = full estimate, even for in-progress tasks.
2. Velocity uses calendar days and current-assignee attribution; points are not hours.
3. Dependency edges created before this phase received the migration time as `created_at`, so their blocked
   duration is understated until they are re-created. Edge history is current-state (removed edges leave no trace).
4. Blocked duration measures time since the earliest current blocker edge; it does not subtract intervals when the
   blocker was briefly resolved.
5. Scores are heuristics for prioritising attention, not probabilities of missing a deadline.

## Verification
21 unit tests hand-calculated from the Phase 5 fixture (every open task's contributions, score, interval, band range,
confidence); config validation, fingerprint and versioning tests; mutation checks (interval from point values → 5
failures; future edges not ignored → 1). E2E: role enforcement, 400/409, revision increments and rescoring.
