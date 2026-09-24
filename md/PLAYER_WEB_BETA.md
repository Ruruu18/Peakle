# Peakle player web beta

The beta is a browser build of the existing Expo player app. Accounts, profiles,
teams, group messages, bookings, competition entries, and saved match results
use the same Supabase project and record IDs as Android and iOS. It is a
separate player site from `organizer-web`; organizer permissions remain enforced
by the existing backend.

## Run and build

Use the repository's supported Node version and run these commands from its root:

```sh
npm ci
npm run web
```

Configure `.env.local` with the **same** `EXPO_PUBLIC_SUPABASE_URL` and public
`EXPO_PUBLIC_SUPABASE_ANON_KEY` used by the native app. Keep
`EXPO_PUBLIC_DEMO_MODE=0`. Never put a service-role key in a browser environment.
The production beta build checks these settings.

```sh
npm run build:web
npm run preview:web
```

The static release is `dist/player-beta`. Preview runs at
`http://localhost:8081`; `PORT` can select another port. The preview server is
local only. Use HTTPS hosting for community access, sign-in, location, and
browser sharing.

## Included player flows

- Sign-up, email/password login, Google sign-in, email verification, password
  reset, and existing onboarding.
- Home, Explore/Book, match setup and scoring, find a partner/opponent, open-play
  discovery and codes, joining and check-in, tournament divisions and
  registration, standings/brackets, leaderboards, and profiles.
- Teams/clans, membership management, and group chat. Player private inboxes,
  direct-message screens, buttons, and message notifications are excluded from
  the browser beta. Native private messaging remains available.
- Browser confirmation dialogs, profile/team photo selection, downloadable
  match cards, responsive scrolling, safe-area spacing, and keyboard focus.

Scores for solo-scored matches are saved locally as they change and synced to
the account after a short debounce. Refresh and choose **Play → Resume** to
recover the score, serve, pause state, and the last ten undo steps. A status
message distinguishes account sync from a browser-only draft. Connected matches
and open-play scoring continue to use their existing server operations.

If uploading a finished result fails, its local backup remains available after
refresh under **Play → Retry**. Retrying uses the same match ID to avoid duplicate
results. Finish syncing that result before starting another match.

The beta requires a connection to register, book, send group messages, and sync
results. It does not cache the application for offline launch. A local draft
is recovery protection, not a replacement for a synced result: keep the browser
open and reconnect until the score is synced or the result says **Match recorded**.
An unsynced draft remains tied to that browser and account.

Microphone-controlled scoring and native push notifications are unavailable
in this beta. Manual scoring remains available. In-app updates are available
while the site is open. Browser speech announcements depend on device support.

## Hosting and authentication

Publish **only** `dist/player-beta` as a static site. A root build command is
`npm ci && npm run build:web`; the output directory is `dist/player-beta`.
The generated `_redirects` file supplies the SPA fallback for compatible hosts.
On other hosts configure unknown player paths to serve `/index.html` with a
200 response, while actual asset paths keep serving their files. Keep HTML
uncached and allow immutable caching for hashed `_expo/static` assets; the
generated `_headers` file provides this for compatible hosts.

For **Vercel**, create the player project with the repository root as its Root
Directory. The checked-in root `vercel.json` selects the static build and output,
provides the SPA fallback for direct links/authentication/payment callbacks,
sets security headers, and gives hashed `_expo/static` assets immutable caching.
The separate admin project must use `admin-web` as its Root Directory and the
Next.js framework defaults.

After starting `npm run preview:web`, run `npm run verify:web-host` to check
direct routes, callbacks, content types, and caching. Run the same read-only
check against the actual Vercel deployment before opening it to players:

```sh
PLAYER_WEB_URL=https://YOUR-PLAYER-HOST npm run verify:web-host
```

This confirms HTTP routing and headers; it does not exchange OAuth codes or
send emails. Actual sign-in/recovery still needs the Supabase allowlist below.

After choosing the beta's HTTPS origin, add the following exact URLs to the
existing Supabase project's Auth redirect allowlist, replacing
`https://YOUR-BETA-HOST` with the real origin:

