# Peakle Organizer Web

Responsive organizer operations portal for desktop, tablet, and mobile browsers. It uses the same Supabase project, user identities, organizer entitlements, venue memberships, RLS policies, RPC functions, and storage as the Expo player app.

## Included workspace

- Organizer overview and live operational metrics
- Open-play session publishing and session history
- Court monitor, scores, open courts, and fair-play queue
- Managed court scoreboard links for independent venue displays
- Registration approval and player check-in
- Venue and court availability management
- Programs, competitions, and membership products
- Venue analytics with CSV export
- Staff roles and permission management
- Shared organizer identity, light/dark themes, and session security
- Responsive mobile navigation and installable web-app manifest

## Local development

### Temporary pilot offer

The public landing page, sign-in/sign-up copy, and search/social metadata use
pilot messaging by default. **Join the pilot** goes directly to `/register`;
existing users sign in. There is no separate application or approval step for
account creation. Organizers invite players through their session links/codes;
players use their own player-app accounts. Existing venue permissions still
control who can manage courts and sessions.

Feedback follows testing. `NEXT_PUBLIC_PILOT_FEEDBACK_URL` can point to a hosted
survey for organizers and players. Without it, **Share pilot feedback** opens
an email draft with a short questionnaire for `support@peakle.app`. Testers
must send the email themselves; opening the draft does not save a response.

At release, set `NEXT_PUBLIC_ORGANIZER_TRIAL_ENABLED=true` and **rebuild/redeploy**
to restore the existing 14-day offer, pricing, FAQs, metadata, and email-signup
trial request. Pilot email signups omit the trial request so they do not start
a new 14-day countdown. Existing trial records, their expiry, booking fees, and
venue permissions are unchanged. This switch is presentation/signup configuration,
not an access-control or fee-waiver mechanism. It does not give existing pilot
accounts a new trial when enabled; any launch offer for those accounts must be
arranged separately. The existing Google sign-in flow is unchanged.

### Environment

The Next.js config can reuse the public Supabase values from the parent Expo `.env` file. A standalone deployment should use the names in `.env.example`.

```bash
cd organizer-web
npm install
npm run dev
```

Open `http://localhost:3000/overview`.

The portal uses authenticated data from the shared Peakle Supabase project. Local development also includes a read-only **Peakle Summer Smash · Demo** competition plus two live open-play demos so both monitor types and the multi-activity switcher can be tested without adding fake rows to Supabase. Set `NEXT_PUBLIC_ENABLE_COMPETITION_DEMO=true` and `NEXT_PUBLIC_ENABLE_OPEN_PLAY_DEMO=true` to enable the fixtures in another non-production environment.

## Required Supabase authentication settings

Add these redirect URLs in Supabase Auth before deployment:

```text
http://localhost:3000/overview
https://organizer.your-domain.com/overview
```

