# Peakle System Audit — Web, Mobile & Backend

**Date:** 2026-08-29
**Scope:** Mobile app (Expo/React Native, `src/`), Organizer web portal (`organizer-web/`), Admin portal (`admin-web/`), Backend (`supabase/`)
**Method:** Static analysis, `tsc`/`eslint`/`jest` execution, migration/RLS review, and manual code reading across all four codebases, with focused review of the in-flight, uncommitted "Support Chat" feature touching every layer of the stack.

---

## 1. Executive Summary

The codebase is in good overall health — both apps compile clean, the mobile test suite is 100% green, and the backend's RLS/migration discipline is genuinely strong (no SQL injection, no exposed secrets, no privilege-escalation gaps found anywhere). The problems found are concentrated, not systemic:

- **One cross-platform functional bug** breaks the same user-facing feature identically on mobile *and* web (found independently by two separate audits, which is strong confirmation).
- **One CI-breaking lint error** currently makes `organizer-web` fail its own lint script.
- **One real production bug** in the admin portal (refund processing will fail against a real deployment due to missing CORS).
- **~350 lines of dead, broken native code** in the mobile app left over from an organizer-tooling migration to the web portal.
- **A handful of medium/low findings**: a UI re-render glitch, an unauthenticated edge function, missing route-level error boundaries, some test-coverage gaps on high-risk files (auth session handling).

Nothing found indicates data loss, security breach, or broad instability. Most issues are traceable to one thing: **the team ships code without running `npm install` / `tsc` / `eslint` / `jest` first** — this repo had zero `node_modules` installed anywhere before this audit, meaning none of these checks had been run locally or in CI recently. That's the single highest-leverage fix available (see §7).

---

## 2. Build / Test Evidence (ground truth, not opinion)

| Check | Result |
|---|---|
| Mobile `jest` (406 tests, 13 suites) | ✅ **All passing** |
| `organizer-web` `tsc --noEmit` | ✅ **Clean, 0 errors** |
| `organizer-web` `eslint .` | ❌ **1 error, 2 warnings — exit code 1 (fails CI)** |
| `admin-web` `tsc --noEmit` | ✅ **Clean, 0 errors** |
| Root/`organizer-web`/`admin-web` `node_modules` | ❌ **Not installed prior to this audit** — nothing had been locally verified before these changes were made |

---

## 3. Cross-Platform Critical Finding: "Talk to a Human" Is Unreachable

**Severity: High — found independently on mobile and web, same root cause, ships in the current uncommitted diff.**

The new server-side auto-responder (`supabase/migrations/202608280002_builtin_support_responder.sql`) sets `status = 'open'` in the **same update** that sets `needs_human = true` whenever the bot can't answer a question. But both frontends gate the "Talk to a human" button and its explanatory copy on `status === 'bot' && needs_human === true`:

- Mobile: `src/screens/SupportChatScreen.js:412,419`
- Web: `organizer-web/features/organizer/sections/support-section.tsx:75`, `organizer-web/features/organizer/components/support-widget.tsx:129`

Since the backend never produces that combination anymore (status flips to `'open'` at the same moment `needs_human` flips to `true`), **this condition can never be true**. The button never renders, the explanatory "I couldn't find an answer" copy never shows, and `requestHumanSupport()` / `talkToHuman()` become dead code reachable from nowhere on both platforms.

**Functionally the user still reaches a human** (the conversation auto-escalates to the open queue), but the intended manual-escalation UX — and its copy — is invisible. This is either:
- (a) intentional (escalation is now automatic, so the manual button should be **removed**), or
- (b) a regression (the button was supposed to still offer manual escalation before auto-escalation kicks in, so the **condition should be updated**).

**Recommendation:** Pick one deliberately and delete the other half — right now both exist and only one is reachable, which is exactly the kind of drift that produces confusing "the human button doesn't do anything" bug reports later.

---

## 4. Mobile App (`src/`)

