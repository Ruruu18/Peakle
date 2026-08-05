# Peakle mobile UI/UX audit

Date: 2026-07-22  
Scope: Player and Organizer workspaces  
Reference viewport: 390 px mobile width

## Executive assessment

Peakle already has a strong visual identity, useful empty states, and a sensible five-tab structure. The main usability problem was not a lack of polish; it was information being compressed too aggressively. Many supporting labels, descriptions, badges, and controls were rendered at 5–10 px. This made otherwise reasonable layouts feel crowded and made users read more slowly.

The organizer workspace had three additional friction points:

1. The More screen gave too much vertical space to repeated Organizer Pass branding.
2. Staff access used a large in-content Back button instead of a normal screen header.
3. Blocking booking availability presented every decision in one long form.

These high-impact issues are fixed in the current implementation.

## Completed in this pass

| Area | Problem | Change | Result |
|---|---|---|---|
| Whole app | 5–10 px UI text was difficult to read on a phone | Added a shared mobile typography normalizer that preserves hierarchy while raising undersized styles to practical phone sizes | Player and Organizer screens now share a readable type system |
| Organizer More | Large access card repeated brand, pass name, status, and benefit copy | Rebuilt it as a compact access summary with one title, one status, one supporting line, and one action | Faster scanning and less vertical space |
| Organizer Staff | Full-width Back button looked like a primary task and pushed content down | Added a standard 44 px header back control | Clearer navigation and shorter page |
| Venue booking rules | Booking closure was one long form | Split it into two explicit steps: reason/location, then date/time | Less cognitive load and less scrolling per step |
| Booking sheets | Keyboard could cover lower fields | Added keyboard-avoiding behavior while preserving scroll | Forms remain usable on small screens |
| Organizer controls | Several edit, delete, close, and back targets were below 44 px | Increased critical targets to at least 44 px | Better one-handed use and fewer missed taps |
| Player open play | Dense metadata and small session controls | Applied the same mobile type hierarchy and increased the refresh target | Better parity with the Organizer experience |
| Shared UI | Location, notifications, avatar, match-invite, and workspace-switch surfaces used the old tiny scale | Migrated shared sheets and overlays to the mobile type system | Consistent readability across flows |

The readability layer is intentionally centralized in `src/utils/mobileStyles.js`; future screens should use it instead of calling `StyleSheet.create` directly.

## Screen audit and next priorities

### Recommendation pass completed

| Workspace | Screen | Implemented improvement | Outcome |
|---|---|---|---|
| Organizer | Players | Added counted filters for All, Needs action, Checked in, On court, and Done | A busy registration list can be narrowed before scrolling |
| Organizer | Players | Kept one next-step action on each row and moved decline/remove into a player action sheet | Rows are calmer and destructive actions are separated |
| Organizer | Staff | Replaced role cycling with an explicit role picker and a permission summary for every role | Organizers know the consequence before saving |
| Organizer | Venue booking | Replaced raw date/time entry with date stepping, presets, and 30-minute time controls | Invalid formats cannot be typed into these scheduling flows |
| Organizer | Court monitor | Added Comfortable/Compact views, a two-column compact grid, and promoted the next lineup recommendation | More courts fit on screen and the next decision appears earlier |
| Player | Home | Limited nearby-court previews and added See all | The dashboard stays bounded as venues grow |
| Player | Booking | Added a persistent date/time/total confirmation bar | The booking decision remains visible while reviewing details |
| Player | Find open play | Added counted All, Today, Within 25 km, and Open spots filters | Players can narrow sessions before scrolling |
| Player | Match result | Moved Rematch directly below the result and collapsed secondary analysis | The most common next action no longer requires reading all analytics |
| Player | Team detail | Made Roster, Requests, Matches, and Activity tabs sticky | Users can switch sections after scrolling a long roster |

### Remaining work that needs product data or device-scale testing

| Priority | Workspace | Screen | Why it remains | Recommended implementation | Acceptance criteria |
|---|---|---|---|---|---|
| P1 | Both | Accessibility scaling | A production export verifies code, not clipping at maximum system font size | Test the device matrix below and replace fixed-height containers wherever text clips | No overlap or truncation at maximum accessibility font size |
| P1 | Organizer | Court monitor | Compact mode is implemented, but representative 6-, 12-court and 30-player data is not available in the local session | Seed realistic QA fixtures or use a staging session, then tune compact card breakpoints | Next assignment remains visible and every court action stays at least 44 px |
| P2 | Organizer | Sessions | The current context exposes only one active session and no persistent session-history collection | Connect an organizer session-history query, then add Current, Upcoming, and Past segments | History is real, paginated, and never fabricated from the active session |
| P2 | Player | Find open play | Filters are implemented; a map view needs a supported native map renderer and geocoded venue coverage | Add a map only after the map provider and marker clustering behavior are selected | List and map use the same filters and accessible result count |
| P2 | Player | Teams | Sticky navigation is implemented; very large rosters still render inside a ScrollView | Move roster/request sections to FlatList after API pagination is available | 100+ rows scroll smoothly without nested-list warnings |
| P2 | Both | Offline/error QA | Static compilation cannot validate every slow-network and realtime transition | Exercise loading, timeout, reconnect, duplicate-submit, and stale-data paths on staging | No duplicate mutation and every failure offers a clear retry path |

Programs & reports already separates Programs, Competition, Memberships, and Analytics. Adding another Create/Manage/Insights layer would duplicate navigation, so it was intentionally left unchanged.

## Product-wide rules for future screens

1. Use one primary action per screen or sheet. Secondary actions should be neutral or moved into overflow.
2. Use progressive disclosure when a task asks for more than four decisions. Two short steps are preferable to one long form.
3. Use 13–15 px for body and control text, 11–12 px for supporting labels, and 10 px only for short uppercase badges.
4. Maintain a minimum 44 × 44 px touch target for every independent interactive control.
5. Do not repeat the same information in the header, hero card, and first content section.
6. Keep the current five-tab navigation. Detail pages belong behind More or inside a task flow, not as additional tabs.
7. For lists that may exceed 20 rows, use a virtualized list plus filters rather than a single growing ScrollView.
8. Keep destructive actions separated from the primary action and require confirmation when the effect is not reversible.

## Device QA checklist

Before release, run the following matrix on physical devices or emulators:

- 320, 390, and 430 px widths;
- iOS and Android;
- light and dark themes;
- default, 130%, and maximum accessibility font sizes;
- keyboard open on every form step;
- empty, loading, error, short-list, and long-list data states;
- Organizer sessions with 1, 4, 6, and 12 courts;
- Player and Organizer workspace switching while a session is live.

Pass conditions:

- no clipped text or overlapping controls;
- no independent tap target below 44 × 44 px;
- primary action visible without ambiguity;
- no raw validation error after a user chooses a provided preset;
- back behavior returns to the previous context and never changes workspace;
- screen reader announces role, state, and useful label for every control.

## Validation completed

- Android Expo production export completed successfully after the changes.
- TypeScript parsing reached only the existing Deno edge-function environment errors; no app UI TypeScript error was reported.
- The web target could not be used because this Expo project intentionally excludes `web` in `app.json`; final pixel-level QA should therefore use iOS/Android simulators or physical devices.
- Native simulator services were not available inside the workspace sandbox, so the device QA matrix above remains a release check rather than a claimed visual pass.
