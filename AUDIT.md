> Historical phase record. These results describe the earlier implementation. Current MongoDB setup,
> migration status, and freshly observed checks are in MONGODB_MIGRATION.md and ARCHITECTURE.md.

# Phase 8 — Repository-wide audit

**Verdict: this is not a production-readiness claim.** The application builds, all configured tests pass,
and the high/critical dependency advisories are resolved. Deployment, real AI-provider egress, load testing,
multi-instance behaviour and a managed secret history remain unverified. See §5–§7.

Audit date: this session. All counts below are observed command outputs, not estimates.

## 1. Baseline (before changes)

| Gate | Result |
|---|---|
| `npm run lint` | PASS (0 errors / 0 warnings) |
| `npx next typegen` | PASS |
| `npm exec tsc -- --noEmit --pretty false` | PASS (strict, 0 `any` in production source) |
| `npx vitest run` | 220 passed / 220, 20 files |
| `npm audit` | 28 advisories: **1 critical, 5 high, 21 moderate, 1 low** |
| `npm ls --depth=0` | 1 extraneous package |

## 2. Findings, root causes and fixes

Severity is the risk **before** the fix. "Verified" names the test or command that now covers it.

| # | Severity | Finding and root cause | Fix | Verified by |
|---|---|---|---|---|
| F01 | **Critical** | `next@16.2.6` — Next.js middleware/proxy bypass and App Router DoS (npm advisory range ≤16.4.0). Direct dependency. | Bumped to `next@16.4.4` (non-major). | `npm audit` re-run: critical count 0; full build + 40 E2E green |
| F02 | **High** | `postcss` direct high advisory (CSS stringify XSS / arbitrary file read). | Bumped to `postcss@8.5.32`; non-breaking `npm audit fix` updated transitive dev advisories. | `npm audit`: 0 high, 0 low; manifest diff was only the postcss line |
| F03 | **High** | **Session not rotated on login.** `createSession` inserted a new session but never invalidated the token the browser presented, while ARCHITECTURE.md claimed rotation. A pre-login token stayed valid for 7 days. | `createSession` now deletes the presented session row before inserting the new token. Other devices are unaffected. | `e2e/audit.spec.ts` "login rotates the session" — old token → 401, new token → 200 |
| F04 | **Medium** | **Registration was non-atomic.** User insert, workspace creation and session issuance were separate operations; a failed workspace insert left an orphan account. A pre-read of `users.email` made concurrent duplicate signups race to a 23505 error surfaced as HTTP 500. | One transaction for user + workspace + owner membership; the DB unique index resolves the race and 23505 is mapped to 409. | `e2e/audit.spec.ts` concurrent duplicate registration: one 201, one 409, no 500, exactly one workspace |
| F05 | **Medium** | `inviteMember` had the same non-atomic user/membership pair and race; a user could be created with no membership. | Hash computed outside the transaction; account + membership inserted atomically; 23505 → 409; one-time credential returned only when an account was actually created. | `e2e/security.spec.ts` invite lifecycle (still green), `e2e/collaboration.spec.ts` |
| F06 | **Medium** | **CSRF check could be skipped**: `assertOrigin` compared Origin to Host only when Host was present; an Origin with no Host fell through. | Fail closed with 403 when Host is absent. | `src/server/__tests__/audit.test.ts` CSRF cases |
| F07 | **Medium** | **Duplicate notifications.** Comment notification `dedupeKey` was `comment:<new row id>`, so a retried/duplicate POST created a second row id and a second notification. | `commentDedupeKey()` derives a stable key from task, actor, parent, body and the current minute; `ON CONFLICT DO NOTHING` now suppresses the duplicate. Identical text in a later minute still notifies. | `src/lib/domain/__tests__/dedupe.test.ts` (4) + `e2e/audit.spec.ts` "duplicate comment POSTs do not duplicate notifications" |
| F08 | **Medium** | **Credentials in source control**: `drizzle.config.json` hardcoded `postgresql://postgres:postgres@…`. It is a local sandbox default, not a production secret, but it violates the "secrets only in env" rule. | Replaced with `drizzle.config.ts` reading `DATABASE_URL` via `dotenv/config`; JSON deleted. | `npx drizzle-kit push --force` reads the TS config and applies; `.gitignore` excludes `.env*`; static route audit asserts no `process.env` in handlers |
| F09 | Low | Four `any` parameters in the mocked OpenAI fetch tests. | Typed `vi.fn<typeof fetch>()`; zero `any` in production source. | `src/server/__tests__/audit.test.ts` repository-wide scan |
| F10 | Low | **Self-inflicted, found during this audit**: `isUniqueViolation` walked a cyclic `cause` chain forever. | Added a visited-object set. The deliberate cyclic test now terminates. | `src/server/__tests__/audit.test.ts` "does not loop forever on a cyclic cause chain" |
| F12 | **Medium** | **Cross-suite test flake**: the per-user AI rate limiter is process-wide, and several suites shared the seeded `ava` account while the dashboard auto-requests insights. One Playwright badge assertion and one `smoke` check failed transiently when the budget was exhausted; both passed on immediate rerun. | Isolated the AI-consuming checks: `e2e/dashboard.spec.ts` UI tests use a fresh admin invited into the seeded workspace; `scripts/ai-live.mjs` and `scripts/smoke.mjs` use fresh users invited into the seeded workspace (so assertions still see real data) and a dedicated user for the rate-limit test. QA harness gained hydration retries and a `/tmp/shots` dir guard. **No assertion was weakened**; the deterministic-mode badge and all 17 ai-live checks remain. | Playwright 40/40 twice consecutively; ai-live 17/17 twice; smoke 44/44 twice; QA 10/10 ×3 | 
| F11 | Low | **Vitest hang** introduced by the audit test's `__dirname`-relative filesystem walk (Vite transforms the module, so the root was unreliable). | Anchored to `process.cwd()`, skipped symlinks. Root cause was actually F10; both are fixed. | Full Vitest run now exits cleanly (258/258) |

