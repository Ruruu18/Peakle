# Beta dependency advisory disposition

Date: 2026-08-25
Owner: Peakle engineering
Applies to: `v1.0.0-beta.1` only
Review/expiry: 2026-09-30, or before the next public release

## Resolved

- Organizer portal: pinned transitive `nanoid` to `3.3.18`; `npm audit` reports zero vulnerabilities.
- Admin portal: pinned transitive `nanoid` to `3.3.18`; `npm audit` reports zero vulnerabilities.
- Mobile workspace: pinned transitive `postcss` to `8.5.25`, removing the source-map file-disclosure advisory from the Expo Metro chain.

## Temporarily accepted for the closed beta

The mobile workspace reports 8 high and 17 moderate dependency findings. They are a single interconnected Expo SDK 54 development/build-tool chain (`expo`, Expo CLI/config/prebuild packages, Metro, `image-size`, `xcode`, `uuid`, Jest Expo, Ngrok, and SDK-coupled modules). npm offers no compatible in-major remediation; its proposed resolution is a major Expo/React Native toolchain change and is not safe to introduce immediately before beta signing.

The high-severity root causes are Metro's development-server handling and `image-size` parser denial-of-service advisories (GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq). The moderate UUID advisory (GHSA-w5hq-g745-h8pq) is reached by Xcode project generation and the optional Ngrok development tunnel. These packages are not application server dependencies and are not shipped as remotely callable JavaScript services inside the signed mobile binary.

Risk controls for this beta:

- Builds use only reviewed repository assets; CI and release machines do not process untrusted ICNS, JXL, HEIF, source-map, or Xcode-project input.
- Metro is development-only, binds to trusted developer environments, and is never exposed as a production service.
- Ngrok/tunnel mode is prohibited for release builds and beta operations.
- Portal deployment remains separated and audit-clean.
- Expo Doctor, unit tests, type checks, production bundles, and signed builds must pass at the accepted lockfile before distribution.
- Any new critical advisory, evidence of remote runtime reachability, or change to the lockfile invalidates this acceptance.

## Required follow-up

Upgrade the mobile app from Expo SDK 54 to the current supported SDK in a dedicated branch, regenerate native projects, then repeat notification, payment, OAuth, media, location, Sentry, and store-signing regression tests. Close this acceptance only when the root audit is clean or each remaining advisory has a new documented disposition.
