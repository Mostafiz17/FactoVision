# Emergency regression investigation — 8 November 2026

## Confirmed cause and scope

Before repair, the configured database had the twelve pre-remediation application collections but lacked
`invitations` and `auth_limits`. The recent remediation added these to `src/db/setup.ts`'s required
metadata. `getDatabase()` verifies every required collection before returning a handle; with any
session cookie, `getSessionUser()` calls it even for an invalid/expired session.

The resulting chain on `/` is `RootPage` -> `getSessionUser` -> repository `one` -> `getDatabase`
-> `verifyDatabase`, which throws `MongoInitializationError` for missing `invitations` (code 26).
This is the confirmed remediation rollout prerequisite that was not applied to this database.
It is not a `DashboardClient.tsx` rendering defect. Runtime verification must not be bypassed.

Evidence gathered during this investigation:

- `.next/dev/logs/next-development.log` contains both the server exception and browser route-error
  stack for the root route. The root response with an intentionally invalid diagnostic cookie
  contains the reported digest `1196957872` and the missing-invitations exception.
- A read-only metadata query confirms exactly the two missing collections; no customer records
  were queried. `/api/health` returns 500. Without a session cookie, login renders and protected
  navigation redirects; the database failure occurs once an operation needs a database handle.
- A separate Dark Reader extension attribute hydration warning appears in the development log.
  It is not the cause of the reproduced MongoDB exception and was not suppressed.

## Smallest correction applied

The user confirmed the remote database is non-production and explicitly authorized additive setup.
Ran the existing `npm.cmd run db:setup` using the configured environment, then verified with
`npm.cmd run db:setup -- --check`, health, the diagnostic-cookie request and Chromium navigation.
The command creates required collections/validators/indexes, does not seed/import/delete records,
and refuses incompatible existing validators/indexes rather than overwriting them. No application
code change is required to address this confirmed cause.

**Applied successfully to the confirmed non-production database.** Both setup and its read-only
verification exited 0. Local health now returns 200; `/` and `/app` with an invalid diagnostic session
reach login, and `/api/auth/me` correctly returns 401. The root response no longer contains the missing
schema exception or digest `1196957872`. No automatic runtime schema creation, relaxed authentication,
swallowed initialization exception or dummy data workaround was introduced.

## Changes and verification

Only `src/db/__tests__/setup.test.ts` and this investigation record were changed in this turn.
The new test models the old twelve-collection schema, reproduces code 26, applies existing setup,
and verifies existing synthetic records and all old collection metadata/indexes are unchanged.
All earlier uncommitted remediation/user changes were preserved; branch remains `main`.

| Check | Result |
|---|---|
| `npm.cmd test -- src/db/__tests__/setup.test.ts` | 10 passed, including new upgrade regression |
| `npm.cmd test` | 325 passed / 29 files, zero failed; disposable local replica set |
| `npm.cmd run lint` | Passed |
| `npm.cmd run typecheck -- --incremental false` | Passed |
| `npm.cmd run build` | Passed |
| `git -c core.safecrlf=false diff --check` | Passed |
| `npm.cmd run db:setup -- --check` | Expected failure, exit 1: code 26 NamespaceNotFound for invitations; read-only, no changes |
| Configured database metadata | Read-only check: connected; invitations/auth_limits absent; twelve older collections present |
| Isolated Chromium before/after | Production-mode server, old schema, invalid diagnostic cookie: root error boundary + health 500 before setup; login on reload, protected navigation redirected, health 200, auth/me 401 after setup; zero new page/server errors |
| Authorized `npm.cmd run db:setup` | Passed, exit 0; additive setup applied to confirmed non-production database |
| Post-repair `npm.cmd run db:setup -- --check` | Passed, exit 0; required indexes ready |
| Actual local server HTTP checks after repair | Health 200/ok, root/app redirect to login with invalid diagnostic session, auth/me 401; no original digest or initialization error |
| Actual Chromium on localhost after repair | `/`, `/app`, `/login` and reload passed; login visible, error boundary absent, zero page/console errors in unrestricted localhost retry |

Browser screenshots: `tmp/initialization-regression-3a974cae-758c-4d4f-b6ba-44ac971490fb/before.png`
and `after.png`. The replica/server/browser were stopped after the check. No seed or import command
was run. The configured non-production database received only the approved additive schema setup.
The user's existing authenticated browser session was not accessed; verification used a deliberately
invalid diagnostic session, so actual signed-in application navigation was not independently retested.
The earlier 50-browser-test result below belongs to the prior remediation run, not this investigation.

