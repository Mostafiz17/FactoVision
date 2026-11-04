# FactoVision by Factoryze

Product identity: **FactoVision**, **by Factoryze**. Tagline: **See Progress. Build Better.**

This rebrand preserves the existing Next.js/React/TypeScript/MongoDB architecture, blue palette, page structure, pulse icon, routes, API contracts, authorization and task workflows. It does not deploy the application or initialize, seed, import, or migrate database records.

## Changed files

| File | Reason |
| --- | --- |
| `src/lib/brand.ts` | Central public product identity, description and analytics download prefix. |
| `src/app/layout.tsx` | Browser title, application metadata, company attribution, Open Graph and Twitter descriptions. |
| `src/app/icon.svg` | Adapt existing blue pulse icon into a Next.js favicon route with the new accessible title. |
| `src/app/loading.tsx` | Loading screen product name. |
| `src/app/global-error.tsx` | Error heading and reload action product name. |
| `src/components/auth/LoginClient.tsx` | Desktop/mobile login and registration branding, company attribution and tagline. |
| `src/components/shell/AppShell.tsx` | Sidebar identity and spacing for the longer name. |
| `src/components/analytics/AnalyticsClient.tsx` | Download filenames use `factovision-analytics`; report content is unchanged. |
| `src/server/modules/ai/service.ts` | Rebrand the fallback recommendation provider label; recommendation logic is unchanged. |
| `scripts/seed.ts` | Product name in console description only; script was not executed. |
| `scripts/smoke.mjs` | Existing login HTML assertion expects the new product name; script was not executed. |
| `e2e/app.spec.ts` | Human-readable suite title. |
| `e2e/branding.spec.ts` | Desktop/mobile browser regression tests for identity, metadata, favicon, registration presentation and overflow. No authentication submission or data writes. |
| `README.md` | Current product heading and tagline. |
| `ARCHITECTURE.md` | Current product heading. |
| `PROJECT_SPEC.md` | Current product heading. |
| `package.json` | Private package name only; scripts and dependencies are unchanged. |
| `package-lock.json` | Matching root package names only. |
| `BRANDING.md` | This change inventory, verification and deployment handoff. |

Ignored local review files under `tmp/` contain before-change snapshots, safety checks and the browser runner/configuration. Browser screenshots are under ignored `test-results/`. They are review artifacts, not application files or deployment inputs.

## Intentionally retained identifiers

- `cadence_session` and `cadence_ws` cookies preserve existing sessions and workspace selection.
- `cadenceMongo*` connection-pool globals preserve internal identifiers.
- Demo email addresses such as `ava@cadence.dev` remain account identifiers in login examples, fixtures, scripts and documentation. Demo workspace names remain existing data.
- Disposable test database prefixes and validation fixtures retain their internal names. The new browser test also uses the old name as a negative assertion.
- Historical migration documentation retains historical references.
- MongoDB database/collection/index names, environment variables, API routes and persisted identifiers are unchanged.

No PWA manifest, branded email template or dedicated about/help page required updating. Existing third-party names and external font URLs remain unchanged. No localhost links were found in production application source; test/configuration localhost addresses remain local tooling.

## Verification

| Check executed | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed, exit 0. |
| `npm.cmd test` | Passed: 302 tests across 27 files, using an isolated disposable MongoDB replica set. |
| `npm.cmd run lint` | Passed, exit 0; no rule suppression or configuration changes. |
| `npm.cmd run build` | Passed, exit 0; existing routes retained and `/icon.svg` generated. |
| `node tmp/factovision-browser.mjs` | Passed: 2 Playwright tests against the built local production server, desktop 1440×1000 and mobile 375×812. Screenshots inspected. |
| Protected-file comparison | All 44 baseline files unchanged, including `.env.local`, environment validation, database/authentication code, API routes and global styles. |
| Client credential scan | No configured MongoDB URI or optional OpenAI key found in 30 generated client assets; only configured nonempty values were checked, without printing them. |
| Manifest comparison | Scripts, dependency versions and all other manifest data unchanged apart from the private package name. |

An initial typecheck/build attempt failed because local review snapshots retained TypeScript extensions and were picked up by the existing broad TypeScript include. Renaming those ignored snapshots to `.snapshot` fixed this; the checks above were subsequently executed successfully. Application configuration was not weakened.

The full authenticated Playwright suite and live smoke scripts were not executed: those need existing accounts/data and can modify records. The branding browser checks did not sign in, seed, import or access Atlas. Live Atlas connectivity, production permissions, authenticated workflow appearance and public deployment are not verified by this rebrand.

## Public deployment handoff

1. Select the existing intended Next.js-compatible Node hosting target and public domain; neither was provided or changed here. Configure HTTPS and the host's private environment settings. Preserve the existing `MONGODB_URI` and `MONGODB_DB`; use existing optional AI configuration only if needed. Do not rename the database, expose secrets as `NEXT_PUBLIC_*`, or publish `.env.local`.
2. Verify Atlas permits the hosting service's network access and that its database user has the application's existing required privileges. Use the intended existing database. In a trusted environment with those variables loaded, run `npm run db:setup -- --check` for the existing read-only initialization/index verification. Resolve any reported issue before releasing; do not run seed/import scripts. This Atlas check was not run during the rebrand.
3. Install and verify the release with `npm ci`, `npm run typecheck`, `npm test`, `npm run lint`, then `npm run build`. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.
4. Configure the host build command as `npm run build` and runtime command as `npm run start` (with its assigned `PORT`). Set private runtime environment variables before starting the server. Deploy only when separately authorized; no deployment was performed here.
5. On the public HTTPS domain, verify `/api/health`, the login title and favicon, then use an authorized account to verify workspace selection, task/project workflows, analytics downloads and recommendations. Do not seed production to perform verification. Confirm any existing platform/domain settings before adding canonical URLs; no domain was invented in metadata.

There is no known rebrand check failure. Hosting/domain selection and live Atlas/runtime verification remain deployment prerequisites.