## 3. New verification added

- **`src/server/__tests__/audit.test.ts`** — repository-wide static audit: every route except the four public
  endpoints calls a server auth guard; every mutating route calls `assertOrigin`; no handler reads
  `process.env` or imports `@/db`; no production source contains `any` or a credential-shaped literal.
  Plus CSRF host validation, 23505 error mapping (including cyclic causes), and AI env-variable validation.
- **`src/lib/domain/__tests__/dedupe.test.ts`** — 4 tests for the new idempotency key.
- **`e2e/audit.spec.ts`** — 18 tests, all on fresh tenants created during the run (no dependence on seeded
  numbers): session rotation, session revocation, concurrent duplicate registration, cross-workspace reads
  on 10 endpoints and writes on 5, foreign-project filters, unauthenticated access to newer endpoints,
  **empty datasets** (nulls/empties, never NaN or 500), **date boundaries** (days 1/366 valid, 0/367/2.5
  rejected, DST 47-hour New York window, pre-data replay, future asOf, invalid tz/filters), **duplicate
  requests** (dependency no-op, duplicate comments, repeated mark-all-read, stale bulk/risk-config writes →
  409), **failed external service** (intercepted 503 on the insights endpoint → explicit UI error while the
  dashboard still renders; deterministic mode with no key), and one full journey (project → task → comment →
  legal status flow → completion reflected in report, dashboard and activity feed).
- Analytics correctness was re-verified against the live database by the existing 12 integration tests
  (SQL report = pure report; SQL daily counts = event-derived counts for 6 filter sets × 3 time zones) and
  `scripts/analytics-live.mjs` (30 internal-consistency checks). No formula was changed in this phase.

## 4. Observed results after fixes

| Gate | Result |
|---|---|
| `npm run lint` | PASS (0 errors / 0 warnings) |
| `npx next typegen` | PASS |
| `npm exec tsc -- --noEmit --pretty false` | PASS |
| `npx vitest run` | **258 passed / 258, 22 files** (38 new tests) |
| `npm run build` | PASS |
| `build_and_start` | PASS; `/api/health` → 200 |
| `npx playwright test` | **40 passed / 40** (5 spec files, Chromium) |
| `node scripts/smoke.mjs` | 44/44 |
| `node scripts/analytics-live.mjs` | 30/30 |
| `node scripts/ai-live.mjs` | 17/17 |
| Browser QA scripts (phase 1 / 2 / 4) | 10/10, 10/10, 10/10; zero runtime errors |
| `npx drizzle-kit push --force` | PASS with the env-driven TS config |
| `npm audit` | **0 critical, 0 high, 0 low, 19 moderate** (all dev-tooling transitive) |
| `npm ls --depth=0` | 2 extraneous optional binaries (see §6) |