Diagnostic limitations: direct browser attachment was unavailable. The first sandboxed remote metadata
attempt timed out; the authorized read-only retry outside the sandbox succeeded. An initial isolated
browser harness attempt failed before execution because tsx's Windows account lookup returned ENOMEM;
using the already installed esbuild compiler allowed the actual browser assertions above to run and pass.
The first sandboxed post-repair browser check on 127.0.0.1 reached login but failed its zero-console-error
assertion due to development HMR WebSocket handshakes. The subsequent unrestricted localhost retry
passed with zero page or console errors. No source/configuration workaround was applied for that warning.

---

# Website remediation — 8 November 2026

Current work follows the conversation audit. The historical report below is retained.
Baseline: branch `main`; seven pre-existing modified files preserved; lint/typecheck passed;
302 tests passed across 27 files using the disposable test replica set. No production database
operation is needed. Production schema setup, if required, is an explicit operator step.

| ID | Severity | Confirmed root cause / affected area | Correction / regression | Status |
|---|---|---|---|---|
| H-01 | High | Inviter knows a reusable account password; workspace/auth services | Pending invitations, recipient-selected passwords and session-revoking password rotation tested; legacy rotation/email ownership remain | Partial |
| H-02 | High, conditional | Demo UI/accounts not gated at login/session boundary | Non-production flag plus login/registration/session guards; auth/browser tests | Resolved |
| M-01 | Medium | Workspace props initialize retained client state | Workspace-keyed shell; switching browser regression | Resolved |
| M-02 | Medium | Board filters/sorts loaded pages only | Server filtering/global sorting; page-boundary and risk-order tests | Resolved |
| M-03 | Medium | Dependency picker reads only 100 tasks | Search/pagination; browser search for a later-page task | Resolved |
| M-04 | Medium | Infinity is not JSON-safe | Nullable no-pace forecast, meaningful zero backlog; JSON/UI tests | Resolved |
| M-05 | Medium | Date regex accepts impossible dates | Calendar validation; leap/boundary tests | Resolved |
| M-06 | Medium | Dependency temporal policies disagree | Consistent created-at cutoff; historical report/dashboard tests | Resolved |
| M-07 | Medium | Empty ID array loses query restriction | Empty means no-op; real MongoDB integration | Resolved |
| M-08 | Medium | Bulk writes omit notification planning | Assignment/status notifications in transaction; notification/invariant tests | Resolved |
| M-09 | Medium | Removal leaves hidden assignee references | Transactional unassignment, revisions/events; integration | Resolved |
| M-10 | Medium | Restore skips hierarchy validation | Individual/bulk restore recheck final hierarchy; integration | Resolved |
| M-11 | Medium | Notification GET runs a write sweep | Explicit authenticated, origin-checked POST; no-write read test and sweep browser checks | Resolved |
| M-12 | Medium | Process-local throttle/forwarded IP trust | Atomic MongoDB windows and TTL; explicit proxy trust; concurrency tests | Resolved |
| M-13 | Medium | Fallback mode conflates generation and transmission | Independent providerAttempted metadata; service tests | Resolved |
| M-14 | Medium | AI scope differs from dashboard | Full dashboard scope passed to AI; service/validation checks | Resolved |
| M-15 | Medium | Timeout cleared before body parsing | End-to-end deadline; stalled response-body test | Resolved |
| M-16 | Medium | Labels, mobile focus, keyboard, contrast, chart alternatives | Shared labels/keyboard/data tables/focus and overflow corrections; browser checks | Resolved |
| M-17 | Medium | Racing requests and autosave reset drafts | Cancellation/generation guards and serialized saves; autosave browser regression | Resolved |
| M-18 | Medium | Unbounded/repeated data reads | Aggregate counts, first-page comments, request-local risk reuse; whole-history/replies still unbounded | Partial |
| L-01 | Low | Obsolete explanations/internal metadata | Plain-language copy, expandable methods, no version metadata in AI evidence; source/browser/tests | Resolved |
| L-02 | Low | Incomplete async catches/rollback | Toast action/logout errors caught; saved-view rollback and analytics retry; browser failure test | Resolved |
| L-03 | Low | UI offers forbidden actions | Capability/rank gating retained alongside server checks; role browser tests | Resolved |
| L-04 | Low (upstream moderate) | ESLint transitive advisory | Eight moderate advisories remain; npm reports no automatic compatible fix | Deferred |
| I-01 | Informational | Intentional historical attribute limitations | Preserve and disclose; no event-sourcing rewrite | Documented |
| I-02 | Informational | Citation references do not prove claims | Mixed unknown references rejected; UI says reference checking, not semantic truth | Corrected / documented |
| I-03 | Informational | Production/Atlas/restore not exercised | Isolated local production-mode regression only; operator checklist below | Unverified externally |

