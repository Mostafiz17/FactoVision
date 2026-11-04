# MongoDB Atlas migration ? 4 November 2026

## Scope and status

The existing Cadence application now uses the official MongoDB Node.js driver for all active
persistence. PostgreSQL/Drizzle code, schema tooling and packages were removed.
The UI, routes, JSON DTOs, UUID validation, authentication scheme, permissions and domain formulas
were retained. Source migration and local verification are separate from Atlas deployment:
no Atlas cluster, existing database, or production record was modified.

## High-risk decisions

- **Identity:** all document IDs and references remain UUID strings; _id equals id.
  Sessions retain SHA-256 token-hash IDs. There is no ObjectId conversion.
- **Atomicity:** registration, session rotation, task/events/notifications, comments, bulk
  operations, ordering, cascades and offline import use MongoDB transactions. Replica sets
  or sharded Atlas deployments are required. There is no standalone/nonatomic fallback.
- **Concurrency and authorization:** workspace mutations increment mutationVersion before
  rechecking permissions. Conflicting transactions retry from a fresh snapshot. Task/config
  revision checks still return 409; dependency cycles cannot race past the coordination write.
- **References:** services explicitly validate projects, assignees, parents and replies.
  Project deletion explicitly removes related documents inside its transaction.
- **Analytics:** native aggregation uses workspace-scoped lookup, dateToString with IANA zones,
  half-open windows and asOf boundaries. The replay/statistics/domain model is unchanged.
- **Indexes:** unique email/slug/membership/dependency/risk/dedupe indexes, compound query indexes,
  and session expiration TTL are declared centrally. Expired sessions are rejected independently
  of asynchronous TTL deletion. Runtime checks index metadata; only db:setup changes metadata.

## Required environment and setup

Set server-only variables in a private .env.local or the deployment environment:

- MONGODB_URI: an Atlas mongodb+srv:// URI (or mongodb:// replica-set URI).
- MONGODB_DB: explicit database name; letters, digits, underscores and hyphens.
- Optional OPENAI_API_KEY, AI_MODEL, AI_TIMEOUT_MS retain their earlier behavior.

Do not use NEXT_PUBLIC_ prefixes. The retired DATABASE_URL setting is not read.
URL-encode username/password components and allow the application host's IP in Atlas.
Use supported Node.js 20.19+; local verification used Node.js 24.20.

Run npm install, then npm run db:setup with the target variables. Setup creates collections,
validators and indexes, and verifies metadata. It never drops conflicting indexes or data:
incompatible metadata causes a failure for operator review. Existing documents are not
rewritten by collMod; use an empty target for migration.

The setup principal needs listCollections/listIndexes and createCollection/createIndex privileges
when metadata is missing. Matching collections/indexes are left unchanged on reruns. collMod is
used only to initialize an empty collection that has no validator; populated/custom schemas are
never silently replaced. See MONGODB_INITIALIZATION.md for the CLI environment-loading fix.
The runtime principal needs find/insert/update/remove, listIndexes and transaction access
to the application database; runtime startup does not modify validators/indexes.
Use database-scoped credentials and Atlas network restrictions, not broad admin credentials.

The health endpoint checks readiness and MongoDB ping. Connections and env parsing are lazy,
so npm run build does not need credentials or a reachable database.

## Existing data: offline cutover

No legacy database was available in this workspace, so no real data transfer was performed.
The importer supports a coordinated offline cutover; it does not implement replication or dual writes.

1. Back up the source and stop application writes before the final snapshot. Keep the old deployment
   stopped until the new deployment is verified to avoid divergent writes.
2. Export all twelve tables from one consistent read snapshot into one private UTF-8 JSON object.
   Keys are users, sessions, workspaces, memberships, projects, tasks, task_dependencies, task_events,
   comments, notifications, saved_views, risk_configs. Each value is an array, including empty arrays.
   Preserve IDs, arrays, JSON configs, password_hash, hashed session id, and expiration timestamps.