```text
https://YOUR-BETA-HOST/oauth/callback
https://YOUR-BETA-HOST/verify-email
https://YOUR-BETA-HOST/reset-password
```

For local development use the same three paths under `http://localhost:8081`
(or the origin printed by Expo). Preserve existing native `peakle://` and
organizer redirect entries. Google uses the existing Supabase Google provider;
its authorized provider callback remains the Supabase Auth callback. Browser
Google sign-in uses PKCE in the same tab. Email links should be opened in the
browser that initiated sign-up/reset so it retains the PKCE verifier.

Apply the existing backend migrations required by the native player flows to
the shared project using the normal migration process. In particular, cloud
draft recovery uses `matches.resume_state` from
`202607150005_booking_extensions_and_resumable_matches.sql`. The browser build
does not apply migrations, provision a second database, or change event prices.

For the free community tournament, configure its divisions and open-play fees
as zero using the authorized organizer account. This conversion does not waive
other venues' charges. Existing court-booking requirements still apply to
standalone match setup; organizer-managed open play uses session registration.
If an existing paid booking is used, checkout opens in another tab and Peakle
confirms its status through the backend. Paid checkout is outside the free
tournament acceptance scenario.

## Verification

The player web app switches to a 224px left sidebar at **1024px**. Screen content
is centered within the remaining space and capped at 1040px (about 1000px after
padding). Home, Leaderboard, Profile, Teams, Play, and live scoring use two
columns; court discovery and public activities use two columns, then three at
1440px. Smaller browser windows retain the bottom tabs and compact layout.
Native navigation and breakpoints are unchanged.

Web dialog styling uses explicit `webDialog` hooks for centered, bounded,
scrollable surfaces. Native sheets retain their styles. React Native Web's
modal focus management and Escape handling remain in use, including the team
creation form. Resizing preserves the active screen and unsaved inputs.

With the preview server running, the additional desktop checks are:

```sh
node scripts/player-web-qa.mjs --flows-only --desktop-flows
node scripts/player-web-focus-qa.mjs --desktop
```

The main browser suite checks player routes at 320, 390, 768, 1023, 1024, 1280,
and 1440px. The desktop suite also tests populated grids, 600px-tall windows,
notifications, location selection, profile editing, player status, team creation,
dark mode, and resizing while editing. Requests to external services are
intercepted by fixtures; these checks never change real accounts.

```sh
npm test -- --runInBand
npm run build:web
# In another terminal:
npm run preview:web
# Install the pinned test browser if it is not already installed:
npx puppeteer browsers install chrome
npm run test:web
```

`scripts/player-web-qa.mjs` intercepts external requests and uses fixtures;
it does not create users or write to the live database. Screenshots are written
to the system temporary directory. The fixtures are not imported into the app.
These checks cover browser behavior and client requests; they do not establish
that the deployed project's RLS, email provider, realtime subscriptions, or
organizer setup are configured correctly.

Layout checks cover login, 22 signed-in routes, and live scoring at all seven
viewport widths. They check content bounds, sidebar and bottom-tab placement,
navigation visibility, and horizontal clipping in vertical scroll views, and
capture a screenshot of each signed-in route at every size.

Before inviting the community, run a short rehearsal on the hosted beta with
an organizer and at least two real player accounts. Confirm email/Google
sign-in, join/check-in, court assignments, scorer permissions, result
verification, standings, group messages on a second device, and recovery after
a disconnect. Use an actual Android Chrome phone and iPhone Safari alongside
a desktop. Viewport emulation alone cannot verify every device or browser.

No public beta deployment or live tournament rehearsal has been performed by
the automated local checks.

## Moving to the mobile release

Ship Android/iOS against the same Supabase project, auth identities, storage
buckets, and schema. Users sign in with their existing accounts; no export or
account transfer is required for synced records. Do not delete beta users or
reset the database during the store release.

Before retiring the beta, finish active events and ensure browser-only scores
are synced. Then replace its static hosting with a retirement page linking to
the released apps. Keep the beta origin available while outstanding email
verification/reset links expire, or provide a supported recovery path first.
Remove beta-specific auth redirect entries after that transition. Removing
the website does not delete the shared account data.