### Broken / Not Working
| Severity | Finding |
|---|---|
| Critical (latent) | `src/screens/PickleballHubScreen.js:1248-1251` — Organizer "Create Program/Competition/Membership" buttons call `navigation.navigate('CreateProgram'\|'CreateCompetition'\|'CreateMembership'\|'Pass', ...)`, but none of these routes exist in `src/navigation/AppNavigator.js`. Would crash immediately if this screen were ever reachable (see dead-code finding below — it currently isn't). |
| High | See §3 above — "Talk to a human" unreachable. |
| Medium | A migration that may have already shipped (`supabase/migrations/202608260001_support_chat.sql`) was edited **in place** to fix an `ON CONFLICT` bug, *and* a second, functionally duplicate migration (`202608280001_fix_support_conversation_output_conflict.sql`) was added for the same fix. Editing an already-applied migration is risky; pick one approach. |
| Low | `triggerSupportAiReply` was cleanly removed from `src/services/supportChat.js` with no dangling callers (verified). The edge function it called (`supabase/functions/support-ai-reply`) is now fully orphaned dead code — nothing in mobile, web, or admin calls it anymore. |
| Low | The FAQ knowledge base already exists in **three places** (dead edge function, live SQL function, quick-reply config) and has **already drifted**: the dead edge function has a `'push notification'` keyword the live SQL version lacks. |

### Missing Features / Incomplete
| Severity | Finding |
|---|---|
| Medium/High | **~350 lines of dead, broken organizer-management UI** in `PickleballHubScreen.js` (`OrganizerHub`, `OrganizerCreateActivityScreen`, and 6 exported screen wrappers) are never imported by `AppNavigator.js` or referenced anywhere else. The real organizer entry point is `ProfileScreen.js:712`, which opens `organizer-web` via a deep link. This code — including the broken navigation calls above — should be deleted; it's confusing dead weight from an incomplete migration to the web portal. |
| Low | Support-conversation `category` taxonomy differs between `src/config/supportQuickReplies.js` and `src/screens/HelpSupportScreen.js`'s `SUPPORT_CATEGORIES` — same field, two different value sets, will make admin-side filtering/reporting inconsistent. |
| Low | `src/components/SupportBubble.js:27` undercounts the unread badge: it excludes any conversation with `status === 'closed'`, so a final agent reply sent right before an admin closes the thread never gets counted. |
| Low | `SupportBubble.js` uses raw `StyleSheet.create` instead of the shared `createMobileStyleSheet` normalizer that the rest of the support-chat screens use (house convention per `md/2026-07-22-mobile-ui-ux-audit.md`). |

### Testing Gaps
- ✅ High-risk services already covered: `payments.js`, `realtimeOperations.js`.
- ❌ **No test file for `src/services/supportChat.js`** — the most actively-changed service right now; a test would likely have caught the §3 regression.
- ❌ **`src/context/AuthContext.js` (582 lines) has zero tests.** This is the highest-risk untested file in the app — it handles session restore, OAuth, sign-out, and account deletion with concurrency guards (`authGeneration`). A regression here is easy to introduce silently and hard to catch by hand.
- ❌ Also untested: `errorReporting.js`, `externalMaps.js`, `organizerMedia.js`, `playerActivities.js`, `profilePhotos.js`, `routeDistance.js`, `venueLocation.js`, and every context except `ThemeContext`.

### What's Working Well
- All 406 existing tests pass.
- Proper realtime channel/timer cleanup, race-guard patterns (`cancelled` flags), and optimistic-update rollback on failed media sends throughout the support chat screens.
- Dependency vulnerabilities are already tracked and risk-accepted through 2026-09-30 (`md/2026-08-25-beta-dependency-risk-acceptance.md`) — not re-flagged here.

---

## 5. Organizer Web Portal (`organizer-web/`)

### Broken / Not Working
| Severity | Finding |
|---|---|
| **Critical (CI-blocking)** | `features/organizer/components/support-widget.tsx:208` — `react-hooks/refs` ESLint error ("Cannot access refs during render"). `npm run lint` currently **fails with exit code 1**. The repo is in a non-shippable lint state as of the uncommitted diff. |
| High | Same file, lines 18-40 — the `Typewriter` component's `useEffect` depends on `onDone`, but the caller passes a **new closure every render** (`onDone={() => typedMessagesRef.current.add(message.id)}`, line 224). Any re-render of `SupportWidget` (e.g. every keystroke in the message box) tears down and restarts the typing animation, so a bot reply visibly **snaps back to the start and re-types itself** while the organizer is typing. Fix: `useCallback` keyed on `message.id`, or move `onDone` out of the dependency array via a ref. |
| High | `features/organizer/hooks/use-support-chat.ts:165-178` — the realtime subscription refreshes the conversation list and messages, but **never calls `loadDetail(selectedId)`**. Status, `needs_human`, assignment, and CSAT fields go stale in real time until the user manually reopens the conversation — mobile's equivalent (`SupportChatScreen.js:299`) does call the update handler. This is a real feature parity gap. |
| Medium | `use-support-chat.ts:105-119` (`loadMessages`) calls `signSupportChatMedia(...)` with no `try/catch`, unlike every other Supabase call in the file. A signing failure (storage outage, RLS issue) becomes an **unhandled promise rejection** with no user-visible error — the message list silently goes stale. |
| Low | Two raw `<img>` tags flagged by `@next/next/no-img-element` (acceptable for signed URLs, but should be an explicit lint-disable, not a silent warning). |

### Missing Features / Incomplete
| Severity | Finding |
|---|---|
| Medium | **No `loading.tsx`, `error.tsx`, `not-found.tsx`, or `global-error.tsx`** anywhere under `app/` — no Suspense fallback, no error boundary (an uncaught render error white-screens the app), no custom 404. |
| Low/Medium | Quick-reply category inconsistency: the floating widget (`support-widget.tsx:202`) starts a conversation with **no category**, while the full support page (`support-section.tsx:233`) sets `category = item.label` for the identical quick reply. |
| Low | Redundant fetch storm on send: `sendMessage` manually reloads messages/conversations/detail, and the realtime `INSERT` event for that same message triggers a second, near-identical reload — doubling media re-signing work per send. |

### Security / Correctness
- ✅ No client-side trust issues — every mutating RPC is `security definer` and scoped server-side; RLS policies match.
- ✅ No hardcoded secrets (only `NEXT_PUBLIC_*` vars).
- ✅ Server-side rate limiting on support messages (6/10s, 30/min).

### Senior-Dev Recommendations
- Several section files (`programs-section.tsx`, `memberships-section.tsx`, `competitions-section.tsx`, `analytics-section.tsx`, `players-section.tsx`) pack entire component trees onto single 100-800+ char lines — fully functional, but hostile to code review and diffs. Run a Prettier reformat pass.
- `STATUS_LABEL`, `formatTime`, and the `needsHuman`/status-text derivation are duplicated identically between `support-widget.tsx` and `support-section.tsx` — extract into a shared helper alongside `use-support-chat.ts`.
- Adopt mobile's incremental per-row message upsert pattern instead of full reloads — fixes the double-fetch issue and naturally would have caught the missing-`loadDetail` bug in the same pass.

---

## 6. Admin Portal (`admin-web/`)

**Overall: well-executed, fully built out, exceeds its original scope.** `tsc --noEmit` is clean. The original plan (`md/2026-08-05- admin interface `) scoped 4 sections; the shipped app has 6 (dashboard, users, venues, financials, support, access) — financials and support were added later and are fully implemented, not stubs.

| Severity | Finding |
|---|---|
| **High** | `admin-web/lib/admin-data.ts:390` calls `supabase.functions.invoke("process-refund", ...)` directly from the browser, but **no edge function in the repo sets CORS headers** (zero matches for `Access-Control-Allow-Origin` across `supabase/functions`). A browser preflight for this cross-origin POST will very likely be rejected in a real deployment — **the admin "process refund" workflow is probably broken today.** |
| Low | Admin access control is entirely client-side (`is_platform_admin()` RPC called after the page has already loaded). Acceptable only because every actual data query is separately RLS/RPC-gated server-side (verified) — but it's a defense-in-depth gap worth closing, especially since `@supabase/ssr` (needed for a proper middleware session check) is already a dependency. |

---

## 7. Backend (`supabase/`)

### Migration Hygiene: Strong
Idempotent re-runs, named-constraint drops instead of guesses, explicit function-signature drops before signature changes, clean sequential timestamps across 90+ migration files with zero collisions. The three support-chat migrations apply cleanly in order and the new trigger-based responder correctly guards against recursion and against the (now-dead) edge function double-firing.

### Security
| Severity | Finding |
|---|---|
| **High** | No edge function sets CORS headers at all — fine for React Native callers, but breaks any browser caller (ties directly to the admin refund bug above). Recommend a shared `_shared/cors.ts` helper. |
| Medium | `supabase/functions/route-distances/index.ts` has **no `auth.getUser()` check** — every other edge function in the repo (`create-checkout-session`, `delete-account`, `process-refund`, `support-ai-reply`) does have one. Any unauthenticated caller can burn through the metered `OPENROUTESERVICE_API_KEY` quota. |
| ✅ Good practice | `paymongo-webhook/index.ts` — proper HMAC-SHA256 signature verification, timing-safe compare, 300s freshness window. |
| ✅ Good practice | `send-push-notifications/index.ts` verifies its dispatch secret via a database RPC rather than a raw comparison, and fails closed. |
| ✅ Good practice | `platform_admins` RLS: SELECT-only initially, later correctly extended with INSERT/DELETE gated by `is_platform_admin()` plus an explicit self-removal guard. No privilege-escalation path found. |
| ✅ Good | No exposed service-role keys in any client code; no raw SQL string concatenation anywhere (injection risk: none found). |

### Cleanup
- `supabase/functions/support-ai-reply/index.ts` is confirmed dead (zero callers across mobile, web, admin) — delete it, or the triplicated FAQ list will keep drifting (it already has).
- The `needs_human`/`status` coupling described in §3 should be fixed here, since it's the root cause on both frontends.

---

## 8. Consolidated Missing-Features List

1. Manual "Talk to a human" escalation UX (currently unreachable on both platforms — §3).
2. Native mobile organizer-management screens (currently dead/broken code, not a true gap since `organizer-web` replaced it — recommend deleting rather than finishing).
3. App-Router error/loading/not-found boundaries in `organizer-web`.
4. CORS support on edge functions callable from a browser (blocks admin refund processing today).
5. Auth gate on `route-distances` edge function.
6. Consistent support-conversation category taxonomy across mobile, web, and backend.
7. Test coverage for `AuthContext.js`, `supportChat.js`, and several other mobile services/contexts.

---

## 9. Prioritized Action Plan (Senior-Dev Recommendation)

**Do first (this week):**
1. Fix the `react-hooks/refs` ESLint error in `support-widget.tsx` — CI is currently red.
2. Decide and fix the `needs_human`/`status` "Talk to a human" contradiction — affects both apps identically.
3. Add CORS headers to `process-refund` (and standardize via a shared helper across all functions) — real admin workflow is likely broken.
4. Fix the `Typewriter` `onDone` closure bug in `support-widget.tsx` — visible, embarrassing UI glitch during normal use.

**Do soon (this sprint):**
5. Add `auth.getUser()` to `route-distances`.
6. Add `loadDetail` to the web realtime subscription so conversation status/assignment stay live.
7. Delete the dead `support-ai-reply` edge function and the dead `OrganizerHub`/`OrganizerCreateActivityScreen` block in `PickleballHubScreen.js` — both are drift/confusion risks with no upside to keeping.
8. Wrap `signSupportChatMedia` calls in `try/catch` in `use-support-chat.ts`.

**Process fix (highest leverage, lowest effort):**
9. **Run `npm install && npm run typecheck && npm run lint && npm test` before every merge**, ideally in CI. None of these were being run — that's how a CI-breaking lint error and a re-render bug shipped in the same uncommitted diff. This single change would have caught 4 of the 5 highest-severity findings in this report before they reached review.

**Backlog:**
10. Unit tests for `AuthContext.js` and `supportChat.js`.
11. Reconcile the three duplicate FAQ knowledge bases into one source of truth.
12. Reformat the dense single-line JSX files in `organizer-web` for reviewability.
13. Add a server-side (middleware) auth check to `admin-web` as defense-in-depth.
14. Unify support-category taxonomy across mobile, web, and the database.

---

## Appendix: Method Notes

- Findings were produced by three independent focused audits (mobile, organizer-web, backend+admin-web) plus direct verification of build/test/lint output and manual reading of the in-flight support-chat diff by the coordinating review. The §3 finding was flagged independently by two of the three audits from different code paths, which is strong cross-confirmation.
- Dependency-vulnerability findings (Expo/RN toolchain) were intentionally excluded — they are already tracked and risk-accepted through 2026-09-30 in `md/2026-08-25-beta-dependency-risk-acceptance.md`.
- Full test/lint commands used: `npx jest --silent` (root), `npx tsc --noEmit` + `npx eslint .` (`organizer-web`), `npx tsc --noEmit` (`admin-web`).
