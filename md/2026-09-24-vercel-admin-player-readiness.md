# Vercel public-launch readiness — admin and player web

**Decision after remediation: the three requested code fixes are implemented
and pass local verification. Hosted launch approval still requires the database
migration, Edge Function deployments, and exact-origin acceptance below.**

Reviewed 24 September 2026, Asia/Manila. Scope: `admin-web`, the Expo player web
export, and relevant shared Supabase authentication, moderation, and payment
code. Baseline: `29c521c` plus the existing working-tree changes. The organizer
portal was checked initially, before scope was clarified; its successful checks
do not establish admin readiness. Font licensing is treated as covered by the
owner's confirmation and is not a blocker.

The follow-up implements findings 1–3 locally. Nothing was deployed.
No real users were created, banned, or deleted, and no payments,
messages, or hosted database mutations were made. No deployment URLs or hosted
configuration were supplied. Browser API checks use intercepted fixtures, so
they demonstrate client behavior rather than hosted authorization enforcement.

## Blockers and required evidence

### 1. Admin dependencies — fixed locally

`admin-web/package.json` and its lockfile now pin Next.js **16.3.6** and sharp
**0.35.4**. The fresh production dependency audit reports **zero vulnerabilities**.
The production build, TypeScript validation, image optimization, and isolated
admin browser smoke checks pass. This replaces the initial 1 critical / 1 high
audit result; no exploit was demonstrated during the review.

The image-optimization issue concerns AVIF processing through libheif/sharp.
The separate Windows-hosting issue depends on the host OS and is not evidence
of a Vercel exploit. This review did not demonstrate exploitability on a
deployment. Nevertheless, known affected framework versions should be patched
before exposing this privileged application. The organizer's already-updated
dependencies do not update this separate app.

**Deployment:** rebuild/redeploy the admin project from the updated lockfile.

Sources: [Next.js image advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4),
[Next.js Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36),
[sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).

### 2. Player Vercel routing — fixed locally; hosted verification pending

The new root `vercel.json` selects `npm ci`, `npm run build:web`, and output
`dist/player-beta`. It adds the SPA rewrite, baseline security headers, HTML
revalidation, and immutable caching for hashed assets. Real files take
precedence over the fallback. Admin remains a separate Next.js project rooted
at `admin-web`.

The local preview now uses the configured response headers. The reusable
`npm run verify:web-host` check passed on 11 direct routes, including OAuth,
verification, password recovery, and booking/membership returns; asset content
types, precedence, and caching also passed. The player browser suite passed.
This is local HTTP/browser evidence, not a claim of a deployed Vercel test.

**Deployment:** run `PLAYER_WEB_URL=https://YOUR-PLAYER-HOST npm run verify:web-host`
against the exact Vercel origin, then complete actual Auth sign-in/recovery with
that origin allowlisted in Supabase.

