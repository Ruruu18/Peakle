# Supabase, Google sign-in, and password reset setup

## 1. Connect Supabase

1. In Supabase, open **Project Settings > API** (or the project's **Connect** dialog).
2. Copy the project URL and publishable key into a local `.env` based on `.env.example`.
3. Never put a `service_role` key in this app. Expo public variables are bundled into the client.
4. Apply every file in `migrations/` in filename order, or run `supabase db push`. If an earlier migration was already applied, do not paste and run it again manually.

The first migration creates the normalized model, automatic user profiles, storage policies, and row-level security. Venues and courts are added by platform administrators rather than seeded with demo records.

### Enforced account bans (24 September 2026)

Apply `migrations/202609240001_enforce_account_bans.sql` before deploying the
updated caller-authenticated Edge Functions. The existing admin Ban/Unban RPCs
keep their signatures. The migration makes their changes atomic with Supabase
Auth's `banned_until`, removes the banned account's sessions and refresh tokens,
and records a token-revocation watermark. Unban preserves records and requires
a fresh sign-in; previously issued tokens remain rejected.

The migration registers `public.enforce_account_access` as the PostgREST
pre-request hook so banned/revoked JWTs cannot use table, view, or privileged RPC
endpoints. Restrictive RLS policies additionally cover every existing public
RLS table and `storage.objects`, including private Storage and Realtime reads.
The policies narrow existing permissions. Anonymous public content remains
public, and service-role webhook/reconciliation jobs keep working.

Client updates to suspension fields are rejected even on projects with legacy
table-wide UPDATE grants. Existing banned profiles are synchronized during the
migration. Future public RLS tables should also receive the `active accounts
only` restrictive policy, as the migration explains.

This migration narrowly updates Supabase-managed Auth fields/tables; validate
it on a staging project running the same Supabase version before production.
It aborts without committing changes if an unrelated PostgREST pre-request hook
already exists. In that case, compose the existing hook with
`public.enforce_account_access` instead of replacing its protections.

Deploy in this order using the project's normal authenticated release process:

```sh
supabase db push
supabase functions deploy create-checkout-session
supabase functions deploy process-refund
supabase functions deploy route-distances
supabase functions deploy delete-account
```

Those functions check account access with the caller's JWT before using
service-role access or calling a paid external API. If the migration is absent
or the check fails unexpectedly, they fail closed with a temporary-unavailable
response. Suspended users can contact `support@peakle.app` for support or an
account-deletion request.

Run the isolated SQL/Edge regression checks without any hosted credentials:

```sh
npm run test:account-bans
```

The tests use real PostgreSQL semantics through PGlite with a minimal existing
schema. They check previous bans, protected fields, admin authorization, Auth
session removal, old-token REST/RPC denial, RLS/Storage denial, unban/new-token
recovery, and Edge failure behavior. They do not run a hosted GoTrue/PostgREST
service. On staging, additionally ban a dedicated signed-in player and verify
fresh email/Google login is rejected, an already-issued JWT cannot read/write
or score through RPCs, private uploads fail, and unban allows fresh sign-in.
Existing downloaded data and already-issued signed media URLs cannot be
recalled by an account ban.

Implementation references: [Supabase pre-request checks and their RLS scope](https://supabase.com/docs/guides/api/securing-your-api)
and [Supabase session behavior](https://supabase.com/docs/guides/auth/sessions).

### Free driving distances

Court discovery uses the free openrouteservice Matrix API through the `route-distances` Edge Function. The API key stays server-side and must never be added to the Expo `.env` file.

1. Create a free Standard API key at [HeiGIT Accounts](https://account.heigit.org/).
2. Store and deploy it:

```bash
supabase secrets set OPENROUTESERVICE_API_KEY=your_free_key
supabase functions deploy route-distances
```

The app batches up to 25 destinations per request, asks openrouteservice for road-network driving distances and estimated durations, and keeps a short in-memory cache to reduce quota usage. If the function or API is unavailable, the UI explicitly labels the fallback as `direct` rather than presenting it as a driving distance. The free service does not include live traffic, so ETAs are estimates; the road distance follows the routable OpenStreetMap road network.

`migrations/202607160009_server_organizer_entitlements.sql` makes Organizer Pass access server-authoritative. Apply it before testing Organizer mode: the demo checkout writes an account-scoped entitlement through protected RPCs, and the database rejects new open-play sessions when that entitlement is missing or expired. Existing owned sessions remain accessible so organizers can recover or finish live operations. The demo lifecycle RPCs must be removed when verified App Store or Play Billing webhooks replace the sandbox.

`migrations/202607160010_player_open_play_registration.sql` completes the player-to-organizer open-play registration loop. It adds public, private, and invite-only sessions; six-character codes; schedules, skill ranges, capacity, fees, approval mode, rules, invitations, registration status, waitlisting, and check-in. Capacity decisions lock the session row and are enforced by a trigger as well as protected RPCs. Apply migrations 009 and 010 together before testing this flow.

`migrations/202607170001_fair_play_engine.sql` adds Priority 2 rotation controls, player fairness state, immutable assignment audit records, transaction-safe assignment/completion RPCs, and the registration-gated live player view. Apply it after migration 010 before publishing a new session from this app version.

`migrations/202607170002_priority_3_realtime_operations.sql` completes Priority 3. It publishes all operational tables to Realtime, adds role-based venue staff access, a secure notification outbox, session announcements, connection-safe operation revisions, and an idempotent offline mutation log. Apply it after migration 001. Existing projects that applied the original Priority 2 migration should also re-apply the two updated Fair Play RPC definitions from migration 001 so staff authorization uses `owns_open_play` instead of comparing only the original organizer ID.

`migrations/202607170003_priority_4_booking.sql` completes Priority 4. It adds venue-local calendars, pricing rules, court and venue blackouts, expiring server price quotes, atomic multi-court booking, request idempotency, revision-checked changes and cancellations, immutable booking audit records, FIFO court waitlists, richer receipt state, Realtime availability, and booking reminders. Apply it only after migrations 001 and 002; it extends the Priority 3 notification types.

`migrations/202607170004_priority_6_pickleball.sql` completes Priority 6. It adds independent verified singles/doubles ratings, participant result confirmation and disputes, availability and partner/opponent/substitute matching, team challenges, competitions and standings, recurring venue programs, capacity-safe registration, memberships/packages/credits, privacy controls, and server-authorized venue analytics. Apply it after migration 003. Membership requests remain pending and collect no money until the Priority 5 payment and settlement workflow is deployed.

`migrations/202607170005_priority_6_privacy_controls.sql` makes Competitive Hub privacy changes atomic. Turning matching off closes open requests immediately, and both publishing and claiming requests require matching to be enabled. Apply it after migration 004.

`migrations/202607170009_team_conversation_reads.sql` adds per-member team conversation read state, secure conversation summaries, and unread counts for the Teams inbox and bottom-tab badge. Apply it after the earlier Priority 6 migrations before testing communication-first Teams navigation.

`migrations/202607210001_team_chat_features.sql` completes production team chat. It adds paginated media-aware messages, seen state visibility, reactions, sender-only edits and unsend, per-user deletion, message rate and length limits, and a private team-scoped `team-chat-media` bucket. Apply it after migration 009 before testing the updated Teams chat screen. Chat photos are resized to 1,600 px and limited to 2 MB, and videos to 15 MB.

`migrations/202607230001_safe_court_availability_realtime.sql` adds privacy-safe Realtime cache invalidation for court availability and public open-play discovery. Apply it before testing cross-device updates. Booking and registration rows stay protected by row-level security; clients receive only a timestamped “data changed” event and then refresh through the existing authorized RPCs.

`migrations/202607240001_complete_match_push_notifications.sql` completes account-scoped match alerts. Nearby invitations notify the recipient and notify the sender after acceptance; Competitive Hub claims notify both players; and open-play session owners receive match-start and match-finished alerts when they are hosting but not in the lineup. Player and Organizer workspaces share the same notification inbox, while device-token registration safely follows the currently signed-in account on a shared phone.

`migrations/202608030006_host_remove_joined_player.sql` lets the nearby-match host remove an accepted invitee through a host-only RPC. The removal is sent through Realtime, clears the host’s lineup spot, and tells the removed player that a new invitation is required to rejoin.

`migrations/202608030007_realtime_nearby_match_scoring.sql` adds server-authorized connected scoring for nearby matches. The host scores by default, may assign or hand scoring to an accepted signed-in player, and remains the only account allowed to hand off control. Match members watch the same Realtime score, ranked scoring cannot be assigned to a guest, and an active scorer must hand control back before leaving.

`migrations/202607260003_profile_photos.sql` adds the public `profile-photos` bucket with account-scoped upload and deletion policies. Apply it before testing profile photo changes. The app crops photos to a square, resizes them to 720 px, converts them to JPEG, and enforces a 2 MB upload limit.

`migrations/202607260005_remove_legacy_cartoon_avatars.sql` retires the old DiceBear character URLs for existing profiles. Those accounts show their initials until they upload a real profile photo.

`migrations/202607260009_team_chat_safety.sql` adds the adult-only chat acknowledgement, server-side spam and language controls, private blocks, message reporting, automated safety flags, moderator removals, platform suspensions, and protected report queues. Apply it before opening team chat with this app version. Existing users will be asked to confirm they are at least 18 when they first open chat; users who do not confirm remain able to use non-chat features.

`migrations/202607260010_organizer_media.sql` adds organizer-controlled venue brand images, individual court photos, and competition cover photos. Apply it before testing the image controls in **Organizer → Venue** or **Organizer → More → Competition**. Images are resized to 1,600 px, converted to JPEG, limited to 4 MB, and stored in the public `organizer-media` bucket with venue/competition manager-only write policies.

### Team chat safety test

1. Open a joined team from an existing account and confirm chat stays locked until the adult acknowledgement is accepted.
2. Send six messages quickly, repeat the same message three times, and try a configured prohibited term. Confirm the server rejects each threshold violation.
3. From a second team member, report a message and confirm it disappears only for the reporter while an open `chat_reports` row contains the reason, priority, and limited snapshot.
4. Block that sender and confirm their messages disappear across shared team chats. Open **Chat info → Blocked players**, unblock them, and confirm messages become visible again.
5. As a team manager, remove another member’s message and confirm every member sees “Message unsent,” a `chat_moderation_actions` row is created, and any removed media path can no longer be read.
6. As a platform admin, review a report or automated flag and add a temporary or permanent `chat_suspensions` row. Confirm the affected account cannot read, send, react, pin, or upload chat media.

### Priority 6 verification

1. Record a ranked singles or doubles match with registered Peakle accounts, then have every participant confirm it in **Profile → Performance rating**. Confirm the result becomes verified exactly once and only the matching format rating changes.
2. Dispute another result and confirm no rating history row is created for it.
3. Publish availability and a partner or substitute request from one player; claim it from another and confirm the post closes atomically.
4. From the dedicated **Organizer → More → Programs**, **Competition**, and **Memberships & packages** screens, create a recurring clinic, competition, and package. Register from a player account and confirm a full program returns a waitlist registration.
5. Compare the 30-day venue metrics with booking/open-play/program source rows, then export the CSV and confirm the same totals are present.
6. Publish a matching request, then turn off **Allow player matching** under **Profile → Settings → Privacy & matching**. Confirm the request closes immediately, availability is hidden, and neither publishing nor claiming another request succeeds until matching is turned back on.

### Priority 4 booking operations

1. Apply migration 003 and migration `202607230001`, then reload the PostgREST schema cache if your project does not do so automatically.
2. In **Organizer → Venue**, add at least one peak/off-peak price rule and one future maintenance blackout. Long-press an existing rule to remove it.
3. In Supabase **Integrations → Cron**, run `select public.queue_booking_reminders();` every five minutes. The existing push-dispatch Cron job sends the generated reminder and court-waitlist notifications.
4. Keep venue `time_zone` values as valid IANA names. Philippine venues default to `Asia/Manila`; do not store a device offset as a time zone.

### Priority 4 booking test

1. On two player devices, open the same venue, date, and time. Confirm a reservation on one and verify the other updates without a manual refresh.
2. Select two available courts and confirm once. Verify both rows share one reference and either both exist or neither exists.
3. Retry the same request key after simulating a lost response and verify the RPC returns the original booking instead of creating another.
4. Apply a peak, promotional, or member rule and confirm the price-locked summary matches the receipt after confirmation.
5. Block a court and verify the time reads **FULL · WAITLIST**. Join the waitlist, release the court, and confirm the first player receives a 15-minute offer.
6. Change a future booking, then cancel it before the venue cutoff. Confirm the revision, status, refund state, audit log, and receipt all update.
7. Try a past time, overlapping booking, stale revision, expired quote, and one unavailable court in a multi-court request; each attempt must fail without a partial or duplicate reservation.

### Priority 3 push and scheduled jobs

Push notifications require a development or production build on a physical iOS or Android device; Expo Go and simulators cannot provide a production device token. After applying migration 002:

1. Apply migration `202608250003`. It generates the dispatcher credential in Supabase Vault and installs both Cron jobs; the secret never belongs in the mobile app or repository.
2. Deploy the dispatcher: `supabase functions deploy send-push-notifications --no-verify-jwt`.
3. Confirm the `queue-open-play-check-in-reminders` job runs every five minutes and `send-push-notifications` runs every minute in **Integrations → Cron**.
4. In a physical build, open **Profile → Settings** and enable court alerts or match reminders. Confirm a row appears in `device_push_tokens`.

The dispatcher claims at most 100 pending notifications per run, batches them through Expo Push Service, records delivery tickets, skips users without an enabled device, and retries transient failures up to five times. Database triggers populate the outbox for approval, waitlist promotion, court assignment, match point, result, cancellation, and venue announcements; the first Cron job creates check-in reminders.

After applying migration `202607240001`, also verify match coverage with two physical-device accounts:

1. Send and accept a nearby match invitation. The recipient receives the invitation push and the sender receives the accepted push.
2. Claim a Competitive Hub partner, opponent, or substitute request. Both accounts receive a match-found notification.
3. Start and finish an open-play match while the session owner is not in the lineup. The players receive their existing court/result pushes and the owner receives match-start/match-finished pushes without duplicates.

### Priority 3 operations test

1. Open the same organizer session on two staff devices and one registered player device.
2. Disable networking on one staff device. Mark a waiting player done or change their priority and confirm the amber offline banner shows a saved operation.
3. Make another change online, reconnect the offline device, and confirm both changes survive and the pending count clears.
4. Score a live game and verify the player view updates without manual refresh.
5. Publish an announcement and verify it appears in the player's in-app inbox and, when enabled, as a push notification.
6. Open TV mode from the court monitor and confirm court scores, waiting count, and next-player recommendation update live.
7. Under **More → Staff access**, assign each venue role and confirm read-only viewers cannot mutate operational data.

### Open-play registration test

1. Activate the payment-free Organizer Pass and switch to Organizer mode.
2. Open **Sessions**, publish open play at a verified venue, and copy its six-character code.
3. Sign in on another device as a player and open **Play → Join an organizer session**.
4. Discover the public session or enter its code, then join or request approval.
5. On the organizer device, open **Players** to approve and check in the player.
6. Confirm the player changes to **Checked in** and appears in the organizer rotation queue.
7. Fill the session to capacity and verify that the next player is waitlisted.

### Venue-owner court management

Apply `migrations/202607160001_venue_court_management.sql` to enable the organizer profile's **Venue** tab. Venue access is deliberately assigned by an admin; users cannot claim a venue themselves. After verifying an owner, assign their account in the Supabase SQL editor:

```sql
insert into public.venue_members (venue_id, user_id, role)
select 'your-venue-id', id, 'owner'
from auth.users
where email = 'owner@example.com'
on conflict (venue_id, user_id) do update set role = excluded.role;
```

Replace the venue ID, email, and role (`owner` or `manager`) as needed. The assigned user can then add and edit courts or hide them from player-facing booking and match selection. Venue creation and staff assignment remain admin-only.

`migrations/202607160002_platform_admins.sql` creates the separate Peakle platform-admin role and promotes `jadeannexx@gmail.com` as the initial administrator. The account must already exist and have signed in at least once. Platform admins can manage every venue, court, and venue-owner assignment; normal users cannot grant this role to themselves.

### Nearby-player Expo test

Apply `migrations/202607150004_nearby_player_presence.sql` before testing nearby players. It creates opt-in foreground presence, a distance-only discovery RPC, expiring match invitations, and the required row-level security policies.

Also apply `migrations/202607200001_improve_nearby_distance_accuracy.sql` and `migrations/202608030001_fix_nearby_players_visibility.sql` when testing this app version. The latter removes a discovery query dependency on the viewing player's database row, gives foreground presence a five-minute grace period during brief mobile interruptions, and refreshes the PostgREST schema cache.

1. Start Peakle with `npx expo start --clear` and open it on two devices or simulators.
2. Sign in with a different completed player account on each client.
3. Open **Play**, select **Public**, and tap **Go visible** on both clients. Grant foreground location access when prompted. Simulators can use their configured location; a profile or manually selected area is used when GPS coordinates are already available in the app.
4. Keep both apps in the foreground for the quickest result. Each player should appear on the other client within 20 seconds if they are within 25 km.
5. Tap **Invite**. The other client receives a match invitation and can decline or join. The sender's lineup is filled only after acceptance.
6. After the player joins, tap **Remove** on the host device and confirm. Verify the host’s lineup spot clears immediately and the invited player is told that the host removed them.
7. Invite the player again, assign **Player scores**, and start the match. Verify scoring controls appear only on that player’s device while the host sees live updates and can use **Change** to take scoring back.
8. Start a ranked match and verify only the host or an accepted signed-in lineup player can be assigned. While an invited player is the scorer, confirm leaving is blocked until the host hands scoring to someone else.

Presence heartbeats run every 20 seconds and expire after five minutes. Briefly backgrounding the app stops heartbeats but uses that grace period; turning visibility off or signing out marks the player offline immediately on a best-effort basis. Other users receive only a rounded distance from the database function, never the stored coordinates.

## 2. Configure email and reset links

In **Authentication > URL Configuration**:

- Set a production Site URL appropriate for the project.
- Add `peakle://**` to **Redirect URLs**. The production callbacks are `peakle://verify-email` for registration and `peakle://reset-password` for password recovery.
- When testing through Expo Go, also add the exact `exp://.../--/verify-email` and `exp://.../--/reset-password` URLs generated by the app. A development build is more reliable because it owns the `peakle` scheme.

In **Authentication > Providers > Email**:

- Enable the Email provider.
- Turn on **Confirm email** so email/password users do not receive an authenticated session until they verify their address.

The app sends `peakle://verify-email` as the signup redirect, remembers registrations waiting for verification, provides a rate-limited resend button, and restores the authenticated session from the confirmation deep link. Google accounts do not need this additional confirmation step.

Before a production launch, configure **Project Settings > Authentication > SMTP Settings** with a verified Peakle sending domain. Supabase's default mail service is suitable for development, not production delivery.

In **Authentication > Email Templates**, customize **Confirm signup** and **Reset password** as needed, but keep `{{ .ConfirmationURL }}` as the link target so the verification or recovery token and redirect are preserved.

### Verification test

1. Register with a new email/password account.
2. Confirm that Peakle displays the verification screen and cannot open the main app.
3. Open the confirmation email on the device and tap the link.
4. Confirm that Peakle opens, creates a session, and continues to profile personalization.
5. Sign out, then confirm the verified account can log in normally.

## 3. Configure Google OAuth

1. In Google Cloud Console, configure the OAuth consent screen.
2. Create OAuth 2.0 client IDs for:
   - iOS, bundle ID `com.peakle.app`
   - Android, package `com.peakle.app` plus the signing certificate SHA-1
   - Web application
3. Put the three client IDs in `.env` using the names in `.env.example`.
4. In **Supabase > Authentication > Providers > Google**, enable Google. Use the Web client ID and Web client secret as the primary credentials, then add the iOS and Android client IDs to the allowed/additional client ID list.
5. In the Web client in Google Cloud, add this Supabase callback as an authorized redirect URI:

   `https://melbfzfuxrviybblipua.supabase.co/auth/v1/callback`

6. To test Google sign-in in Expo Go, add `exp://**` under **Supabase > Authentication > URL Configuration > Redirect URLs**. Expo Go uses the Supabase-hosted Google OAuth flow because it cannot identify itself as Peakle's native Google client.

Restart Expo with a cleared cache after changing environment variables:

```bash
npx expo start --clear
```

Google sign-in uses an OAuth ID token from the platform-specific Google client and exchanges it for a Supabase session. Do not add a Google client secret to `.env`.

## Private player messages

Apply `migrations/202607300001_private_player_messages.sql` before testing the Messages inbox. It adds consent-based player conversations, one-message requests, read receipts, realtime delivery, push notifications, and private-message reports. Existing chat age eligibility, suspensions, and user blocks also apply to private conversations.

Apply `migrations/202608030002_fix_teammate_message_permissions.sql` with this app version so teammate permission checks use the same chat-safety and block rules as message sending.

### Interactive chat notifications

Apply `migrations/202607300007_notification_chat_replies.sql`, redeploy
`send-push-notifications`, and make a new native build after installing this app
version. The migration adds the `messages` notification preference and an
exactly-once receipt for replies submitted from Android or iOS notification
actions.

1. Open **Profile → Settings → Message notifications** on a physical device.
2. Turn on **Message alerts**, allow the OS permission, and run the 10-second closed-app test.
3. Lock the phone or swipe Peakle away. Expand the test alert, tap **Reply**, and confirm the acknowledgement arrives once.
4. For the server test, sign in as two connected players on separate devices and open an accepted private conversation.
5. Close the recipient app, send a message from the other device, and expand the recipient's push alert.
6. Submit a reply from the alert. Confirm it appears once in both chat histories and the original notification is marked read.

Remote delivery still requires the push-dispatch Cron job and valid FCM/APNs
credentials in the EAS project. Android users should swipe the app from recents
for the terminated-app test; **Force stop** in Android system settings prevents
the OS from delivering app notifications until the app is opened again.
