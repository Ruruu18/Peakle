# Mobile player beta: feature, flow, and growth review

Reviewed 28 September 2026 against the current working tree. This is a product and code review, supported by local tests and a limited browser walkthrough. It is not a certification of the installed Android/iOS builds or deployed Supabase configuration. Uncommitted application changes in the working tree were not modified.

**Recommendation: use the existing feature set for a small, hosted community pilot, after rehearsing the invitation and notification flows on real phones. Prioritize getting players into their first game and bringing them back.** The app already has enough features to test demand. Broad promotion would currently send new players through a long entry flow without assurance that they will find a suitable local game.

The launch recommendation assumes one local city/court community. Actual active-player counts, available games, store distribution, and conversion rates were not supplied or measured.

## What is already present

| Area | Current implementation | Beta implication |
| --- | --- | --- |
| Account | Email signup/verification, Google sign-in, password recovery, profile setup | Core account flows exist; email delivery and native OAuth still need release-build rehearsal. |
| Player scheduling | Games, open play, tournament/program calendar entries; private/public visibility; invitations, RSVP, capacity, cancellation, sharing, Google Calendar link | A host can coordinate a group without a venue booking integration. Tournament/program calendar entries should not be advertised as the full organizer competition/program product. |
| Player-hosted open play | Host selects present players and courts; rotations, live scoring, check-in, saved results | Strong reason for an existing community host to adopt Peakle. Keep this central to the pilot. |
| Scoring | Singles/doubles, casual/ranked, guest names, any-court setup, undo, pause/resume, saved-match recovery, optional voice control | Useful even before a large local network exists. Guest players reduce the need to get everyone registered before playing. |
| Social | Teams, player suggestions/search, follows, team/community/private chat and media | Enough social functionality for the pilot. Avoid adding more chat features before measuring actual game participation. |
| Results | Match history, ratings/verification, leaderboards, rematch, shareable match cards | Existing foundations for progress, invitations, and repeat play. |
| Support and trust | Feedback prompt, support chat, report/block controls in chat, privacy controls, account deletion | These are present, not missing features. Verify that reports and support requests receive a human response during the pilot. |

