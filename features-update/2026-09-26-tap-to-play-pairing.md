# Tap to Play — Phone-to-Phone Match Pairing

**Status:** Proposed  
**Recommended release:** Web version first, native version in a later update  
**Goal:** Let two players start a match by touching or bumping phones, similar to iOS NameDrop

## Purpose

Starting a match today means searching for the other player and inviting them. On court, it would be faster for two players to hold their phones together and get a "Play with **Alex**?" prompt. Both players accept, and the match is created.

## Why real NFC or NameDrop is not possible on the web

- **Web NFC works only in Chrome on Android.** Safari and all iOS browsers do not support it.
- **Web NFC cannot pair phones directly.** It only reads and writes NFC tags (stickers and cards). Two phones cannot exchange data through it.
- **NameDrop is Apple-only.** It uses NFC, Bluetooth, and UWB together. It works only between Apple devices, and other apps cannot use or copy it.
- **Browsers block this hardware.** Safari gives websites no access to NFC, Bluetooth, or UWB. No code or configuration changes this.

A native app can use this hardware (see Phase 2).

## Shared pairing flow (all versions)

Every detection method sends a signal to the same pairing service:

1. **Start.** Both players open Match Setup and turn on Tap to Play.
2. **Detect.** Each phone detects the other phone (by bump, sound, NFC, UWB, or Bluetooth) and sends a pairing event with its user ID, the time, and a rough location.
3. **Match.** The server pairs two events only when they come from **two different phones** at nearly the same moment and close together.
4. **Confirm.** Supabase Realtime shows both players "Play with **Alex**?". The match is created only when **both players accept**.

### Protection against false matches

- **One phone alone never matches.** Hitting a hand or table produces a single event, which expires after about 2 seconds. The app shows "No player found, try again."
- **Only while Tap to Play is on.** The phone sends events only while Match Setup is open and Tap to Play is on.
- **Tight time window.** Real bumps from two phones land within about 100–300 ms of each other.
- **Opposite jolts (bump mode).** Two phones knocking together jolt at the same instant in opposite directions. The server can require that match.
- **Close by.** Both phones must be within about 50 m, based on location.
- **More than one match.** If three or more phones fire at once, the server rejects all of them and asks the players to try again.
- **Both must accept.** A wrong pairing can never create a match by itself.

## Phase 1 — Web app

| Method | How it works | Limitations |
| --- | --- | --- |
| **Bump** | The motion sensor detects the jolt of two phones knocking together | iOS asks once for motion permission. Needs HTTPS. Can miss a bump or pick up an unrelated jolt (the confirm step covers this). |
| **Hold phones together (sound)** | Each phone plays a quiet high-pitched tone (about 18–20 kHz) carrying a short code and listens for the other phone's code. The tone is only heard clearly when the phones are nearly touching. | Needs microphone permission. Loud courts can drown out the tone. Some Android phones cut out very high sounds. |
| **QR code (fallback)** | One player shows a QR code and the other scans it | Always works, including on desktop |

**Recommendation:** Ship bump and sound together, with QR as the fallback.

## Phase 2 — Native app (true top-to-top)

Peakle is an Expo 54 project, so it can ship native builds that can use the phone's hardware.

| Phones pairing | What detects that they're touching | How close it has to be |
| --- | --- | --- |
| iPhone ↔ iPhone (iPhone 11+) | UWB, through Apple's Nearby Interaction API | About 5–10 cm, very accurate |
| Android ↔ Android | NFC: one phone acts as a tag, the other reads it | Touching |
| Android ↔ iPhone | NFC: the Android acts as a tag and the iPhone reads it | Touching |
| Any phone, backup | Bluetooth signal strength | About 10–20 cm, less exact |

The NameDrop-style glow animation is our own UI.

**Remaining limit:** iPhones cannot act as an NFC tag for another phone (apart from a special Apple permission that is EU-only). iPhone-to-iPhone pairing uses UWB. iPhone-to-Android pairing relies on the Android acting as the tag. Bluetooth covers the gaps.

### What it requires

- An Expo development build (Expo Go cannot run it)
- `react-native-nfc-manager` for NFC
- `react-native-ble-plx` for Bluetooth signal strength
- A small custom native module for Nearby Interaction (UWB)
- Testing on real devices (at least two iPhones and two Androids). Simulators cannot do NFC, Bluetooth, or UWB.

## Backend work (shared by both phases)

- A `pairing_events` table or RPC: user ID, time, rough location, detection method, and motion direction (for bump mode)
- Server-side matching: the time window, distance check, and rejection when more than two phones fire at once
- Realtime channel for the "Play with…?" prompt and both accepts
- Automatic expiry of events that don't pair

## Open questions

- Should the match format (singles or doubles) be chosen before pairing or after?
- For doubles, should all four phones pair, or only the two captains?
- Is location required, or optional to improve accuracy?
