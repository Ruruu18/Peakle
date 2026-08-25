# Peakle beta privacy disclosure inventory

Last reviewed: August 25, 2026

This inventory is the release source of truth for `ios/Peakle/PrivacyInfo.xcprivacy`, App Store Connect App Privacy, Google Play Data Safety, and Peakle's public privacy policy. Re-review it whenever a provider or data flow changes.

## Data collected

| Data | Linked to account | Tracking | Purpose and handling |
| --- | --- | --- | --- |
| Name and email | Yes | No | Authentication, profile identity, account recovery, safety, and support |
| User ID | Yes | No | Account authorization and record ownership |
| Precise and coarse foreground location | Yes | No | Nearby venues and opt-in nearby-player distance; never advertising |
| Profile photos and user-uploaded chat/organizer media | Yes | No | User-selected app functionality |
| Speech-recognition audio | No | No | Processed only while shouted scoring is active; Peakle does not intentionally retain raw audio |
| Messages, match scores, teams, reports, blocks, and other user content | Yes | No | Communication, competition, safety, and core app operation |
| Pickleball rating and match activity | Yes | No | Player history, matching, standings, and personalization |
| Expo push token/device identifier | Yes | No | Account-scoped notifications; removed or disabled on sign-out/account deletion |
| Booking, membership, payment-method label, and refund history | Yes | No | Fulfillment, receipts, fraud prevention, refunds, disputes, and legally required records |
| Product interactions | Yes | No | Core activity state and limited service analytics |
| Crash, performance, and other diagnostics | No by configuration | No | Sentry reliability monitoring with `sendDefaultPii: false`; 90-day maximum stated retention |

Payment credentials are entered on PayMongo-hosted checkout. Peakle receives provider transaction identifiers, status, amount, and method label, but not card or wallet credentials.

## Providers receiving data

- Supabase: authentication, database, storage, Realtime, and Edge Functions.
- Expo and Firebase/APNs: push delivery and device tokens.
- Sentry: crash and performance diagnostics without default PII.
- Google/Apple: optional sign-in, maps, and operating-system speech recognition.
- PayMongo: checkout, payment confirmation, and refunds.
- Venue operators: the booking, membership, and operational details needed to fulfill a user's request.

## Store console checklist

- App Store Connect must declare every collected type represented in the privacy manifest, with tracking set to **No**.
- Google Play Data Safety must declare account information, location, photos/video, messages/user content, app activity, device IDs, purchase history, and diagnostics as applicable.
- Both stores must use the public privacy URL and account-deletion URL from `.env.example`.
- Confirm App Store Connect and Google Play answers against the production build, not demo mode.
- Re-check disclosures after enabling any advertising, marketing attribution, session replay, background location, contacts, or new analytics provider.
