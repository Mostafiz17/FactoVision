# Architecture - FactoVision by Factoryze

## Stack and layers

Next.js 16 App Router, React 19, strict TypeScript, Tailwind v4/Radix primitives,
MongoDB Atlas with the official Node.js driver, Zod, Recharts/D3, Vitest and Playwright.

UI and server pages ? thin route handlers ? authorized services ? typed MongoDB repositories.
Pure analytics/risk/notification/lifecycle modules remain independent of IO.
Environment access goes through src/server/env.ts. No database connection is opened on import.

## Persistence

- src/db/schema.ts: typed documents for users, sessions, workspaces, memberships, projects,
  tasks, task_dependencies, task_events, comments, notifications, saved_views, risk_configs.
- src/db/index.ts: pooled client, lazy readiness, AsyncLocalStorage session propagation,
  retryable snapshot transactions with majority writes, and explicit connection cleanup.
- src/db/repository.ts: native driver queries, updates, aggregation, defaults and DTO ID mapping.
- src/db/setup.ts: collection validators, unique/compound/TTL indexes and readiness verification.
- src/db/import.ts: validated offline snapshot adapter and atomic import into an empty target.
- scripts/db-setup.ts: explicit metadata setup; runtime verifies metadata without altering it.

IDs are UUID strings in both id and _id, and every reference is a UUID string. Session IDs
are SHA-256 hashes. Dates are BSON Dates, arrays remain arrays, config documents remain objects.
Validators reject mixed ID types, invalid roles/statuses/priorities, and invalid date types.

Unique indexes cover email, workspace slug, workspace/user membership, dependency edges,
risk workspace and notification user/dedupe key (partial, only string keys).
Sessions have expiresAt TTL with expireAfterSeconds=0; session lookup independently rejects
expired records because TTL removal is asynchronous. Workspace-prefixed indexes cover board
ordering, project/assignee/parent/label filters, event history, comments, feeds and saved views.

## Transactions and concurrency

Registration creates the user, workspace, and owner membership in one transaction.
Session rotation deletes the presented session and inserts its replacement atomically;
cookies are written only after commit. Logout invalidates the stored hash.

All workspace mutations perform a real mutationVersion increment on the workspace document.
This replaces row-lock semantics: conflicting operations retry from a fresh snapshot.
Membership and capabilities are rechecked inside that transaction. Task version predicates
remain compare-and-swap guards and stale edits return 409. Task projections, events, notifications,
reordering, comments and graph changes commit together. Transaction callbacks run sequentially
and do not retain mutable result counters across retries.

Dependency-cycle checks run under the same workspace coordination write. Project deletion
explicitly cascades tasks, dependencies (both endpoints), comments, events and notifications
in one transaction. MongoDB does not provide foreign keys; service-level reference checks
validate assignee membership, project/parent workspace, one-level hierarchy, and reply targets.
No production write is sent to two databases.

## Authorization and API

Public endpoints are register, login, logout and health; other APIs require session authentication.
Every scoped service checks membership and the existing capability matrix in
src/server/auth/permissions.ts. The ladder remains owner > admin > project_manager > member.
Role changes are owner-exclusive. Owners cannot leave, be removed or demoted; administrators
remove only lower ranks. Nonmembers receive 404. CSRF Origin checks, password hashing, session
cookie security, request validation and failure-only login throttling are unchanged.

The existing route inventory and JSON DTOs are retained: auth/me; workspaces/members; projects;
task CRUD/bulk/dependencies/comments; saved views; activity; notifications; analytics/report;
dashboard; risk/config; AI insights; health. UUID schemas, task revisions, tags/labels alias,
soft-delete/restore, pagination cursors and date serialization are preserved.
Task searches escape regular expressions; explicit status/priority sort ranks and null-last due
dates preserve the old ordering contract.

## Analytics, risk, and AI

The analytics repository loads workspace-scoped projections, replayable events up to asOf,
and dependency edges. Daily counts use a MongoDB $match/$lookup/$dateToString/$group pipeline,
including tenant scoping, IANA timezone and half-open/asOf boundaries.
The domain replay/report builder and all formulas remain unchanged. Database integration tests
compare aggregation results to pure event-derived counts for six filters and three timezones.

Dashboard and risk consume the same analytics source. Risk configuration retains optimistic
revisions and model validation. AI receives only an authorized evidence bundle; absent credentials
or provider failures still use the disclosed deterministic fallback.

## UI and tests

Server components call authorized services; client components retain API-driven optimistic updates.
The prior React fixes remain: initialized overlay state, guarded async callbacks, URL task selection
and a hydration-safe timezone snapshot. No ESLint rules are disabled.

Vitest uses a disposable replica set and never an existing database. Tests exercise native queries,
indexes/query plans, rollback, authentication, membership, task concurrency/lifecycle, graph safety,
cascades, collaboration and analytics. Browser checks require a dedicated seeded running instance.
See MONGODB_MIGRATION.md for actual verification and Atlas deployment requirements.
