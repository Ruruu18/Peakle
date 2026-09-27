# Peakle — Expo app

React Native implementation of Peakle, backed by Supabase for authentication and persistent app data.

## Player web beta

Run `npm run preview:web` for a freshly rebuilt production preview at
`http://localhost:8081`, using the same build and hosting rules as Vercel.
Restart it after source changes to rebuild. For browser development with live
updates, run `npm run web` at `http://localhost:8082`. It shares the native app's accounts
and saved records, with group chat and player tournament flows. See
[`PLAYER_WEB_BETA.md`](./md/PLAYER_WEB_BETA.md) for deployment, verification, and
the transition to Android/iOS.

## Organizer web portal

The responsive Next.js organizer workspace now lives in [`organizer-web`](./organizer-web). It shares Peakle authentication and backend permissions while providing desktop, tablet, and mobile-web layouts for venue operations, open play, players, competitions, memberships, analytics, and staff access.

```bash
cd organizer-web
npm install
npm run dev
```

See [`organizer-web/README.md`](./organizer-web/README.md) for authentication redirects, deployment configuration, verification commands, and the migration handoff.

## Screens

- `HomeScreen` — player dashboard
- `BookScreen` — court discovery and booking
- `PlayScreen` — match setup and live scoring
- `TeamScreen` — teams, leaderboards, and squad management
- `ProfileScreen` — player profile and settings
- `PickleballHubScreen` — verified ratings, matching, competition, programs, memberships, and venue insights

These and the rest of the player/organizer screens are connected through the custom Peakle bottom-tab navigator in `src/navigation/AppNavigator.js`.

## Run it

```bash
npm install
cp .env.example .env
# Add Supabase and Google public client settings to .env, then apply the migrations.
npm start
```

Scan the QR code with Expo Go, or press `i` / `a` for an iOS or Android simulator.

## Spoken score announcements

Announce mode automatically selects an available natural/premium English voice,
Google English voice, or enhanced device voice before using a basic voice. It uses
the browser's Web Speech API on web and `expo-speech` on Android/iOS, with no cloud
API key or billing account. Voice quality depends on the voices supplied by the
browser or installed in the device's text-to-speech engine. Browser network voices
can require internet; offline or failed requests fall back to an available local
voice or the system default. This selection applies to spoken announcements;
listening for score commands still uses `expo-speech-recognition`.

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