Court booking and organizer-event discovery are **off by default**, controlled by [features.js](../src/config/features.js#L14). The ratings hub tab row is also hidden by default, although ratings and Find play remain reachable through other entry points. Build environment overrides could change these defaults.

## Current player journey

1. Open app → Login. Email registration includes verification; Google is an alternative.
2. New account → feature overview (skippable) → name → optional photo → game preference and required home area.
3. Home → Schedule, Start live, Find players, public activities, or player suggestions.
4. Schedule → My schedule by default; Discover lists public activities with open spots. Create an activity by selecting its type, date/time, court, visibility, and invitees.
5. Share/invite → another registered player opens the activity and responds.
6. At the court → start the match, or start hosted open-play rotation.
7. Record results → view progress, rematch, or share the result card.

The proposed acquisition journey is shorter: **see a real game → understand where/when/who → sign up to join → confirm a spot → receive a useful reminder → play → arrange the next session.**

## Prioritized gaps

### 1. Complete invitation links across signup and installation — before broad invitations

Sharing exists, but the last part of the journey needs work. [schedule.js](../src/services/schedule.js#L252) creates HTTPS links only when a web origin or `EXPO_PUBLIC_APP_URL` is available; otherwise native sharing falls back to `peakle://games/...`. [App.js](../App.js#L34) only lists `peakle://` as a native linking prefix. The checked native configuration does not declare verified Android HTTPS App Links or iOS associated domains.

A custom-scheme link alone gives a recipient without Peakle no useful browser destination. An HTTPS link can reach the browser, but the configured native app will not automatically claim it through verified app linking. Android documents these distinctions in its [deep-link guidance](https://developer.android.com/training/app-links); Apple describes the corresponding [universal-link setup](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content).

There is also a source-level risk that the invitation destination is lost during Google/email authentication. Web Google auth returns to a fixed `/oauth/callback`, and [auth URL cleanup](../src/lib/authLinks.js#L8) rewrites that callback URL to `/`. No persisted pending game destination was found. This risk was not reproduced against live OAuth.

**Deliver:** a shareable HTTPS game page with a useful preview, native app linking, and a stored destination restored after signup, verification, and onboarding. Use deliberate public fields for public previews and possession-of-link access for private invitations; never expose private rosters through a general anonymous listing. A game QR code can reuse the same link.

**Accept when:** existing and brand-new users reach the exact shared game through email and Google, with the app installed or absent, and after a cold launch. Joining still requires an explicit RSVP.

### 2. Make game notifications useful — before relying on them for attendance

The notification system exists, but three gaps affect the current beta flow:

- [OperationsContext](../src/context/OperationsContext.js#L174) registers tokens automatically only when permission is already granted. The only permission-request entry points found are Settings and the notification test screen; a successful game RSVP does not prompt for permission.
- The native notification-tap handler in [App.js](../App.js#L202) handles chats, follows, team invitations, and mentions, but excludes scheduled-game `gameId` and open-play `sessionId` destinations. An invitation notification can therefore open the app without opening the relevant activity.
- Scheduled games generate invitation, response, and cancellation/update notices, but no time-based scheduled-game reminder implementation was found. Existing booking/open-play reminder functions do not establish reminder coverage for every scheduled player activity.

**Deliver:** an optional “Remind me about this game” prompt after the first RSVP; scheduled-game reminders; reliable notification routing; cancellation/rescheduling updates. Respect notification preferences and avoid duplicate reminders.

**Accept when:** a second real phone receives the correct notification with the app backgrounded and closed, and tapping it opens the correct game. Denying permission must leave the RSVP usable.

### 3. Let players see value before completing the whole profile — conversion priority

[App.js](../App.js#L254) gates the application behind authentication and completed onboarding. [Personalize](../src/screens/AuthFlowScreen.js#L822) uses three stages and requires a home area. The overview can be skipped and photos are optional, which helps, but there is no public game preview before the gate.

**Deliver:** public game previews and a compact initial profile using name and area, with optional details collected later. Preserve an invited player's destination throughout setup. For a player arriving without an invitation, make “Find a game” and “Play with my friends” clear first actions. Consider a standalone guest scorekeeper after measuring the preview-to-signup flow.

**Accept when:** five observed first-time players complete their first join without coaching. Measure elapsed time and abandonment rather than assuming the revised flow is faster.

### 4. Improve suitable-game discovery and seed real local supply — before acquiring strangers

Home already sorts activity previews by distance. However, Schedule discovery mainly filters by activity type and time; it does not provide an area/radius or beginner/skill filter. Its public query is capped at 200 activities before client presentation, without a geographic constraint. The current scheduled-activity form also lacks structured experience-level and court-cost information.

Empty states do offer creation/discovery actions. What is missing for an empty market is a way for an individual player to express availability or ask to be notified when a suitable game appears, without taking on hosting themselves.

**Deliver:** prioritize the selected area, nearby dates, beginner suitability, available places, host information, and any court cost. Add a clear “Notify me when a game opens here” path. A location field alone is not evidence that a player can find a compatible game.

**Launch operation:** recruit a few reliable local hosts and publish real sessions before promoting the beta to independent players. The review did not measure the live supply of games.

### 5. Make the second session easier to arrange — early retention priority

Rematch and sharing a result card already exist in [PlayScreen](../src/screens/PlayScreen.js#L2144). Scheduling supports creation, RSVP, cancellation, invitations, and visibility changes, but no general time/court edit, weekly recurrence, or duplicate-next-week action was found. Full scheduled activities are excluded from Discover instead of offering a scheduled-activity waitlist. Organizer open play has separate waitlist capabilities; that is not the same as the scheduled-game entry flow.

**Deliver in order:** edit time/court with attendee updates; “Play again next week” prefilled from the current group; a waitlist and replacement invitation. Add automatic recurrence only once hosts show that they need it. Existing hosted check-in can inform attendance; public no-show penalties are unnecessary for the first pilot.

### 6. Measure acquisition and repeat play — before promoting beyond the pilot

Sentry error reporting is implemented and depends on a DSN. Feedback is implemented. No dedicated acquisition funnel, referral attribution, or cohort-retention instrumentation was found in the player client. Existing match, RSVP, and account records can already supply some aggregate measures; venue business analytics are a different use case.

**Deliver:** record invitation opened, signup started/completed, first activity joined/created, first match completed, invitation shared, and a second attended session. Use aggregate reporting and minimal event data; do not collect message bodies or precise player locations for this purpose.

Track weekly players who actually participate, time to first join, empty discovery visits, invitation-to-RSVP conversion, and second-session participation. Downloads and account creation alone do not show that people are finding games.

### 7. Align release messaging and platform readiness — before store distribution

The [Play submission copy](2026-08-25-google-play-submission.md#L16) still leads with booking and references older navigation. Refresh it to describe the enabled player beta. A suitable message is: **“Find a local game, organize your group, and keep every match.”** Demonstrate real scheduled sessions and hosted rotations in launch materials.

If iOS is in scope, the current login UI has Google and email but no Sign in with Apple implementation. Review [Apple guideline 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services): third-party primary-account login generally requires an equivalent option meeting Apple's privacy criteria unless an exception applies. Adding Sign in with Apple is the straightforward route for this consumer app; this is a release-readiness finding, not a prediction of Apple's decision.

Also scope the Google-services build guard in [app.config.js](../app.config.js#L1) to Android: it currently requires the Android configuration secret for any `production` profile, including an iOS build without that secret.

## Suggested first cohort

Start with **3–5 hosts, 2–3 nearby courts, and 30–50 players**, then run a four-week pilot. These are suggested experiment sizes, not externally validated growth benchmarks.

1. Rehearse invitation, signup, RSVP, push, scoring, and recovery on physical Android/iOS devices used by the cohort. Fix the highest-impact failures.
2. Have hosts schedule repeatable weekly sessions. Personally observe the first few players joining and playing.
3. Give each host a game link/QR to share in their existing communities. Let players use the existing match cards after sessions. Keep invitations voluntary.
4. Each week, review where invited players dropped out, how many attended, how many returned, and whether hosts could fill their games.

Suggested initial targets: at least 60% of completed signups join/create an activity within seven days, at least 30% of first-week participants play again the following week, and at least three hosts run a second session. Treat these as internal hypotheses to adjust after observing the first cohort, not guarantees or industry standards.

Keep the paused booking and organizer products outside the immediate launch expansion. The most useful next development order is **invitation continuity → notification permission/routing/reminders → first-game discovery → repeat scheduling**, with measurement added alongside these changes.

## Verification performed and remaining limits

| Check | Result |
| --- | --- |
| `npm test -- --runInBand --watch=false` | 633 tests passed across 36 suites at the time of execution. |
| `npm run test:hosted-open-play` | Passed in isolated PGlite with migration replay. Hosted in the command name refers to player-hosted open play; no production database was tested. Push cron migrations are excluded by that harness. |
| `npm run test:play-anywhere` | Passed: court labels, ranked-result protections, private visibility, capacity/invitations, cancellation, and typed activities. |
| `npm run test:activity-safety` | Passed: retry deduplication, quotas, personal calendars under a large discovery set, and authorization protections. |
| `node scripts/schedule-activities-qa.mjs` | Partial browser evidence only. At 320px it signed in, completed the game form, submitted a simulated game, and displayed its details. It then timed out at line 93 because the script expects no dialog after save, whereas the app now opens the new activity's details. The full script did not pass; this failure does not establish a failed save. |
| Physical devices, live email/OAuth, push receipt, installed-app links, deployed migrations/functions | Not verified during this review. |

Browser checks used intercepted API fixtures; no real invitations or messages were sent. The existing preview was inspected rather than rebuilt, so its results are not evidence for every latest working-tree change. The temporary failure screenshot is `/private/tmp/peakle-schedule-activities-review/failure.png` and may be removed by the operating system.

Before expanding, complete one real multi-player rehearsal: invite a new account, finish authentication, RSVP, receive and open the reminder, start/check in, score, recover after interruption, save once, see the result from a second account, and schedule the next session. Confirm the deployed support/reporting path and crash monitoring while doing that rehearsal.
