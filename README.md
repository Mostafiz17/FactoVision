# FactoVision by Factoryze

**See Progress. Build Better.**

Team task management, collaboration, explainable deadline-risk scoring, mathematically
defined analytics, and optional AI insights. The existing UI and JSON API use a
Next.js modular monolith with the official MongoDB Node.js driver and MongoDB Atlas.

Read ARCHITECTURE.md, ANALYTICS.md, RISK.md, AI.md, and MONGODB_MIGRATION.md for the contracts,
migration/cutover procedure, verification evidence, and remaining limitations.
Older phase results in AUDIT.md and TASKS.md are historical.

## Setup

Node.js 20.19+ is required by the MongoDB driver. This migration was tested with Node.js 24.
Use MongoDB Atlas or a local MongoDB replica set; standalone servers cannot run the
multi-document transactions required by this application.

```powershell
npm install
# Keep the existing private .env.local with MONGODB_URI and MONGODB_DB.
# For a new checkout only, create it using .env.example as a template.
npm run db:setup
npm run db:setup -- --check
npm run build
npm start
```

On PowerShell installations that block npm.ps1, use npm.cmd in place of npm.
CLI scripts use Next.js's environment loader, including .env.local, rather than loading
only .env. Setup defaults to production file precedence to match npm run start; explicit
NODE_ENV=development selects development files. Existing process variables have priority.
The --check option verifies required indexes without changing database metadata or records.
Setup errors include sanitized MongoDB codes/messages without credentials or connection URIs.
Atlas must allow the application host's IP and the credentials must have access to
the named database. Use a setup account allowed to create collections, validators,
and indexes for db:setup; application startup verifies indexes without changing them.
See MONGODB_MIGRATION.md for metadata privileges and cutover details.
See MONGODB_INITIALIZATION.md for the initialization failure diagnosis and verification results.

The optional `npm run seed` creates the existing Nova Product Lab demo dataset
(60-day history, five users, three projects, tasks, dependencies, comments, notifications,
and saved views). It refuses nonempty databases and production mode. Never seed an
existing/production database. Demo password: `demo1234`; users:
`ava@cadence.dev` (owner), `noah@cadence.dev` (admin),
`mira@cadence.dev` (project manager), `leo@cadence.dev`, `zoe@cadence.dev` (members).

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Vitest starts a disposable MongoDB replica set, initializes validators/indexes, runs
domain and database integration tests, then stops it. It always overrides database
settings for its workers and never targets Atlas or your existing database.
The first run downloads the MongoDB server; binaries are cached in ignored
`tmp/mongodb-binaries`. Alternatively set `MONGOMS_SYSTEM_BINARY` to a compatible
local mongod executable. Test data is not persisted in your application database.

Browser checks require a running server with a dedicated seeded database and Chromium:
`npx playwright test`. Existing smoke/analytics/AI scripts also require that server.
No production database is needed for builds: connections and environment parsing are lazy.

## Identity, authorization, and persistence

All entity IDs and references remain UUID strings. MongoDB `_id` equals the public
`id`; ObjectIds are never introduced. Session IDs remain SHA-256 token hashes.
This preserves API validation, saved views, task links, and pagination cursors.

The capability matrix stays `owner > admin > project_manager > member`.
Role changes are owner-only. Authorization is enforced by server services; cross-tenant
IDs return 404. Owner protections, task revisions, soft deletion/undo, legal status
transitions, subtasks, cycle checks, comments/replies/mentions, feed pagination,
notification dedupe, risk configuration, analytics, dashboards and AI fallback are retained.

Atomic changes use MongoDB transactions with majority write concern. Workspace mutations
take a coordination write before rechecking membership and changing documents; concurrent
changes retry with a fresh snapshot. No dual writes to a legacy database exist.

## Existing data and deployment

`npm run db:import -- snapshot.json` validates an offline snapshot without connecting.
Add `--apply` only for an initialized, empty MongoDB target. The importer preserves IDs,
password hashes and session hashes and commits all collections atomically.
Snapshot format and a read-only export recipe are documented in MONGODB_MIGRATION.md.

Deployment requires `MONGODB_URI`, `MONGODB_DB`, setup, optional data import, then a new
application build. Health probe: `GET /api/health` checks MongoDB readiness and ping.
No production/Atlas cutover is performed by editing this repository.
