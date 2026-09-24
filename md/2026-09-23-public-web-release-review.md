# Public web release review — 23–24 September 2026

**Decision: HOLD the unrestricted public release.** Both applications build and
the tested player flows pass, but there is insufficient evidence to approve a
public production launch. A supervised free pilot is a separate, narrower
decision and still needs the deployment, recovery, and licensing gates below.

Scope: the Expo player browser app and `organizer-web`, with targeted review of
their shared Supabase authorization/payment code. Baseline commit: `29c521c`.
This report includes the local hardening changes made during this review.
It is not a full penetration test, legal review, or certification of the hosted
database. No release was deployed, payment initiated, email sent, or hosted data
changed. No public application URLs were supplied during the review.

## Findings that still need closure

### 1. Public deployment and shared-backend acceptance are unverified — launch gate

`PLAYER_WEB_BETA.md` explicitly records that automated local checks do not prove
the deployed RLS, email delivery, realtime behavior, or live tournament setup.
The configured Supabase Auth service passed a read-only health check, but that
does not establish migration parity, correct redirect allowlists, or cross-venue
permissions. Browser tests use intercepted fixtures or the interactive demo.

**Close when:** both exact HTTPS origins are confirmed; the deployed commit and
environment are recorded; the latest required migrations/functions are verified;
and an organizer plus two player accounts complete registration, email/Google
sign-in, joining/check-in, court assignment, authorized scoring, saved results,
standings, and second-device chat/realtime updates. Test unauthorized reads and
writes using an unrelated venue/account, not just hidden UI controls. Verify
logout/session expiry, account deletion, offline recovery, and expired auth links.
Use actual iPhone Safari and Android Chrome as well as desktop browsers.

The local organizer environment currently uses `http://localhost:3000` as its
site URL and has no public player URL. These are local settings, not evidence of
a misconfigured hosted deployment. Set the actual production origins explicitly,
including `EXPO_PUBLIC_ORGANIZER_PORTAL_URL` in the player build. Rebuild after
changing public environment variables.

### 2. The player dependency audit still needs a public-release disposition — security

Fresh `npm audit --omit=dev` reports **31 affected package entries: 12 high,
19 moderate, zero critical**. Counts include inherited dependency chains and
are not 31 independent exploitable vulnerabilities. Many entries are Expo/Metro
build tooling, which should never be exposed as the public application server.

One finding needs separate browser-runtime treatment:
`@react-navigation/core` → `query-string@7.1.3` →
`decode-uri-component@0.2.2`. `getStateFromPath.tsx` parses URL queries through
this dependency, and `App.js` uses React Navigation linking for the web app.
The decoder has a malformed-input denial-of-service advisory. This review
confirmed the dependency and call path; it did not reproduce an exploit.
A compatible `npm update decode-uri-component` did not change the installed
version. The current query-string 7 releases still require the 0.2.x decoder.
See the [decoder advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr).

The existing `md/2026-08-25-beta-dependency-risk-acceptance.md` applies only to
closed beta and requires review before the next public release. It does not
approve this release or cover new runtime findings.

**Close when:** upgrade/mitigate the navigation parser with malicious-input and
normal navigation regression checks; then review each remaining root advisory
for actual runtime/build exposure. Record an explicit, time-bounded disposition
for unavoidable build-only findings. Do not use `npm audit fix --force` to
blindly downgrade Expo or change native framework generations.

### 3. Organizer account recovery is missing from the login flow — account access

`organizer-web/components/login-screen.tsx` offers password and Google sign-in,
but no forgotten-password action. `components/providers.tsx` does not request
password-recovery emails or handle a dedicated recovery flow. The password
editor in `settings-section.tsx` is available only after signing in.
The player app has recovery support, but that is not currently an accessible,
tested recovery path from the public organizer login screen.

**Close when:** an organizer who is signed out can request a reset, follow the
email link, set a new password, and sign in again through a documented public
flow. A clearly linked, verified shared player recovery flow can also satisfy
this requirement. Test expired links and the browser/device behavior of PKCE.