Use the same email/password and Google providers as the player app. Authorization remains server-enforced through the existing row-level security policies and database functions; UI route visibility is not treated as a security boundary.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
node scripts/visual-qa.mjs
node scripts/navigation-qa.mjs
node scripts/auth-qa.mjs
```

The visual QA script expects the development server on `localhost:3000` by default and writes desktop/mobile screenshots to `/private/tmp`. Set `PORTAL_BASE_URL` to test another local port.

The navigation QA script uses an isolated demo session to check desktop tabs, mobile tabs and More, direct profile access, settings tabs, keyboard controls, viewport changes, and browser Back/Forward.

The auth QA script intercepts external requests and checks fixture password
sign-in both from a fresh browser and after exiting a restored demo session.
It never creates users or submits credentials to the hosted backend.

Program management includes editing, opening/closing registration, cancellation with preserved history, waitlist admissions, attendance corrections, and roster export. Apply `supabase/migrations/202609070001_program_management.sql` before using these controls with live data. Its database functions enforce owner/manager/admin access, reject stale edits, and serialize capacity changes with player registrations. Program cancellation does not send notifications; organizers should contact participants separately.

Program checks: `node --test scripts/program-utils.test.mjs` (Node 22.18+), and `node scripts/programs-qa.mjs` with the development server running. The browser checks use only demo data and cover desktop/mobile layouts, editing, registration changes, attendance, export, and creation.

## Court scoreboard displays

Apply `supabase/migrations/202609120001_court_scoreboard_displays.sql` through the
normal migration process before using displays with live data. The migration
adds display settings, read-only scoreboard snapshots, and competition court
assignment. The web build does not apply it automatically.

Venue owners, managers, and platform admins can open **Live Monitor → Full-screen
monitor → Settings tab → Manage displays**, add a named display, and select its
event and court. Competition monitors also provide a Manage displays action.
Each display
has a separate **Copy link / Open display** action. Open the link on a court
computer and press **Full screen**; no organizer login is needed on that device.
For monitors attached to one computer, use extended-display mode and move a
separate browser window onto each monitor. Browsers require a user action to
enter fullscreen; monitor placement is controlled by the operating system.

Displays can show one court, all courts, a tournament bracket, or a division's
standings. The all-court board rotates four courts at a time; bracket and
standings pages rotate every ten seconds. Open-play displays follow the session
court. Competition displays follow the venue court, optionally filtered to a
division. In the display editor, expand **Match court assignments** to assign
existing scheduled/live competition matches. Schedule those matches through
the competition workflow first. This works for tournaments, leagues, ladders,
and seasons; brackets are specific to tournaments.

Scoreboards read the existing scoring records. Open play includes live scores
and serve state. Competitions use saved live match state where present, and the
latest numbered game otherwise. A scheduled match shows its players with
“Waiting for match to start”; a court without a match shows “Waiting for next
match.” This feature does not start matches or grant scoring permission.

Each screen independently fetches a small snapshot every two seconds from the
shared Supabase backend. The main organizer computer need not remain open.
Settings changes appear on the next successful refresh. During a connection
failure, the screen retains its last score with a reconnecting message and the
last successful update time; reconnection fetches current data. An invalidated
link clears its scoreboard on its next successful refresh.

Display tokens are unguessable, revocable links, stored in the URL fragment so
they are not sent in page requests or referrers. Anyone with the link can read
its assigned presentation. Tokens are visible only to authorized venue managers
through RLS; direct writes to display settings are denied. The anonymous
snapshot function returns names, scores, and presentation information only.
It accepts no caller-selected court/event and cannot change scores. **New link**
invalidates the previous link; **Disconnect** invalidates it and disables the
display while retaining its setup. **Delete** confirms permanent removal of the
display and invalidates its link, preserving all match, score, and court data.
Display management rejects stale edits. The public `/display` page
does not restore an organizer authentication session.

The interactive demo supports these controls locally. Its explicitly marked
`/display?demo=1#…` links share demo settings between tabs of the same browser
only; real displays on different computers require the deployed backend.

Verification with a local organizer preview on port 3000:

```sh
npm run test:displays
```

This browser check uses demo data and intercepted API fixtures, including two
independent browser contexts, score changes, reconnects, next-match transitions,
court reassignment, disconnect, competition views, and TV/mobile layouts.
Screenshots are written to `/private/tmp/peakle-displays-qa`.

The database check executes the migration against an in-memory PostgreSQL
engine with a minimal existing schema; it does not access the hosted project:

```sh
npm install --prefix /private/tmp/peakle-display-db-check --no-audit --no-fund @electric-sql/pglite
# From the repository root:
PGLITE_MODULE=/private/tmp/peakle-display-db-check/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/scoreboard-displays.mjs
```

It checks permissions, court/venue isolation, token rotation, stale edits,
match transitions, competition assignments, and current-game score selection.
After migration and deployment, rehearse with the actual venue computers and
scorer devices to confirm network connectivity and display legibility.

## Deployment

Deploy `organizer-web` as its own Vercel project with the root directory set to this folder. Configure:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_PLAYER_APP_URL
```

Recommended domain: `organizer.peakle.app`.

Set `NEXT_PUBLIC_SITE_URL` to the organizer's actual HTTPS origin. Set
`NEXT_PUBLIC_PLAYER_APP_URL` to the hosted player app's HTTPS origin; leave it
empty to hide the player link until that deployment exists. The localhost
player link is available only during `npm run dev`. Public values are embedded
at build time, so rebuild after changing them.

Production builds reject missing/placeholder Supabase configuration and keys
that are not public anon/publishable credentials. Portal environment files take
precedence over the parent Expo fallback; shell/hosting variables take precedence
over both. Run `node --test scripts/public-env.test.mjs` to verify these guards.

The public-release assessment and remaining acceptance gates are recorded in
[`../md/2026-09-23-public-web-release-review.md`](../md/2026-09-23-public-web-release-review.md).

The native app is player-only. Its Profile screen links organizers to this responsive portal for the dashboard, live monitor, and player management.
