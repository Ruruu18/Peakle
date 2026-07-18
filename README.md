# Peakle — Expo app

React Native implementation of Peakle, backed by Supabase for authentication and persistent app data.

## Screens

- `HomeScreen` — implemented dashboard
- `BookScreen` — court discovery scaffold
- `PlayScreen` — match setup scaffold
- `CompeteScreen` — leaderboards and squad scaffold
- `ProfileScreen` — player profile scaffold
- `PickleballHubScreen` — verified ratings, matching, competition, programs, memberships, and venue insights

The five screens are connected through the custom Peakle bottom-tab navigator in `src/navigation/AppNavigator.js`.

## Run it

```bash
npm install
cp .env.example .env
# Add Supabase and Google public client settings to .env, then apply the migrations.
npm start
```

Scan the QR code with Expo Go, or press `i` / `a` for an iOS or Android simulator.

## New-account onboarding

The feature overview is part of account setup rather than app startup:

- logged-out users always open directly on Login, including after an app refresh;
- the overview appears after a newly registered account is authenticated;
- completing or skipping the overview continues into profile personalization;
- accounts with completed profiles open the main app and do not repeat the overview.

Android cloud backup remains disabled in `app.json` so authentication data is not unexpectedly restored after reinstalling the app.

## Platform and release compatibility

This project uses Expo SDK 54 / React Native 0.81. Its supported operating-system floor is Android 7 and iOS 15.1. Newer Android and iOS releases are supported through the same Expo runtime; devices below those minimums require a separately maintained legacy app and cannot run this build safely.

For every store release, increment all relevant version fields in `app.json`:

- `expo.version` for the user-facing release version;
- `expo.android.versionCode` for each Google Play build;
- `expo.ios.buildNumber` for each App Store/TestFlight build.

The Android keyboard uses resize mode so authentication and profile fields remain reachable on smaller and older screens. The onboarding overview itself is scrollable for compact displays.

## Release size optimization

Production Android builds use R8 code minification and unused-resource shrinking. The EAS production profile also explicitly outputs an Android App Bundle (`.aab`), allowing Google Play to deliver only the native libraries and resources needed by each user's device instead of a larger universal APK.

These optimizations are release-only and do not change the application's UI or feature set. Use the production profile for store releases:

```bash
eas build --platform android --profile production
```

## Database

The app is configured for `https://melbfzfuxrviybblipua.supabase.co`. See `supabase/README.md` for the one-time database setup. The schema includes profiles, venues/courts, bookings, teams/chat, matches/scoring, and organizer sessions with row-level security.

Authentication setup (Google OAuth, email, redirect URLs, and password recovery) is documented in `supabase/README.md`.

## Organizer Pass demo

Organizer Pass currently runs as a payment-free, local subscription sandbox. Player accounts can review plans from Profile, activate demo access, unlock the Organizer workspace, and test cancellation, expiration, reinstall, and restoration without contacting a payment provider. The implementation and production billing migration are documented in `md/2026-07-16-organizer-pass-demo-and-production-plan.md`.
