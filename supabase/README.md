# Supabase, Google sign-in, and password reset setup

## 1. Connect Supabase

1. In Supabase, open **Project Settings > API** (or the project's **Connect** dialog).
2. Copy the project URL and publishable key into a local `.env` based on `.env.example`.
3. Never put a `service_role` key in this app. Expo public variables are bundled into the client.
4. Apply every file in `migrations/` in filename order, or run `supabase db push`. If an earlier migration was already applied, do not paste and run it again manually.

The first migration creates the normalized model, automatic user profiles, storage policies, and row-level security. Venues and courts are added by platform administrators rather than seeded with demo records.

`migrations/202607160009_server_organizer_entitlements.sql` makes Organizer Pass access server-authoritative. Apply it before testing Organizer mode: the demo checkout writes an account-scoped entitlement through protected RPCs, and the database rejects new open-play sessions when that entitlement is missing or expired. Existing owned sessions remain accessible so organizers can recover or finish live operations. The demo lifecycle RPCs must be removed when verified App Store or Play Billing webhooks replace the sandbox.

`migrations/202607160010_player_open_play_registration.sql` completes the player-to-organizer open-play registration loop. It adds public, private, and invite-only sessions; six-character codes; schedules, skill ranges, capacity, fees, approval mode, rules, invitations, registration status, waitlisting, and check-in. Capacity decisions lock the session row and are enforced by a trigger as well as protected RPCs. Apply migrations 009 and 010 together before testing this flow.

`migrations/202607170001_fair_play_engine.sql` adds Priority 2 rotation controls, player fairness state, immutable assignment audit records, transaction-safe assignment/completion RPCs, and the registration-gated live player view. Apply it after migration 010 before publishing a new session from this app version.

`migrations/202607170002_priority_3_realtime_operations.sql` completes Priority 3. It publishes all operational tables to Realtime, adds role-based venue staff access, a secure notification outbox, session announcements, connection-safe operation revisions, and an idempotent offline mutation log. Apply it after migration 001. Existing projects that applied the original Priority 2 migration should also re-apply the two updated Fair Play RPC definitions from migration 001 so staff authorization uses `owns_open_play` instead of comparing only the original organizer ID.

`migrations/202607170003_priority_4_booking.sql` completes Priority 4. It adds venue-local calendars, pricing rules, court and venue blackouts, expiring server price quotes, atomic multi-court booking, request idempotency, revision-checked changes and cancellations, immutable booking audit records, FIFO court waitlists, richer receipt state, Realtime availability, and booking reminders. Apply it only after migrations 001 and 002; it extends the Priority 3 notification types.

`migrations/202607170004_priority_6_pickleball.sql` completes Priority 6. It adds independent verified singles/doubles ratings, participant result confirmation and disputes, availability and partner/opponent/substitute matching, team challenges, competitions and standings, recurring venue programs, capacity-safe registration, memberships/packages/credits, privacy controls, and server-authorized venue analytics. Apply it after migration 003. Membership requests remain pending and collect no money until the Priority 5 payment and settlement workflow is deployed.

`migrations/202607170005_priority_6_privacy_controls.sql` makes Competitive Hub privacy changes atomic. Turning matching off closes open requests immediately, and both publishing and claiming requests require matching to be enabled. Apply it after migration 004.

`migrations/202607170009_team_conversation_reads.sql` adds per-member team conversation read state, secure conversation summaries, and unread counts for the Teams inbox and bottom-tab badge. Apply it after the earlier Priority 6 migrations before testing communication-first Teams navigation.

### Priority 6 verification

1. Record a ranked singles or doubles match with registered Peakle accounts, then have every participant confirm it in **Profile → Performance rating**. Confirm the result becomes verified exactly once and only the matching format rating changes.
2. Dispute another result and confirm no rating history row is created for it.
3. Publish availability and a partner or substitute request from one player; claim it from another and confirm the post closes atomically.
4. From **Organizer → More → Programs & insights**, create a recurring clinic, competition, and package. Register from a player account and confirm a full program returns a waitlist registration.
5. Compare the 30-day venue metrics with booking/open-play/program source rows, then export the CSV and confirm the same totals are present.
6. Publish a matching request, then turn off **Allow player matching** under **Profile → Settings → Privacy & matching**. Confirm the request closes immediately, availability is hidden, and neither publishing nor claiming another request succeeds until matching is turned back on.

### Priority 4 booking operations

1. Apply migration 003 and reload the PostgREST schema cache if your project does not do so automatically.
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

1. Set a strong function secret: `supabase secrets set PUSH_DISPATCH_SECRET=...`.
2. Deploy the dispatcher: `supabase functions deploy send-push-notifications --no-verify-jwt`.
3. In Supabase **Integrations → Cron**, run `select public.queue_open_play_check_in_reminders();` every five minutes.
4. Add another Cron job every minute that invokes `send-push-notifications` with the `x-push-dispatch-secret` header. Keep the secret in Vault or the Cron job's protected HTTP headers, never in the mobile app.
5. In a physical build, open **Profile → Settings** and enable court alerts or match reminders. Confirm a row appears in `device_push_tokens`.

The dispatcher claims at most 100 pending notifications per run, batches them through Expo Push Service, records delivery tickets, skips users without an enabled device, and retries transient failures up to five times. Database triggers populate the outbox for approval, waitlist promotion, court assignment, match point, result, cancellation, and venue announcements; the first Cron job creates check-in reminders.

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

1. Start Peakle with `npx expo start --clear` and open it on two devices or simulators.
2. Sign in with a different completed player account on each client.
3. Open **Play**, select **Public**, and tap **Go visible** on both clients. Grant foreground location access when prompted. Simulators can use their configured location; a profile or manually selected area is used when GPS coordinates are already available in the app.
4. Keep both apps in the foreground. Each player should appear on the other client within 20 seconds if they are within 25 km.
5. Tap **Invite**. The other client receives a match invitation and can decline or join. The sender's lineup is filled only after acceptance.

Presence heartbeats run every 20 seconds and expire after two minutes. Backgrounding the app or signing out marks the player offline immediately on a best-effort basis. Other users receive only a rounded distance from the database function, never the stored coordinates.

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