Sources: [Vercel SPA/404 guidance](https://vercel.com/kb/guide/why-is-my-deployed-project-giving-404),
[Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).

### 3. Account bans — fixed locally; Supabase rollout pending

`202609240001_enforce_account_bans.sql` now connects the existing Ban/Unban RPCs
to Auth's ban state, removes sessions/refresh tokens on ban, and retains a
revocation watermark after unban. A PostgREST pre-request check rejects revoked
JWTs before any table/view/RPC request. Restrictive RLS policies cover existing
public RLS tables and private Storage access; suspension fields are protected
against direct client modification. Suspended platform admins lose privilege.

The four caller-authenticated Edge Functions now check access before privileged
work. The player clears its authenticated UI when its profile/session check
confirms revocation. The SQL regression suite passes with a real isolated
PostgreSQL engine, and the browser regression confirms a revoked cached session
returns to sign-in. Unban preserves records and requires a new token.

**Deployment:** apply the migration first, then deploy `create-checkout-session`,
`process-refund`, `route-distances`, and `delete-account`. Follow the staging and
hosted checks in [the backend deployment notes](../supabase/README.md#enforced-account-bans-24-september-2026).
The isolated tests do not replace hosted Auth/PostgREST verification. An existing
custom pre-request hook causes the migration to abort safely until composed.

### 4. Verify the exact deployed authorization and authentication setup — launch gate

Admin source uses `is_platform_admin` checks in its data layer, and reviewed
admin RPCs and roster policies enforce the platform role in SQL. This is the
correct security boundary. The local browser confirmed that anonymous and
non-admin fixtures do not fetch admin data, but mocked responses cannot prove
that the hosted database has those policies and functions applied.

**Close with:** record the deployed commit and both HTTPS origins; confirm
migration/function parity; verify admin Google redirect `/dashboard` and player
`/oauth/callback`, `/verify-email`, and `/reset-password` in Supabase Auth.
On the real backend, exercise an admin and a normal player, checking that the
normal player cannot read private admin results, add an admin, alter another
user's booking, or score an unauthorized match. Verify fresh login, logout,
expired sessions, actual email delivery/recovery, and realtime on two devices.
Use Android Chrome and iPhone Safari as well as desktop.

### 5. Verify browser payments before enabling paid usage — paid-launch gate

The existing local changes now send a platform identifier and support HTTPS
returns from `create-checkout-session`. The previous report's claim that all
returns are hardcoded to `peakle://` is therefore stale for this working tree.
However, the function returns **503** for web checkout if server-side
`WEB_APP_URL` is missing or does not begin with `https://`
(`supabase/functions/create-checkout-session/index.ts:17`). A Vercel environment
variable alone does not configure a Supabase Edge Function.

**Close with:** deploy the reviewed function to Supabase, set `WEB_APP_URL` to
the actual player origin there, and test booking and membership checkout,
cancellation, duplicate webhook delivery, interrupted returns, and refunds in
the payment provider's test environment. Confirm the existing reconciliation
procedure handles ambiguous checkout/refund failures. If releasing a free
pilot first, paid entry points must be unavailable for that pilot.

## Additional remediation and residual risk

| Area | Current evidence | Action |
|---|---|---|
| Admin response headers | Local production responses for all six admin routes omit `X-Frame-Options`, CSP, `X-Content-Type-Options`, and `Referrer-Policy`; `X-Powered-By` is present. `admin-web/next.config.ts` defines no header policy. | Add frame protection and baseline security headers, remove the framework header, and verify deployed responses. No successful clickjacking attack was demonstrated. |
| Admin MFA | No MFA challenge or `aal2` enforcement was found in the reviewed admin/auth SQL. | For this portal's user, admin-roster, refund, and payout powers, add MFA with backend enforcement or verify an equivalent deployed access control. A hidden URL is not a security control. |
| Admin environment guards | `admin-web/scripts/next-with-shared-env.mjs:14` loads parent values first and performs no public-key validation. | Validate required public URL/key values and reject secret/service-role credentials at build time; make environment precedence explicit. The scanned current client output contained no matching secret patterns. |
| Player dependency residual risk | Fresh audit: **31 affected entries, 12 high / 19 moderate / 0 critical**. Many are inherited Expo/Metro build-tool findings. `decode-uri-component@0.2.2` is a browser-reachable URL parser dependency. | Preserve the existing dated risk disposition and its controls, but retain the parser as a runtime risk. Patch/guard it with malformed-input and normal navigation regression coverage when feasible. Do not treat every audit entry as a public server vulnerability or use a blind forced Expo downgrade. |
| CI coverage | The existing untracked workflow runs player Jest and organizer checks. It has no admin build job or player production export/browser job. | Commit the intended release files and add CI for both actual launch targets. The reviewed working tree is not yet a reproducible committed release. |
| Operations | No admin error-reporting integration was found. Player reporting depends on `EXPO_PUBLIC_SENTRY_DSN`. Hosted alerts, backups, and rollback were not inspected. | Verify error delivery, assign incident ownership, and record rollback and database recovery procedures before inviting the public. |
| Player presentation | Build remains marked Player Beta and `noindex,nofollow`; entry JS is about **3.81 MB uncompressed**. | Keep beta/indexing choices intentional. Measure loading on real mobile networks before broad promotion. |

The pre-existing [dependency disposition](./2026-09-24-public-release-dependency-disposition.md)
records acceptance through 24 December 2026 or the next public-release review,
whichever comes first. This audit acknowledges that document; it does not
create new owner approval or erase the runtime finding. See the
[decoder maintainer advisory](https://github.com/samverschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr).

## Verification performed

Environment: Node **24.20.0**, npm **11.19.0**, macOS. Production builds used the
existing installed dependency trees and local public environment values; a
fresh Linux/Vercel installation was not performed.

| Check | Result |
|---|---|
| Admin `npm run build` | Passed, including TypeScript validation and all routes. |
| Player `npm run build:web` | Passed; generated `dist/player-beta`. |
| Player `npm test -- --runInBand` | **465 tests, 20 suites passed** after remediation. |
| Player `npm run test:web` | Passed: 320/390/768/1440px layouts, fixture sign-in, group chat, tournament registration, join/check-in, scoring, undo, refresh recovery, failed-result retry, profile persistence, and shared links. External requests intercepted. |
| Admin production browser smoke | Passed: six signed-out guarded routes, no anonymous admin-data requests, normal-player fixture rejected, admin fixture login/logout, 390/1440px login layouts; **zero page exceptions**. External requests intercepted. |
| Admin production dependency audit | **Zero vulnerabilities** after Next.js/sharp updates. |
| Account-ban SQL/Edge suite | Passed six groups covering Auth state, session removal, old-token request rejection, restrictive RLS/private Storage, protected fields, admin checks, unban, and fail-closed Edge checks. |
| Player host verifier | Passed 11 routes plus asset precedence, caching, and security headers on the local preview. |
| Player production dependency audit | **12 high, 19 moderate**, as discussed above. |
| Client secret-pattern scan | No matches for tested private-key, Supabase secret/service-role JWT, or payment-secret patterns in admin static JS and player JS/HTML/JSON. Limited pattern scan, not a complete secrets audit. |
| Organizer checks run before scope clarification | Build, lint, and 11 environment/program utility tests passed; not counted as admin validation. |

Local evidence: `/private/tmp/peakle-vercel-{admin,player}-build.log`,
`/private/tmp/peakle-vercel-jest.log`,
`/private/tmp/peakle-vercel-{admin,player}-audit.json`,
`/private/tmp/peakle-vercel-{admin,player}-browser.log`, and
`/private/tmp/peakle-vercel-admin/results.json`. The temporary admin fixture
harness is `/private/tmp/peakle-vercel-admin-qa.mjs`; screenshots are in
`/private/tmp/peakle-vercel-admin` and the system temp directory's
`peakle-player-web-qa`. These temporary files can expire.

Follow-up remediation evidence: `/private/tmp/peakle-admin-patched-{build,browser}.log`,
`/private/tmp/peakle-admin-patched-audit.json`, and
`/private/tmp/peakle-public-fixes-{jest,bans,player-build,player-browser}.log`.

## Deployment settings to use after remediation

| Setting | Admin | Player |
|---|---|---|
| Vercel project | Separate admin project | Separate player project |
| Root directory | `admin-web` | Repository root |
| Framework | Next.js | Other/static export with explicit build/output |
| Install | `npm ci` | `npm ci` |
| Build | `npm run build` | `npm run build:web` |
| Output | Next.js default | `dist/player-beta` |
| Public Supabase settings | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Other settings | Exact admin Auth redirect | `EXPO_PUBLIC_DEMO_MODE=0`, intended organizer URL, reporting DSN if used, exact player Auth redirects |
| Routing | Next.js routes | Vercel SPA fallback and headers from finding 2 |

Use the same intended Supabase project, public anon/publishable client keys,
committed lockfiles, and a Node version validated by the deployment build.
Set payment secrets and `WEB_APP_URL` in Supabase Functions. Validate the
specific preview, then the exact production domains, before opening access.
Vercel supports separate projects from a monorepo:
[Vercel monorepo documentation](https://vercel.com/docs/monorepos).
