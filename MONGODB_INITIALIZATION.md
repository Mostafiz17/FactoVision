# MongoDB initialization fix

## Confirmed root cause

The application used Next.js environment loading, while `scripts/db-setup.ts` imported
`dotenv/config`, which loads `.env` by default. This workspace has `.env.local` with both
required settings, no `.env`, and no inherited MongoDB settings. Setup therefore failed
before connecting, with environment-validation errors for `MONGODB_URI` and `MONGODB_DB`.
Its generic catch handler suppressed those errors.

The old loading path was reproduced without a database connection or credential output:
`Invalid environment configuration — MONGODB_URI: MONGODB_URI is required;
MONGODB_DB: MONGODB_DB is required`. The corrected loader read `.env.local` and passed
the same validation. No credential values were displayed or changed.

The runtime code-26 error is a separate consequence of missing initialization:
`getDatabase()` checks required indexes before returning any collection repository.
`verifyDatabase()` calls `listIndexes()` on `users`, which throws `NamespaceNotFound`
when that collection does not exist. Runtime does not create collections automatically.

All user reads/writes use `store.users` through that readiness gate: login/registration,
session resolution, workspace membership joins/invites, notification actor lookup, and
shared member loading for tasks/analytics/dashboard. There was no competing database
selection path or evidence requiring a database-name/authSource change.

## Changes and safety

- CLI environment loading now uses the same official `@next/env` loader as Next.js.
  Production precedence is the default, matching `npm run start`; explicit
  `NODE_ENV=development` selects development files. Existing process variables win.
  `.env` remains a supported fallback. The configured database name is unchanged.
- Setup now shows operation/collection context, MongoDB error codes/code names, and
  sanitized underlying messages. It redacts MongoDB URIs and encoded/decoded credentials;
  raw driver objects and stacks are not dumped. Authentication/authorization failures
  are distinguished from missing namespaces, duplicates and index conflicts.
- A missing runtime collection now reports code 26 with setup instructions.
- Setup creates missing collections using the existing application validator and builds
  missing indexes. Matching validators/indexes are left unchanged on reruns, so rerunning
  against an initialized database does not require unnecessary `collMod` operations.
- Only an empty collection without a validator may receive the declared validator through
  `collMod`. Populated unvalidated collections and custom/different schemas cause an
  explicit failure for review. Conflicting indexes are reported, never dropped/replaced.
- No collection drops, record deletion, updates to user data, seed, import, database-name
  changes, credential changes, or authentication weakening are performed by setup.
- `npm run db:setup -- --check` is read-only: it verifies required indexes and makes no
  initialization writes. Normal setup can leave partially created metadata if a later
  operation fails; it is safe to rerun after resolving the reported problem.

Setup requires listCollections/listIndexes access, plus createCollection/createIndex
when metadata is missing. `collMod` is needed only for an empty, unvalidated collection.
If Atlas returns code 13, review the specific reported operation and database-scoped
privileges. Code 18 indicates authentication; check the configured credentials/authSource
with the database administrator. The application does not rewrite authentication options.

## Changed-file review

This downloaded workspace has no `.git` metadata, so `git diff` was unavailable. Changes
were reviewed directly against the source inspected at the beginning of this task.

| File | Reason |
| --- | --- |
| `scripts/env.ts` | Shared Next.js-compatible environment loader with no value logging. |
| `scripts/db-setup.ts` | Load environment before validation/connection, sanitize errors, close the client, add read-only `--check`. |
| `scripts/seed.ts` | Use the shared loader; script was not executed. |
| `scripts/import-data.ts` | Use the shared loader only for explicit apply; script was not executed. |
| `src/db/setup.ts` | Preserve declared schema, skip matching metadata, create missing indexes, safely handle races/drift, contextualize failures. |
| `src/db/errors.ts` | Safe diagnostic formatting, credential redaction and actionable error context. |
| `src/db/__tests__/setup.test.ts` | Isolated MongoDB tests for fresh setup, reruns/data preservation, schema/index conflicts, concurrency and permission errors. |
| `src/db/__tests__/errors.test.ts` | Error-code/context preservation, URI/credential redaction, nested/cyclic errors and validation messages. |
| `src/server/__tests__/script-env.test.ts` | Fresh-process tests with fake environment files for `.env.local`, production/development precedence, inherited values and `.env` fallback. |
| `package.json`, `package-lock.json` | Declare the already installed, matching `@next/env` package as a direct dependency. |
| `README.md` | Initialization/run commands and environment-loading behavior. |
| `MONGODB_MIGRATION.md` | Correct setup environment and metadata privilege guidance. |
| `MONGODB_INITIALIZATION.md` | This diagnosis, review, command results and remaining limits. |

`.env.local` was not modified. No new application collection schema was invented.
Tests used a disposable local replica set and fake environment files, never Atlas data.
Ignored build/test caches and temporary compiled diagnostic scripts were generated.

## Actual verification

PowerShell blocks `npm.ps1` in this environment, so commands used `npm.cmd`.

| Command/check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Exit 0 after fixing test/driver type annotations. |
| `npm.cmd test` | Final exit 0: 302 tests passed in 27 files. A concurrent build/test attempt first hit the isolated server's 10-second startup timeout; the sequential rerun passed. |
| `npm.cmd run lint` | Exit 0, no rules disabled. |
| `npm.cmd run build` | Exit 0; Next.js loaded `.env.local`, compiled, type-checked and generated the production build. |
| Old versus corrected loader | Old path failed required-setting validation; corrected path loaded `.env.local` and passed. No credential values printed. |
| `npm.cmd run db:setup -- --check` | Exit 1 before entering the script: this sandbox's `tsx` runner cannot query Windows account information (`uv_os_get_passwd`, ENOMEM). |
| Temporary compiled read-only Atlas check | Did not complete and was interrupted. No successful Atlas connection/readiness result was obtained; no setup writes were attempted. |

Live Atlas initialization and readiness are therefore **not verified**. Normal setup was
not executed against Atlas in this session. The confirmed CLI configuration defect is fixed
and locally tested; any remaining network/authentication/privilege error will now be reported
with safe details when run from the user's normal terminal.

## Initialize and run

From the repository root, keep the existing private `.env.local` and run:

```powershell
npm run db:setup
npm run db:setup -- --check
npm run build
npm run start
```

Use `npm.cmd` in place of `npm` if PowerShell blocks `npm.ps1`. Run the commands in a normal
VS Code terminal where `tsx` can access Windows account information. Setup and runtime
must use the same process variables/mode so they select the same configured database.
No seed/import command is required for initialization.
