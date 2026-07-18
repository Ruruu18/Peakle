# PEAKLE Competitive Improvement Roadmap

**Date:** July 16, 2026  
**Objective:** Make PEAKLE the most reliable and pickleball-focused platform in the Philippines for finding players, joining open play, managing fair court rotations, booking verified venues, and recording matches.

## Product position

PEAKLE should not attempt to win by copying every feature from broad multi-sport platforms. Its strongest position is:

> The best system in the Philippines for finding pickleball players, joining open play, running fair rotations, and recording trusted match results.

Sports360 already offers court and open-play booking, online payments, coaching, tournaments, memberships, player ratings, notifications, and real-time queue information. PEAKLE needs to first complete its core player-to-organizer workflow, then differentiate through deeper pickleball operations, reliability, transparent rules, teams, and competitive play.

Reference listings:

- [Sports360 on the Philippine App Store](https://apps.apple.com/ph/app/sports360/id6754903747)
- [Sports360 on Google Play](https://play.google.com/store/apps/details?id=com.sport360.go8v2)

## Current PEAKLE strengths

- Pickleball-specific player experience.
- Player and organizer workspaces in one account.
- Court discovery and booking.
- Verified venue application and platform-admin review.
- Teams, invitations, nearby-player discovery, and match challenges.
- Match setup, live scoring, results, and local performance history.
- Organizer open-play court monitoring and rotations.
- External navigation through Apple Maps, Google Maps, and Waze.

## Critical current gaps

- Players cannot discover and join organizer open-play sessions.
- There is no QR scanner, session code, invitation link, or player check-in.
- Open-play registration is entered manually by the organizer.
- Organizer Pass is currently a local payment-free demo entitlement.
- Organizer access is not yet backed by a production subscription and server-side entitlement model.
- No production payment, settlement, refund, or dispute workflow.
- No real-time push notification workflow for queues and court assignments.
- No memberships, coaching, clinics, leagues, or tournament registration.
- Venue operations still need complete schedules, blackout periods, pricing rules, staff permissions, and analytics.

## Priority 0 — Trust, security, and reliability

These foundations must be completed before accepting real payments or onboarding many venues.

### Deliverables

- Enforce organizer entitlements on the server, not only on the device.
- Review every Supabase RLS policy and RPC authorization path.
- Make all booking and payment requests idempotent.
- Prevent double bookings at both application and database levels.
- Add structured application error reporting and performance monitoring.
- Add loading, offline, retry, and stale-data states to booking and organizer screens.
- Remove all demo and fake data from production paths.
- Add automated tests for booking conflicts, receipts, queue changes, permissions, and venue verification.
- Add audit logs for venue, admin, organizer, staff, booking, and refund actions.

### Success targets

- At least 99.9% crash-free sessions.
- At least 99.5% successful valid booking attempts.
- No duplicate confirmed bookings for the same court and time range.
- App launch under two seconds on supported devices.
- Cached schedules visible in under one second.

## Priority 1 — Player joins organizer open play

This is the most important missing product loop.

**Implemented July 16, 2026:** organizers can publish verified-venue sessions with a schedule, courts, capacity, skill range, fee, visibility, approval mode, rules, and cancellation policy. Players can discover available sessions, open a `peakle://open-play/{code}` invitation, enter a six-character code, request or automatically receive a place, fall back to a transactional waitlist, and check in. Organizers can approve, decline, check in, remove, and invite players. Only checked-in registrations receive a live queue position, and registration/session updates use Supabase Realtime. QR generation and scanning remain in Phase 2 as planned below.

### Organizer flow

1. Organizer creates an open-play session.
2. Organizer selects venue, courts, date, schedule, capacity, skill range, fee, and visibility.
3. PEAKLE generates a six-character code, QR code, deep link, and shareable invitation.
4. Organizer chooses automatic approval or manual approval.
5. Organizer monitors requested, approved, checked-in, waiting, playing, finished, and departed players.

### Player flow

1. Player opens **Play → Join open play**.
2. Player discovers a public nearby session, follows an invitation link, scans a QR code, or enters a session code.
3. Player reviews the organizer, verified venue, schedule, rules, skill level, capacity, fee, and cancellation policy.
4. Player taps **Request to join** or **Join session**.
5. Player receives approval or waitlist status.
6. On arrival, the player checks in through the app or is checked in by staff.
7. Only checked-in players enter the live rotation queue.

### Access rules

- **Public:** Discoverable by eligible nearby players.
- **Private:** Accessible only through an invitation, QR code, or session code.
- **Invite-only:** Only selected Peakle accounts can register.
- **Guests:** Organizers can manually add players who do not have Peakle accounts.
- Capacity must be enforced transactionally by the database.

### Success targets

- A registered player can join in under 30 seconds.
- Queue and registration updates appear on all devices within two seconds.
- A full session automatically places additional players on a waitlist.
- No player can occupy multiple active positions in the same session.

## Priority 2 — Fair Play Engine

PEAKLE should differentiate through a transparent, configurable rotation system rather than a hidden or purely manual queue.

**Implemented July 17, 2026:** Fair Play Engine v1 ranks checked-in players using waiting time, game-count deficit, consecutive games, configured rest, availability, ratings, repeat partners/opponents, play format, and an explicit organizer priority. It generates balanced singles or doubles lineups with a plain-language explanation and wait estimate. Assignment and match completion use organizer-only database transactions, prevent one player from occupying two live courts, and create an immutable rotation decision record. Any organizer lineup change requires an override reason, which is visible in the live player view. Players see their queue position, estimated wait, near-court state, active courts, lineups, and scores through Realtime-backed live state.

### Queue inputs

- Waiting time.
- Games already played.
- Consecutive games.
- Skill balance.
- Singles or doubles preference.
- Repeated partners and opponents.
- Rest requirement.
- Player availability and departure status.
- Organizer priority rules.

### Player transparency

- Show current queue position.
- Show estimated wait time.
- Explain why a player or group is next.
- Display courts and active games in real time.
- Notify players when they are nearly on court.
- Record organizer overrides with a reason and audit history.

### Success targets

- Rotation can be generated without manual paddle stacking.
- Players receive balanced game counts within a defined tolerance.
- Organizers can override assignments without corrupting queue state.
- Every assignment decision is explainable.

## Priority 3 — Real-time operations and notifications

**Implemented July 17, 2026:** registration, queue, session, court, lineup, score, decision, announcement, and notification tables are published through Supabase Realtime. Both player and organizer live views report connection health and recover automatically; the organizer session is cached locally and priority/departure changes use an idempotent, revision-checked offline operation log on reconnect. Database triggers create an in-app/push outbox for approvals, waitlist promotions, reminders, court assignments, match point, results, cancellations, and venue announcements. Expo device registration and a batch push Edge Function complete delivery. Organizers can publish announcements, open a venue TV queue display, and manage owner, manager, front-desk, court-monitor, scorer, and read-only access. Production deployment still requires applying migration `202607170002`, deploying the push function, and enabling its two scheduled jobs as described in `supabase/README.md`.

### Deliverables

- Supabase Realtime subscriptions for registration, queue, courts, scores, and session status.
- Push notifications for approval, waitlist promotion, check-in reminders, court assignments, match point, results, cancellations, and venue announcements.
- Connection health indicator and automatic reconnection.
- Offline-capable organizer queue with conflict-safe synchronization.
- Optional venue TV display for queue, court status, and next players.
- Staff roles for owner, manager, front desk, court monitor, scorer, and read-only viewer.

## Priority 4 — Best-in-class booking

**Implemented July 17, 2026:** verified venues now expose Realtime-backed booking availability that includes confirmed/pending reservations and court- or venue-wide blackouts. Venue owners can publish peak, off-peak, holiday, membership, and promotional pricing rules and maintenance/private-event closures. Players receive a server-calculated ten-minute quote with an explicit court subtotal, discount, fees, and final total; one idempotent transaction reserves up to twenty courts without partial success. Receipts carry a stable reference, venue time zone, payment/refund state, pricing snapshot, and revision. Players can change or cancel an eligible reservation, join a full court's FIFO waitlist, share or add the event to Google Calendar, and receive scheduled reminders or 15-minute availability offers. Production deployment still requires migration `202607170003` and the booking reminder Cron job described in `supabase/README.md`.

### Deliverables

- Accurate real-time court availability.
- Time-zone-safe calendars and receipts.
- Peak, off-peak, holiday, membership, and promotional pricing.
- Multi-court booking.
- Maintenance and private-event blackout periods.
- Booking modification and cancellation.
- Waitlist for fully booked courts.
- Clear fee breakdown before confirmation.
- Booking receipt with reference, status, payment state, refund state, venue, court, date, time, and total.
- Calendar integration and reliable reminders.

### Success targets

- Three taps from available slot to confirmation for returning users.
- No price change between summary and confirmation.
- No past-time or overlapping booking creation.
- A failed network response never creates an invisible duplicate booking.

## Priority 5 — Trustworthy payments

Payments should be introduced only after booking reliability and financial reconciliation are ready.

### Deliverables

- GCash, Maya, cards, and pay-at-venue.
- Clear platform and payment-provider fees before confirmation.
- Marketplace settlement or split payouts to verified venues.
- Webhook verification and idempotent transaction processing.
- Automatic payment reconciliation.
- Cancellation and refund rules enforced by the server.
- Downloadable receipts and complete transaction history.
- Admin tools for disputes, refunds, failed payouts, and charge investigation.

### Product principle

Never surprise players with a fee after they have selected a slot. PEAKLE should compete on transparent pricing and payment reliability.

## Priority 6 — Deep pickleball differentiation

**Implemented July 17, 2026:** PEAKLE now keeps independent singles and doubles ratings and updates them only after every registered participant confirms a ranked result; a dispute freezes verification and rating changes. The Competitive Hub adds availability sharing, partner/opponent/substitute requests, private team challenges, verified performance breakdowns by partner, opponent, venue, court, and format, and explicit profile/availability visibility controls. Players can register for leagues, ladders, seasons, tournaments, clinics, coaching, and capacity-safe program waitlists, and request venue memberships or credit packages without collecting payment before Priority 5 is deployed. Organizers can publish recurring skill-divided programs, competitions with live standings, and memberships/packages. Venue reporting includes bookings, revenue, utilization, peak hour, unique and returning players, cancellations, open-play attendance, program registration, and CSV export. Production deployment requires migration `202607170004` as described in `supabase/README.md`.

### Player and team features

- Singles and doubles ratings.
- Verified match-result workflow.
- Partner and opponent matching.
- Player availability calendar.
- Substitute-player finder.
- Team challenges and private scrimmages.
- Team leagues, ladders, seasons, and standings.
- Performance by partner, opponent, venue, court, and game format.
- Privacy and visibility controls.

### Organizer and venue features

- Skill-balanced open-play divisions.
- Clinics and coaching schedules.
- Tournament brackets and registration.
- Memberships, packages, credits, and discounts.
- Recurring sessions.
- Player attendance and retention analytics.
- Court utilization, revenue, cancellation, and peak-hour reports.
- Exportable operational and financial reports.

## Recommended delivery sequence

### Phase 1 — Complete the core loop

- Server-side organizer authorization. **Implemented July 16, 2026:** account-scoped entitlements now gate new open-play session inserts through Supabase RLS; expired organizers retain access to owned sessions for recovery and completion.
- Public/private open-play data model. **Implemented July 16, 2026.**
- Player **Join open play** screen. **Implemented July 16, 2026.**
- Session code and invitation link. **Implemented July 16, 2026.**
- Organizer approval, capacity, and waitlist. **Implemented July 16, 2026.**
- Player check-in. **Implemented July 16, 2026.**

### Phase 2 — Live session advantage

- QR generation and QR scanning.
- Supabase real-time registration and queues.
- Fair Play Engine version 1.
- Push notifications.
- Venue TV queue display.

### Phase 3 — Reliable venue operations

- Court calendars and blackout periods.
- Advanced pricing.
- Booking modification and cancellation.
- Staff roles and audit logs.
- Venue analytics.

### Phase 4 — Monetization

- Production Organizer Pass entitlement.
- Payment provider integration.
- Transparent fees, venue payouts, reconciliation, and refunds.
- Venue memberships and packages.

### Phase 5 — Network moat

- Leagues, ladders, tournaments, and coaching.
- Verified ratings and player reputation.
- Cross-venue profiles and city rankings.
- Team and community growth tools.

## Launch strategy

Do not launch nationwide with empty venue listings. Start with three to five real pickleball venues in one city or tightly connected area.

For each pilot venue:

- Import accurate courts, prices, schedules, policies, and coordinates.
- Train at least two staff members.
- Run real open-play sessions using PEAKLE registration and queues.
- Measure booking success, joining time, queue fairness, support issues, and venue workload.
- Interview players and organizers weekly.
- Fix operational problems before adding the next venue.

## Core product metrics

- Weekly active players and organizers.
- Verified active venues.
- Open-play discovery-to-join conversion.
- Booking discovery-to-confirmation conversion.
- Registration completion time.
- Average queue update latency.
- Booking failure and double-booking rate.
- Payment success and refund completion rate.
- Session completion rate.
- Player games-per-session fairness variance.
- Thirty-day player and venue retention.
- Organizer overrides per session.
- Support incidents per 100 bookings.

## Features to avoid building too early

- Custom in-app turn-by-turn navigation.
- Large social feeds without active venue supply.
- National rankings before match verification is reliable.
- Complex rewards before bookings and payments are trustworthy.
- Multiple sports before PEAKLE wins its pickleball workflow.
- Advanced AI features without clean operational data.

## Definition of competitive readiness

PEAKLE is ready to compete when a new player can discover a verified venue, join an open-play session, check in, see a fair live queue, play and record a match, and receive a correct receipt without organizer-side manual re-entry or support intervention.