Dependencies: identity/schema before auth tests; API contracts before client consumers;
data invariants before broad browser regression. No destructive migrations, production writes,
deployment, commit, stash, or reset are authorized by this work.

## 1. Executive summary

The existing Next.js App Router modular monolith, official MongoDB driver, brand and analytics
methodology were preserved. All 24 actionable findings were reviewed against current source.
21 are resolved, two are partially resolved and one dependency advisory is deferred. Three
informational observations are tracked separately and do not inflate the actionable count.
Local verification is green; this is not an unconditional production-readiness certification.

## 2. Findings resolved: files, corrections and evidence

Paths below are relative to the repository. Root causes and original severities are in the checklist.
`R` means [real MongoDB regression tests](src/server/__tests__/remediation.test.ts);
`B` means [browser remediation tests](e2e/remediation.spec.ts). All listed production changes also
passed lint, strict typecheck and the production build. Source review is distinguished from runtime tests.

| ID | Principal files changed | Implemented correction and verification |
|---|---|---|
| H-02 | `src/server/auth/demo.ts`, `session.ts`, `src/server/modules/auth/service.ts`, `src/app/login/page.tsx`, `src/components/auth/LoginClient.tsx` | Explicit opt-in outside production. Reserved demo identities rejected for registration/login/session use. R checks environment policy; B checks production UI/login. Existing synthetic accounts still exercise normal auth. |
| M-01 | `src/app/app/layout.tsx`, `src/components/shell/AppShell.tsx`, dashboard/activity/analytics clients | Workspace ID keys the complete shell subtree; refreshed server props reconcile retained route state. B switches A to empty B and back, checking settings draft and KPI isolation. |
| M-02 | `src/components/board/BoardClient.tsx`, `src/app/app/board/page.tsx`, `src/server/modules/tasks/service.ts`, `src/server/validation.ts` | Search (including labels), filters and sort execute before pagination; risk is globally ordered. Workspace-wide label options, debounce and cancellation. R checks later-page matches and global risk order; B searches beyond 50 tasks. Manual dragging requires an unfiltered fully loaded manual order to avoid invalid indices. |
| M-03 | `src/components/tasks/TaskDrawer.tsx` | Searchable dependency candidates with 50-row pages and load-more, preserving graph validation. B searches a candidate beyond the initial page. Existing cycle/foreign-ID server tests retained. |
| M-04 | `src/lib/domain/analytics.ts`, `types.ts`, `src/components/analytics/AnalyticsClient.tsx` | No-pace/open-backlog forecast is null, rendered as no forecast; genuinely empty backlog remains zero days. R checks JSON roundtrip, zero and positive pace; B checks empty explanation. |
| M-05 | `src/server/validation.ts` | ISO calendar dates validated by Zod rather than shape-only regex. R checks impossible dates, non-leap February and valid leap day for create and patch. |
| M-06 | `src/lib/analytics/report.ts`, `definitions.ts`, `ANALYTICS.md`, analytics integration fixture | Dependencies created after the replay instant do not affect historical blockage. R and existing report integrations check the cutoff; fixtures now explicitly date historical edges. No fixture expectation was weakened to accommodate incorrect behavior. |
| M-07 | `src/server/modules/collaboration/service.ts` | An explicitly empty ID list generates an empty match rather than removing the ID predicate. R verifies zero updates, unchanged unread count, and separate omitted-ID mark-all behavior. |
| M-08 | `src/server/modules/tasks/service.ts` | Bulk assignment and status mutations plan notifications inside the same workspace transaction. R verifies both notification kinds; existing stale-revision/transaction tests retain rejection coverage. |
| M-09 | `src/server/modules/workspaces/service.ts` | Removing a member clears their assignee IDs, increments task revisions and writes assignment events in the transaction. R verifies storage, unassigned filtering and event history. |
| M-10 | `src/server/modules/tasks/service.ts` | Restores revalidate active project and parent/workspace/project hierarchy in the serialized transaction. R rejects individual and bulk child restore after the parent moves. |
| M-11 | `src/app/api/notifications/route.ts`, collaboration service, `src/components/shell/AppShell.tsx` | GET/page reads no longer generate alerts. Polling explicitly POSTs an authenticated origin-checked sweep before reading. R checks no read mutation; `e2e/collaboration.spec.ts` checks generated/deduplicated deadline alerts. |
| M-12 | `src/server/auth/limits.ts`, auth/AI services, `src/db/schema.ts`, `repository.ts`, `setup.ts`, auth route handlers | Shared atomic hashed-key counters enforce fixed ten-minute windows independent of TTL cleanup. Forwarded IP ignored unless TRUST_PROXY is explicitly enabled. R checks concurrent capacity and separate windows. Fixed windows intentionally permit boundary bursts; without a trusted proxy the client bucket is shared. |
| M-13 | `src/lib/ai/types.ts`, `src/server/modules/ai/service.ts`, `src/components/dashboard/AiPanel.tsx` | providerAttempted is independent of deterministic/generative output mode. Mocked service tests check no-key/no-egress, attempted-provider fallback and unauthorized rejection before provider calls. UI disclosure follows the metadata. |
| M-14 | `src/server/validation.ts`, AI route/service, `src/components/dashboard/DashboardClient.tsx` | Days, timezone and all current dashboard filters reach the same dashboard source used for AI evidence; scope changes remount the panel. Service tests check forwarding days/timezone/project scope; existing filter/tenant API tests retained. |
| M-15 | `src/server/modules/ai/openai.ts`, `__tests__/openai.test.ts` | Deadline covers fetch plus response JSON parsing, with abort and a rejecting timeout even if a mocked transport ignores abort. Stalled-body, HTTP/error and malformed-output tests pass. Output budget is bounded. |
| M-16 | `src/components/ui/index.tsx`, `overlays.tsx`, shell, form/settings/task clients, chart components, `src/app/globals.css` | Label associations, keyboard task activation, focusable tooltip triggers, mobile modal focus containment/restoration, readable shared text colors and chart data tables. B tests Space activation, repeated Tab/Escape, data-table availability and no document overflow on all six app routes at 1440/768/375px. Screenshot review: mobile dashboard, tablet analytics and desktop settings. This is not a full WCAG or assistive-technology certification. |
| M-17 | dashboard/activity/analytics clients, board, task drawer, risk settings | Abort/request generations reject obsolete responses; workspace key prevents cross-workspace retained state; autosaves serialize against current revisions without replacing other drafts. B changes priority with an unsaved description then checks persisted description. Adversarial reversal of every possible request pair was not browser-tested. |
| L-01 | login, dashboard, analytics, settings, task drawer, error/not-found components, `src/lib/ai/evidence.ts` | Outdated six-factor explanation corrected to four; regular UI drops revisions/raw IDs and misleading configuration/debug copy. Mathematical methodology remains expandable; advanced risk details remain useful. AI evidence no longer supplies model/config revision prose. Evidence tests and source search confirm removal; B checks forecast copy. |
| L-02 | `src/components/toast.tsx`, shell, board, analytics | Async action/logout errors are caught; failed optimistic saved-view deletion restores the view; analytics offers retry. B injects DELETE 503 and checks error, restored UI and unchanged persisted view; existing browser test checks failed insights without losing dashboard. Logout error handling additionally reviewed in source. |
| L-03 | `src/components/projects/ProjectsClient.tsx`, `src/components/settings/SettingsClient.tsx` | Empty-state create action uses project capability; removal controls follow self/role rank rules. Server authorization remains authoritative. Existing security lifecycle and read-only project-manager risk-settings browser tests pass; visibility conditions reviewed directly. |

