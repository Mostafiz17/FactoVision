# Optional AI insights — configuration, costs, privacy, limitations

Core rule: **the product is fully functional with no AI provider.** With no credentials, on provider failure,
timeout, provider rate limit, or invalid model output, the deterministic rule engine answers and the response says
so (`mode: "deterministic"`). `mode: "ai"` is only ever returned when validated model output was actually used.

## Architecture
```
POST /api/ai/insights ── service (auth + rate limit)
   ├─ getDashboard()          authorized, workspace-scoped view model (Phase 5/6)
   ├─ buildEvidence()         numbered facts E01…En + closed task-reference list   [src/lib/ai/evidence.ts]
   ├─ provider selection      OPENAI_API_KEY? → OpenAI-compatible : deterministic
   ├─ generateWithOpenAI()    timeout, classified failures                          [src/server/modules/ai/openai.ts]
   ├─ validateInsights()      Zod shape + citation check against the bundle         [src/lib/ai/types.ts]
   └─ fallback                any failure → deterministic narrator, honest note
```
The provider interface is `generate(bundle) → insights`; the OpenAI client is one implementation. Adding a provider
means implementing that call — nothing else in the stack changes. The model receives **only** the evidence bundle:
aggregates and a capped list of task titles/ids from the caller's workspace. It has no database access, no tools,
and no ability to query anything.

## Evidence contract
- Facts are derived from the authorized dashboard: window, throughput, completion rate, on-time, cycle/lead,
  workload per assignee, overdue tasks (top 4), blocked tasks with blockers (top 4), project progress, risk
  distribution and the top-5 risk items with scores, intervals and missing inputs, plus data-quality counts.
- Task references are capped at 12 and limited to tasks the dashboard already exposes.
- Recommendations must cite evidence ids; citations are validated (`validateInsights`): items citing unknown or no
  evidence are dropped and counted in `droppedInvalid` (surfaced in the UI). Unknown task ids are stripped.
- Every insight declares `kind`: `fact` (observed) or `suggestion` (proposed action). The UI groups them under
  "Observed" and "Suggested".

## Configuration (server-side environment only)
| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | no | unset → deterministic mode | Secret; never sent to the browser, never in responses or logs |
| `AI_MODEL` | no | `gpt-4o-mini` | Any OpenAI-compatible chat model id |
| `AI_TIMEOUT_MS` | no | `15000` | 1000–120000; abort → deterministic fallback |
Endpoint is `https://api.openai.com/v1/chat/completions` (injectable in tests). All variables are validated by
`src/server/env.ts`; none is `NEXT_PUBLIC_*`.

## Rate limiting and failure handling
- Per-user fixed window: **10 requests / 10 minutes** (in-process, like the login throttle; a shared store is the
  horizontal-scale upgrade). Exceeding it returns **429** with a retry hint; the deterministic panel remains
  available on the next window.
- Classified provider failures → deterministic fallback with an honest provider note:
  `timeout` (abort), `rate_limited` (HTTP 429), `auth` (401/403), `server` (5xx/network), `bad_output`
  (non-JSON or wrong shape). If the model answers but **nothing** cites real evidence, the fallback is used and
  labelled "AI output failed validation".

## Costs
Each enabled call is one chat completion. Token use ≈ system prompt (~200 tokens) + evidence bundle (scales with
open tasks, projects and assignees; typically 1–3k tokens for a small workspace, capped by the 12-task reference
limit and top-N lists) + output (≤6 insights, a few hundred tokens). Cost = tokens × the provider's current published
rates — check the provider price list before enabling; rates are deliberately not reproduced here because they
change. The per-user rate limit bounds spend: at the default model and a 3k-token request, one active user can cost
at most 10 requests per 10 minutes. No automatic retries are performed (a retry would double cost on flaky
providers); the fallback is free.

## Privacy and tenant isolation
- The bundle is built **after** membership + `analytics.read` authorization, from that workspace's dashboard only.
  Cross-tenant requests 404 before any provider call. Tests assert the serialized prompt contains no foreign
  workspace identifiers and no credentials.
- The API key exists only in server environment memory: it is sent solely in the `Authorization` header to the
  provider endpoint (asserted in tests), never logged, never returned, never bundled for the client.
- Data shared with the provider: workspace-scoped aggregates, task titles of at most 12 referenced tasks, member
  first-name/last-name strings as they appear in workload facts. If your policy forbids sending task titles or member
  names to a third party, do not set `OPENAI_API_KEY` — the deterministic mode shares nothing.
- Provider-side retention is governed by the provider's terms, not this app.

## Limitations
1. Model output quality is not guaranteed: validation enforces shape and citations, not truthfulness of prose that
   stays within the cited facts. The UI therefore always shows the mode badge and the cited evidence ids.
2. The live AI path cannot be exercised in this sandbox (no key configured); it is covered by mocked-fetch tests
   (payload privacy, timeout, 429/401/5xx classification, bad output, validation flow). Deterministic mode is
   verified live.
3. Suggestions are generic playbook actions derived from the same rules the deterministic engine uses; the AI adds
   phrasing and synthesis, not new analysis.
4. Rate limiter state is per process (resets on restart; not shared across instances).
5. Evidence is a point-in-time snapshot at request time (as-of now); it is not streamed or refreshed mid-generation.