### 4. Paid browser flows are not approved — gate for paid launch

`supabase/functions/create-checkout-session/index.ts` still builds success and
cancel URLs with `peakle://` for bookings and memberships. A web-only customer
cannot rely on those links returning to the browser app. The browser checkout
component asks users to return manually, and correctly relies on backend payment
state rather than trusting the return URL; this reduces the impact but does not
constitute a verified end-to-end paid browser experience.

The player beta documentation explicitly excludes paid checkout from its free
tournament acceptance scenario. No provider transaction or refund was performed
in this review.

**Close when:** support validated HTTPS return URLs for web customers while
retaining native behavior, and rehearse success, cancellation, duplicate webhook
delivery, interruption, reconciliation, and refund in the provider's test
environment. Alternatively, limit the pilot to genuinely free flows and make
paid paths unavailable for that release.

### 5. Confirm the organizer font license before public distribution — asset gate

The organizer imports six PP Mori font files through `next/font/local` in
`app/layout.tsx`. The accompanying `app/fonts/pp-mori/Befonts-License.txt` says
**“Personal Use Only.”** No commercial/web license evidence was located in the
reviewed repository; that does not prove a separately purchased license does
not exist. The foundry distinguishes personal trials from commercial licenses.
See the [foundry FAQ](https://pangrampangram.com/pages/faq) and
[Mori product page](https://pangrampangram.com/products/mori).

**Close when:** confirm that the purchased license and supplied font files cover
the deployed web use, or replace the fonts with a properly licensed alternative.
The repository's own MIT license does not establish rights to third-party fonts.

### 6. Public disclosures and operations need owner verification — launch gate

The organizer `/privacy` page describes itself as the governing policy for the
mobile application and repeatedly refers to Android settings. Confirm the
policy accurately covers browser/organizer use, authentication storage, media,
public scoreboard names, service providers, and the actual retention/deletion
practices before publishing. This is a content/product mismatch observed in
source, not a legal-compliance determination.

No tracked CI workflow was found. Organizer render failures currently log to
the browser console; production error alerting was not verified. Player Sentry
initialization depends on a deployment DSN. Confirm the support mailbox works,
identify an incident owner, retain a known-good build for rollback, and verify
database backup/restore and monitoring arrangements on the hosting services.

## Fixes completed locally

| Change | Result |
|---|---|
| Organizer Next.js `16.2.12` → `16.3.5`; sharp override `0.35.3` → `0.35.4` | Fresh production dependency audit: **zero known advisories**; manifest and lockfile updated. |
| Player-app link | Localhost is now a development-only fallback. A production build hides this link until `NEXT_PUBLIC_PLAYER_APP_URL` is supplied. |
| Public environment validation | Organizer builds reject missing/placeholder Supabase values, secret/service-role or unknown key types, and unsafe/nonpublic player-link settings. Public anon and publishable keys are supported. |
| Environment precedence | Portal environment values take precedence over the parent Expo fallback; hosting/shell values retain precedence. Production commands select the production environment. |
| Sign-in after a restored demo | Reproduced successful password authentication leaving the user on the login screen after exiting a restored demo. Auth setup now restarts on demo exit; real auth callbacks also avoid overwriting an active demo. Added an intercepted browser regression check. |
| Organizer response headers | Added MIME-sniffing protection, frame protection, referrer policy, and CSP restrictions for frames/objects/base URLs; removed `X-Powered-By`. This is baseline hardening, not a full script CSP. |
| Regression checks and handoff | Added six public-environment tests and documented the required public player URL and deployment configuration. The scoreboard test helper now reacquires a detached button before pointer dispatch, keeping all functional assertions. |

The dependency changes address the
[Next.js image-optimization advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4),
[Windows-hosting advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36), and
[sharp/libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
These are advisory matches, not evidence that Peakle was exploited. The Windows
issue depends on hosting platform; the image issue depends on image processing.
Next.js `16.3.5` is above the advisory's patched `16.3.3` threshold. A download of
`16.3.6` stalled, so the already-cached patched version was used and verified.

Adjacent risk: `admin-web/package.json` still specifies the original affected
Next.js/sharp versions. Admin was outside this two-app implementation scope.
If it is publicly deployed, update and test it separately before launch.

## Verification evidence

Environment: Node `24.20.0`, npm `11.19.0`, macOS. Checks run on 23–24 September
2026 (Asia/Manila).

| Check | Result / limit |
|---|---|
| Player Jest suite | **463 tests / 19 suites passed**. |
| Player production export | **Passed**; `dist/player-beta` generated. |
| Player browser QA | **Passed**, including 320/390/768/1440px layouts, login, chat, tournament registration, join/check-in, scoring, refresh recovery, failed-save retry, profile updates, and shared links. All external requests intercepted. |
| Organizer production build after fixes | **Passed** on Next.js `16.3.5`. |
| Organizer lint after fixes | **Passed**. |
| Organizer typecheck | **Passed**; the final production build also runs TypeScript validation. |
| Organizer program utilities | **5 tests passed**. |
| Public environment guards | **6 tests passed**. |
| Organizer production dependency audit after fixes | **0 advisories** (`npm audit --omit=dev`); no guarantee against unknown issues. |
| Public organizer routes/layout/headers | **Passed** for nine public/guarded routes, response security headers, anonymous workspace gating, and 390/1440px layouts. No browser exceptions. |
| Organizer navigation/program QA | **Passed**: 14 desktop sections, four primary mobile tabs, More menu/focus/Back/Forward, settings, and program roster/capacity/edit/attendance/export/create flows. Demo data only. |
| Organizer auth regression | **Passed** for fresh password sign-in and sign-in after exiting a restored demo. The latter failed reproducibly before the fix. All external requests intercepted. |
| Organizer display browser QA | **Passed all six scenarios**, including independent displays, reassignment, revocation/deletion, competition views, isolated contexts, offline retention, and reconnect/next-match behavior; zero page errors. Two initial attempts stopped at a detached test-driver button; the helper was repaired before the final successful run. |
| Scoreboard database tests | **Passed** against isolated PGlite/minimal schema: anonymous read-only access, venue/court isolation, concurrency, link rotation/revocation, match transitions, competition views, deletion without match loss. Not a full migration replay or hosted RLS audit. |
| Configured Supabase Auth health | **Reachable**; read-only check only. |
| Client build secret-pattern scan | No matches for the scanned private-key/Supabase-secret/payment-secret patterns. This is a limited pattern scan, not proof that all secrets are absent. Environment-file values were not copied into this report. |

The player JS bundle is approximately **3.81 MB uncompressed / 0.98 MB gzip**.
This is a performance follow-up, especially on mobile data; real-device timings,
load capacity, and Core Web Vitals were not measured. The player release remains
labeled beta and deliberately uses `noindex`; the organizer defaults to pilot
messaging. Those choices suit a pilot but should be intentional for general
availability. Do not enable the organizer trial switch solely to remove pilot
copy: it also changes signup trial requests.

Local evidence: `/private/tmp/peakle-release-*.log`, the initial audit JSON files
at `/private/tmp/peakle-release-{player,organizer}-audit.json`, player screenshots
under the system temporary `peakle-player-web-qa` directory, and organizer public
screenshots under `/private/tmp/peakle-release-organizer`. Temporary artifacts
may be removed by the operating system; this report preserves their conclusions.

## Release decision procedure

1. Close the applicable findings above and record the evidence with the exact
   build/commit and both public URLs.
2. Repeat the relevant tests after remediation; perform the hosted rehearsal
   with authorized test accounts and real target devices.
3. Verify HTTPS, deep-link fallback, asset caching, Supabase redirects, deployed
   security headers, monitoring, and rollback on those exact origins.
4. Approve a bounded free pilot or unrestricted/paid launch explicitly according
   to the flows actually verified. Local green checks alone are not launch approval.