## 3. Remaining findings

- **H-01 (High), partial:** New invitations store only email/role/expiry and do not create or reveal
  a password. Recipients choose their password during registration. Authenticated password rotation
  verifies the old password, uses a conditional update and revokes other sessions. Changes are in
  workspace/auth services, `src/server/auth/credentials.ts`, `src/app/api/auth/password/route.ts`,
  `src/components/settings/AccountSecurity.tsx`, schema/setup/repository/import and settings UI.
  R and B cover invitation acceptance/expiry, permission rejection, wrong password, successful
  rotation, old-password rejection and session invalidation. **Still required:** rotate legacy shared
  credentials through a trusted process; old records have no reliable provenance marker. Email
  delivery and proof of email ownership are absent; registration with an invited email is not proof
  that the registrant owns the mailbox. A verified-email/invitation ownership flow needs an approved
  delivery mechanism. No customer credentials were automatically rewritten.
- **M-18 (Medium), partial:** Project counts now use aggregation and PATCH returns actual counts;
  task detail initially returns 20 comment roots with a next cursor; UI can load more; risk context is
  reused per React server request and analytics reuses its loaded source. AI evidence is bounded with
  disclosed truncation. Changes: tasks/projects/analytics services, drawer, DTOs, AI evidence.
  R verifies project counts and 20+5 root pagination. **Still required:** bound per-thread replies,
  full-history risk/analytics inputs and other complete detail collections for very large tenants.
  Arbitrary truncation would corrupt analytics or silently lose replies; a cursor/snapshot contract
  and realistic large-tenant load measurements are needed before declaring this resolved.
