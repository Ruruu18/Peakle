# Public release dependency advisory disposition

Date: 2026-09-24
Owner: Peakle engineering
Applies to: the public web release covered by
`md/2026-09-23-public-web-release-review.md` (baseline commit `29c521c` plus
the local hardening changes made during that review)
Review/expiry: 2026-12-24, or before any subsequent public release, whichever
comes first

This supersedes `md/2026-08-25-beta-dependency-risk-acceptance.md` for
anything beyond closed beta. Its expo/Metro build-toolchain reasoning still
holds and is restated below with current numbers; this document adds the
runtime-reachable finding that acceptance explicitly deferred.

## Current state

`npm audit --omit=dev` at the repository root reports **31 affected package
entries: 12 high, 19 moderate, zero critical** (checked 2026-09-24).

### Build/dev-toolchain cluster — unchanged disposition, still accepted

30 of the 31 entries are a single interconnected Expo SDK 54
development/build-tool chain: `expo`, `@expo/cli`, `@expo/config`,
`@expo/config-plugins`, `@expo/metro*`, `@expo/prebuild-config`, `metro`,
`metro-config`, `metro-transform-worker`, `image-size`, `xcode`, `uuid`,
`@xmldom/xmldom`, `js-yaml`, `browserslist`, `baseline-browser-mapping`,
`fast-uri`, and the `expo-*` packages that resolve through it (including
`expo-auth-session`, `expo-constants`, `expo-dev-client`, `expo-dev-launcher`,
`expo-linking`, `expo-manifests`, `expo-notifications`, `expo-splash-screen`).
`@sentry/react-native` is flagged only because `expo` sits in its dependency
chain (`via: ["expo"]`) — Sentry itself has no independent advisory here.

npm's only offered remediation is a major Expo/React Native toolchain change
(`npm audit fix --force` would downgrade/cross-grade Expo and native project
generations), which the prior acceptance already ruled out as unsafe to do
casually, and which the release review explicitly says not to do blindly.
These packages are development/build tooling, not application server code,
and are not shipped as a remotely callable service inside the deployed
organizer web app or the signed/exported player builds.

Risk controls carried forward from the beta acceptance still apply: builds
use only reviewed repository assets; CI/release machines don't process
untrusted ICNS/JXL/HEIF/source-map/Xcode-project input from outside the repo;
Metro and any tunnel mode are development-only and never exposed as a
production service; organizer-web deploys separately and its own production
audit is clean (see the release review's fixes table).

### Runtime-reachable finding — decode-uri-component (new for this release)

**Chain:** `@react-navigation/core` → `query-string@7.1.3` →
`decode-uri-component@0.2.2`, exercised through React Navigation's linking
config (`App.js`) when it parses an incoming URL — both the `peakle://` deep
link scheme on native and the player web app's path-based routing on web.

**Advisory:** [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
— malformed percent-encoded input can drive the fallback decoder into
exponential-time recursion (denial of service via CPU exhaustion).

**Why it isn't upgraded:** the advisory's range is `<=0.4.2`; the only
published release outside that range is `0.5.0`. We pulled and diffed both
packages directly: `0.5.0` does fix the algorithmic issue (it replaces the
recursive splitting fallback with a linear left-to-right scanner), but it
also switched the package to ESM-only (`"type": "module"`, `exports` with no
`require` entry, no `main` field) and dropped the `+`-to-space query
preprocessing the 0.2.x line does before decoding. `query-string@7.1.3`
still `require()`s this package as CommonJS with a `^0.2.0` dependency range.
Forcing `0.5.0` through an npm `overrides` entry would make that `require()`
fail outright — a hard crash in the app's own navigation/linking resolution,
not a narrow behavior change — and no `query-string` release compatible with
our current React Navigation major depends on the fixed version. There is no
safe drop-in fix today.

**Actual exposure:** this requires an attacker to get a specific victim to
open a crafted URL (a shared deep link, QR code, or malicious web link) into
the Peakle app. The failure mode is CPU-bound hang, scoped to that single
browser tab or app session on the victim's own device — it does not expose
data, does not touch the server, and does not affect any other user. This
review did not reproduce an exploit; it confirmed the dependency and call
path.

**Accepted for this release, with controls:**
- No change to how the app is exposed beyond what already exists — this was
  already reachable in the current production mobile app before this review.
- Tracked here explicitly so it isn't silently carried forward: re-check
  `npm view decode-uri-component versions` and `npm view query-string
  versions` at each review date above for a CommonJS-compatible fixed
  release, and take it once available.
- Any evidence of actual exploitation, or a critical-severity escalation of
  this advisory, invalidates this acceptance immediately and requires an
  unscheduled fix (e.g. vendoring a patched decoder via `patch-package`
  ahead of an upstream release).

## Required follow-up

Same as the beta acceptance: move the mobile app off Expo SDK 54 to the
current supported SDK on a dedicated branch, regenerate native projects, and
repeat notification, payment, OAuth, media, location, Sentry, and
store-signing regression tests — that upgrade is what clears the 30-entry
build-toolchain cluster. Separately, watch for a CommonJS-compatible
`decode-uri-component` fix (or a `query-string` major that no longer depends
on it) and take it as soon as it lands, rather than waiting for the next
scheduled review.