## 5. Checks that could not run (explicitly)

1. **Live OpenAI provider call.** No `OPENAI_API_KEY` in the sandbox and no verified egress. The provider is
   covered by mocked-fetch tests (timeout, 429, 401/403, 5xx, malformed output, prompt privacy) and by the
   deterministic fallback verified live. `mode: "ai"` is not exercised against a real model.
2. **MongoDB.** No instance, binaries or Atlas credentials exist; persistence is PostgreSQL per ADR-001.
3. **Multi-instance behaviour.** Login throttle, AI rate limiter and session state are single-process/single-DB;
   no horizontal cluster was available to test.
4. **Load / stress / long-run soak testing.** No performance harness is configured. `EXPLAIN ANALYZE` in
   Phase 5 confirmed an index is used on a 529-event table, which is not a scaling result.
5. **Managed secret history.** The sandbox is not a git repository (`git rev-parse` fails), so it cannot be
   proven that `.env` was never committed. `.gitignore` excludes it and no key literals were found in `src`.
6. **Firefox/WebKit E2E and automated accessibility tooling (axe).** Only Chromium is installed; a11y is
   covered by ARIA attributes, keyboard-focus assertions and manual review, not an automated audit.
7. **DB-outage and provider-network partition testing.** Individual provider failures are mocked; a full
   database outage was not simulated.
8. **`npm audit fix --force`** (breaking upgrades) was deliberately not run.

## 6. Unresolved issues and severity of remaining risk

| Severity | Issue | Impact / mitigation |
|---|---|---|
| **Medium** | Comment/task creation is not API-level idempotent. Two identical POSTs create two rows; only the notifications are deduplicated. The UI disables the submit button while sending. | Double-submitting via an API client duplicates work. Mitigation: add an `Idempotency-Key` header with a DB uniqueness constraint. Not implemented this phase. |
| **Medium** | Login throttle key is the client-supplied `X-Forwarded-For` first value. | Spoofable if the app is exposed without a trusted proxy removing that header. Mitigation: derive the IP from the trusted proxy hop, or key the throttle by account as well. Deployment-level control. |
| **Low** | One `smoke` run reported 42/43. Root cause found: `smoke.mjs` also called the rate-limited AI endpoint as `ava`; isolated to a fresh invited user (F12). | Fixed and re-verified across repeated runs. |
| **Medium** | In-process rate limiting (login + AI insights) and in-process session-related assumptions. | Limits reset on restart and are not shared across instances; a multi-instance deployment needs a shared store (ADR-009, ADR-018). |
| **Medium** | 19 moderate npm advisories remain (dev-tooling transitive: brace-expansion/browserslist/js-yaml/ESLint chain etc.). | No runtime production path identified; `npm audit` reports them as non-runtime dev dependencies. Resolving them needs breaking upgrades. |
| **Low** | Two extraneous optional binaries (`@emnapi/runtime`, `@img/sharp-wasm32`); `npm prune` does not remove them. | Optional Next/sharp platform artifacts. No functional impact observed; build and tests pass. |
| **Low** | `.env` contains local sandbox credentials; no git repo to verify tracking. | `.env.example` documents the shape; `.gitignore` excludes `.env*`; no production secrets found in source. |
| **Low** | No automated a11y or multi-browser suite. | Chromium-only E2E; ARIA/keyboard checks exist but are not a substitute for an axe/WCAG audit. |
| **Info** | Analytics replay is O(workspace history); current-value attributes and current-state dependency edges are documented limitations (ANALYTICS.md §10–11). | Known and documented, not a defect. Rollup table is the upgrade path. |

## 7. Production-readiness statement

**Not claimed.** Evidence supports: a clean strict-typecheck/lint/build, 258 unit + 40 E2E tests passing
against a running local production build, no critical/high dependency advisories, tenant isolation enforced
on every audited route, and honest failure behaviour for the optional AI path. Evidence is **missing** for:
real provider integration, deployment/rollback, secret-management history, horizontal scaling, load/soak
behaviour, and an automated accessibility audit. The Medium items in §6 must be addressed and re-verified
before any production-readiness claim.