- **L-04 (Low; upstream Moderate), deferred:** `npm audit` still reports eight moderate ESLint/
  TypeScript-ESLint dependency-tree advisories associated with minimatch
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), zero high/critical/low.
  Audit reports no automatic compatible fix. No dependency versions or lockfile were changed.
  Revisit when a compatible upstream toolchain repair is demonstrated; force/major upgrades were not applied.
- **I-01, documented:** Historical status/dependency replay is not complete versioned history of
  every mutable attribute. Current assignee/estimate attribution limitations remain explicit.
- **I-02, corrected/documented:** Mixed known/unknown references now reject the item instead of
  silently retaining the known subset; tests updated. Reference checking does not prove generated
  prose is semantically true. UI wording now states that limit; human review remains necessary.
- **I-03, unverified externally:** No deployed environment, Atlas privileges, backup restore,
  real provider transmission, multi-instance deployment or production load test was exercised.

## 4. Changed files and preserved work

Important groups are mapped by ID above. Documentation updated: `README.md`, `.env.example`,
`ARCHITECTURE.md`, `ANALYTICS.md`, `AI.md` and this report. New infrastructure is additive:
invitations/auth-limit schema, password endpoint/form, and isolated browser runner
`scripts/browser-regression.mjs` exposed as `npm run test:e2e`. Existing test files were adapted to
the secure invitation and explicit sweep contracts; dedicated remediation and AI service suites added.

The baseline's seven modified paths were preserved: README plus
`src/app/api/health/route.ts`, `src/db/__tests__/errors.test.ts`, `src/db/errors.ts`, `src/db/index.ts`,
`src/lib/domain/__tests__/env.test.ts`, `src/server/env.ts`. Only an additive operations section was
inserted in README; the other six were not edited by this remediation. No reset, stash, commit,
branch switch, deployment, dependency install or configured-database mutation was performed.

## 5. Test results

| Command/check | Observed result and limitation |
|---|---|
| Baseline `npm.cmd run lint` | Passed |
| Baseline `npm.cmd run typecheck -- --incremental false` | Passed |
| Baseline `npm.cmd test` | 302 passed, 27 files; disposable replica set |
| Final `npm.cmd run lint` | Passed, exit 0 |
| Final `npm.cmd run typecheck -- --incremental false` | Passed, exit 0 |
| Final `npm.cmd test` | 324 passed, 29 files; disposable replica set |
| Final `npm.cmd run build` | Passed; optimized Next.js production build, including password route |
| Final `npm.cmd run test:e2e` | 50 passed, zero failed (1.0m); Chromium, isolated synthetic replica set and local production server |
| `npm.cmd audit --json --ignore-scripts` | Exit 1: eight moderate, zero high/critical/low; L-04 retained |
| `git -c core.safecrlf=false diff --check` | Passed |
| Targeted source searches | No ordinary raw zero-division/model-revision marketing copy; EWMA formula and task risk metadata intentionally remain in expandable methodology |