3. A read-only PostgreSQL export can use the external psql client; it is not an application dependency.
   For example, run the following query in a read-only transaction and use psql's
   --tuples-only --no-align --quiet --output migration-snapshots/snapshot.json options
   (avoid PowerShell's legacy UTF-16 output redirection). Keep credentials outside command history.

```sql
BEGIN READ ONLY;
SELECT json_build_object(
  'users', COALESCE((SELECT json_agg(t) FROM users t), '[]'::json),
  'sessions', COALESCE((SELECT json_agg(t) FROM sessions t), '[]'::json),
  'workspaces', COALESCE((SELECT json_agg(t) FROM workspaces t), '[]'::json),
  'memberships', COALESCE((SELECT json_agg(t) FROM memberships t), '[]'::json),
  'projects', COALESCE((SELECT json_agg(t) FROM projects t), '[]'::json),
  'tasks', COALESCE((SELECT json_agg(t) FROM tasks t), '[]'::json),
  'task_dependencies', COALESCE((SELECT json_agg(t) FROM task_dependencies t), '[]'::json),
  'task_events', COALESCE((SELECT json_agg(t) FROM task_events t), '[]'::json),
  'comments', COALESCE((SELECT json_agg(t) FROM comments t), '[]'::json),
  'notifications', COALESCE((SELECT json_agg(t) FROM notifications t), '[]'::json),
  'saved_views', COALESCE((SELECT json_agg(t) FROM saved_views t), '[]'::json),
  'risk_configs', COALESCE((SELECT json_agg(t) FROM risk_configs t), '[]'::json)
);
COMMIT;
```

4. Run npm run db:import -- migration-snapshots/snapshot.json. Default behavior validates only,
   with no database connection. It accepts snake_case or camelCase fields, converts timestamps to BSON
   Dates, preserves IDs/hashes, and checks duplicate IDs, references, tenant boundaries, ownership,
   subtask/thread structure and dependency cycles. Dependencies gain internal UUID IDs; risk-config
   IDs use workspace IDs because those legacy tables did not have independent entity IDs.
5. Initialize an empty Atlas target with db:setup, then explicitly run
   npm run db:import -- migration-snapshots/snapshot.json --apply.
   The importer refuses populated targets and commits all collection writes in one transaction.
   Native collection validators and unique indexes reject invalid input and roll back the transaction.
   A coordination record also prevents simultaneous empty-target imports.
6. Compare per-collection counts and representative analytics reports at a fixed asOf, exercise
   login/session rotation/membership/task workflows, check health, then switch traffic to the MongoDB build.
   Existing unexpired browser sessions can continue because cookie names and stored token hashes match.
7. Retain the source backup and new-target backup until sign-off. Before reopening writes, rollback
   can restore the old deployment. After new writes begin, rollback requires reconciling those changes;
   do not simply restart two writable deployments.

Snapshots contain private account/session data. migration-snapshots/ is ignored by Git.
No production import/export command was executed. The psql recipe has not been run against a real
legacy database here. Large snapshots may exceed transaction time/resource limits and need a separately
reviewed offline migration job; the current importer is intentionally atomic and memory-bounded by
the supplied snapshot, not an online large-dataset sync service.

## Changed files

- src/db/index.ts, schema.ts: replaced the SQL client/schema with MongoDB client/session handling and
  document types. New repository.ts, setup.ts and import.ts implement native IO, metadata and import.
- src/server/auth/guard.ts, session.ts, modules/auth/service.ts: MongoDB membership/session/account
  persistence; preserved scrypt, cookies, rotation, expiry, throttling and 401/403/404 behavior.
- modules/workspaces/service.ts: workspaces, members, protected role changes and per-user saved views.
- modules/projects/service.ts: project CRUD and transactional deletion cascades.
- modules/tasks/service.ts: native filters, sorting, paging, hierarchy, revisions, event/notification
  writes, reorder/bulk/undo and dependency serialization; added authorized distinct-label loading.
- modules/collaboration/service.ts: comments/replies/mentions, activity joins, keyset feeds,
  deadline sweeps, notification dedupe and read-state ownership.
- modules/analytics/repository.ts and service.ts, modules/dashboard/service.ts, modules/risk/service.ts:
  native source loading/aggregation/config storage while retaining domain calculations.
- src/app/app/page.tsx: replaced the direct SQL labels query with the authorized task service.
- src/app/api/health/route.ts: MongoDB readiness and ping.
- src/server/env.ts, db-errors.ts: MongoDB settings and duplicate-key error 11000.
- src/lib/domain/errors.ts, src/server/http.ts: shared error class preserves HTTP status behavior
  for missing workspaces without coupling repositories to the transport.
- scripts/db-setup.ts, import-data.ts, seed.ts: explicit setup, validation-first import, and
  transactional demo seeding that refuses nonempty targets and production mode.
- src/test/global-setup.ts, vitest.config.mts: isolated real replica-set testing; replaced the old
  CommonJS-loaded Vitest config so the native-loader warning is removed.
- src/server/__tests__/mongodb.test.ts, audit.test.ts, src/db/__tests__/import.test.ts,
  src/lib/domain/__tests__/env.test.ts, analytics/__tests__/integration.test.ts:
  migration, security, rollback, query/index, import and analytics regression coverage.
- src/components/charts/CycleHistogram.tsx: explicitly registers d3-transition, fixing a production
  chart crash found by browser verification while preserving the existing animation.
- src/components/dashboard/DashboardClient.tsx: disables filters until hydration attaches handlers,
  fixing an early selection that could otherwise be lost. Existing hooks fixes remain in place.
- package.json/package-lock.json: official MongoDB driver, test-server and explicit D3 transition
  dependency; removed pg, @types/pg, drizzle-orm, drizzle-kit; setup/import/seed scripts added.
- .env.example, .gitignore, eslint.config.mjs, README.md, ARCHITECTURE.md, DECISIONS.md,
  ANALYTICS.md, PROJECT_SPEC.md, AUDIT.md and TASKS.md: current configuration, ignored generated/private
  artifacts, and clearly marked historical phase notes. No ESLint rules were disabled.
- Removed drizzle.config.ts and the obsolete Vitest config filename.
- Verification generated ignored .next, next-env.d.ts, tsconfig.tsbuildinfo, test-results,
  Playwright traces and temporary binaries/scripts; these are not application source.

## Verification

Commands used npm.cmd because this PowerShell policy blocks npm.ps1. Final observed results:

| Check | Actual result |
| --- | --- |
| npm.cmd run lint | Exit 0; zero errors/warnings; no rules disabled. |
| npm.cmd run typecheck | Exit 0. |
| npm.cmd test | Exit 0; 284 tests passed across 24 files, using a real disposable replica set. |
| npm.cmd run build | Exit 0; optimized production build, with no database credentials/placeholder variables needed. |
| Existing Playwright browser suite | Exit 0; 40/40 passed against the built application and an isolated seeded MongoDB replica set. |
| Setup/seed logic | Passed on the isolated database: validators/indexes verified, five users, three projects and 117 tasks committed. See the sandbox runner limitation below. |
| npm.cmd audit --json | Exit 1; 15 moderate development-tooling findings, zero high/critical/low. No forced fix applied. |
| npm.cmd audit --omit=dev --json | Exit 0; zero findings. |
| npm.cmd ls mongodb d3-transition drizzle-orm drizzle-kit pg @types/pg --depth=0 | Exit 0; MongoDB 7.8.0 and d3-transition 3.0.2 present; retired packages absent. |
| Active-source/lockfile scan | No PostgreSQL or Drizzle imports, queries, tooling, dependencies, or DATABASE_URL references remain. Negative validation tests and historical documentation intentionally mention the old stack. |

Database tests exercise unique and partial indexes, session TTL metadata and read-time expiration,
the board query's actual winning index plan, transaction rollback, registration/session rotation,
owner-only role changes, access revocation, cross-tenant operations, stale/concurrent edits,
concurrent cycle prevention, bulk rollback, hierarchy/order/search, comments/feeds/notifications,
saved-view ownership, risk revisions, cascades, and MongoDB aggregation parity with domain reports.
Offline importer tests cover ID/hash/date preservation, invalid snapshots, ownership/reference checks,
and refusal to overwrite populated targets. Real legacy export/import parity remains unverified.

The 15 moderate advisories are inherited through ESLint tooling (minimatch glob amplification,
GHSA-g3hv-75wg-m249). npm suggests incompatible tooling replacements; no forced downgrade or major
override was used. Removing the Drizzle toolchain also removed its nested esbuild advisory path.

Earlier checks caught a TypeScript union annotation in readiness verification, now corrected.
The initial browser run reported 37 passed, 2 failed and 1 skipped: a D3 prototype-registration crash
and an interaction-before-hydration race. Both received small source fixes; the final rerun passed all 40.

This Windows sandbox prevents tsx from reading OS account information (uv_os_get_passwd/ENOMEM).
For local browser verification only, the unchanged setup/seed entry points were compiled to ignored
temporary CommonJS scripts with esbuild, then run against the disposable database. Ordinary npm
setup/seed commands still use tsx; this is a sandbox tooling limitation, not an Atlas connection test.

## Remaining deployment work and limits

No live Atlas connectivity, access-list configuration, database-user privileges, deployment,
production import, or real-source data parity check has been performed. Configure the required
variables, run setup, follow the offline cutover procedure if data exists, and verify the deployed app.
Local replica-set results establish driver/query/transaction behavior; they do not establish Atlas
networking or production-scale performance.

The existing O(workspace history) analytics replay, per-process login/AI rate limiting, and lack of
API-level Idempotency-Key support remain documented limits. Workspace-level serialization trades
write parallelism for predictable consistency; measure contention before scaling large busy tenants.