During implementation, tests exposed fixture assumptions about auto-created invite accounts and
historical edge timestamps; these were corrected to model the intended contracts. The first broad
browser run passed 43/48: old demo/copy selectors, Unicode edit corruption and a genuine 11px mobile
header overflow caused failures. Those issues were corrected; a later full run passed 49/49 before
the additional rollback test was added. Tests were not disabled, and compiler/lint settings were
not relaxed. Node emits DEP0205 deprecation warnings; they do not fail the checks.
Final browser screenshots/artifacts are in ignored
`tmp/regression-c89bfce8-e8bb-4757-9a28-58b8910d6a3e/results/`.

## 6. Security and data integrity

Regression coverage includes unauthenticated rejection, cross-tenant reads/writes, role enforcement,
CSRF origins, session rotation/logout, concurrent signup, stale revisions, notification deduplication,
invalid dependencies and date/filter rejection. New counters are shared atomic database state, not a
process-local security boundary. Only explicitly trusted proxies may supply client IPs. A fixed window
and a shared untrusted-client bucket have documented operational tradeoffs; they are not a WAF.
No secret values or real customer records were needed for tests. New schema setup was exercised only
against disposable test databases. H-01 and the external checks above remain deployment considerations.

## 7. Frontend and user experience

Browser coverage includes `/login` (login and registration modes) and all implemented app routes:
`/app`, `/app/board`, `/app/projects`, `/app/analytics`, `/app/activity`, `/app/settings`.
The six app routes were checked at 1440, 768 and 375px for visible headings, runtime exceptions and
document overflow. Functional tests also cover populated seeded data, fresh empty accounts, error
responses, task/project/comment/status flows, filters, workspace switching and keyboard navigation.
The root redirect and every conceivable dialog/filter combination were not separately exhaustively
visual-tested; 404/global failure screens were source/build reviewed. No password-recovery/email
delivery flow exists to verify. Screen readers, browser/OS matrix, zoom and full WCAG review remain manual.

## 8. Regression risks

- Invitation response changes from a disclosed credential to `{ member, pending, email }`; built-in
  callers/tests were updated. External consumers must adapt. Names are chosen by recipients.
- Forecast days now use `number | null`; all built-in rendering/types/tests updated. External consumers
  must treat null as unavailable, not zero.
- Deadline generation is an explicit POST; old GET-only integrations will read existing notifications
  without generating new deadline alerts. Built-in polling uses both requests.
- Removing a member changes assigned-task revisions; stale clients correctly receive a conflict.
- Demo sessions stop working in production deliberately. Existing real accounts must use normal login.
- Risk sorting is correct globally but still needs full workspace scoring; see M-18. Filtered/partial
  boards do not allow manual dragging into ambiguous global positions; status controls remain available.
- Additive schema/index setup must precede rollout. Replica-set transactions are still required.

## 9. Deployment readiness

**Locally buildable and regression-tested; production rollout remains conditional.** Before rollout:

1. Review backups and run the revised additive `npm run db:setup` through the normal operator process
   to provision invitations/auth_limits validators, unique/TTL indexes and appropriate Atlas permissions.
   This was not run on the configured database. Rehearse setup and restore on staging.
2. Rotate legacy invited-user credentials through a trusted identity process. Provision verified-email
   delivery/ownership checks wherever mailbox ownership is required for invitation acceptance.
3. Keep demo disabled in production; enable TRUST_PROXY only when the proxy overwrites forwarding
   headers. Verify rate limits across deployed instances with intended legitimate traffic.
4. Verify staging flows, real-provider disclosure/timeouts with approved test data, monitoring and
   large-tenant latency/memory. Review the remaining tooling advisory and M-18 sizing before rollout.

## 10. Final status

Actionable: **24 total = 21 resolved + 2 partial + 1 deferred**. Three remain outstanding when partial
and deferred findings are included; zero additional wholly unaddressed actionable findings. The three
informational observations are separate. Latest unit/integration result: **324 passed, zero failed**.
Final browser result: **50 passed, zero failed**. Lint, typecheck, build and diff whitespace checks pass;
the dependency audit remains nonzero for the deferred moderate advisories. No production deploy or
data change was performed. Manual steps are listed in section 9; this report does not silently close them.

---

> Historical phase record. These results describe the earlier implementation. Current remediation
> results are above; MongoDB migration background is in MONGODB_MIGRATION.md and ARCHITECTURE.md.

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
