# Organizer Pass: demo behavior and production plan

## Product rule

Every authenticated account begins as a verified player. Organizer mode is a paid capability layered onto the same account; it is not a separate identity or a venue-ownership grant.

- Player mode is always available.
- The locked Organizer option in the player profile switch is the primary Organizer Pass entry point.
- Organizer mode stays locked until Organizer Pass access is active.
- An active subscriber can move between Player and Organizer modes at any time.
- The avatar corner is reserved for presence: green for Active/free, amber for Away, and blue for In play.
- Account tiers use one restrained badge system beside the name: warm gold for `PLUS`, cool silver for `PRO`, and deep red for `ADMIN`. The badges share the same dimensions, border weight, typography, and flat tinted treatment without animation or decorative effects.
- Venue management still requires an explicit `venue_members` role, independently of Organizer Pass.

## Demo implementation

The current purchase flow is a server-backed payment sandbox. It never contacts Apple, Google, a bank, or a payment processor. Supabase owns the entitlement record and row-level security requires current access before a new open-play session can be inserted.

`src/services/organizerPass.js` maps the simulated subscription lifecycle to protected Supabase RPCs:

- `loadOrganizerPass(userId)` loads the account-scoped server entitlement.
- `activateDemoOrganizerPass(userId, planId)` creates a monthly or annual demo entitlement.
- `cancelDemoOrganizerPass(userId)` turns off renewal while retaining access through the period end.
- `expireDemoOrganizerPass(userId)` expires access immediately.
- `refreshOrganizerPass(userId)` verifies that a fresh install recovers account access from the server.
- `restoreDemoOrganizerPass(userId)` restores a still-valid server demo entitlement.

`OrganizerPassProvider` converts that state into the single capability check used by the app: `hasOrganizerAccess`.

Tier identity is separate from billing duration. `passTier` is `plus`, `pro`, `admin`, or `null`, while `hasPassCapability(name)` gates tier-specific tools. Plus currently includes the organizer workspace, unlimited sessions, and history. Pro is prepared for staff access, advanced analytics, and report exports. Venue authorization remains a separate permission check.

## Entitlement state model

| State | Player mode | Organizer toggle | New sessions | Existing session |
| --- | --- | --- | --- | --- |
| `preview` | Available | Locked | Blocked | Preserved |
| `active` | Available | Unlocked | Allowed | Allowed |
| `active`, renewal canceled | Available | Unlocked until period end | Allowed until period end | Allowed |
| `expired` | Available | Locked | Blocked | Preserved for recovery/history |
| platform administrator | Available | Unlocked | Allowed | Allowed |

If access expires while Organizer mode is active, the app returns the account to Player mode and updates the saved workspace preference.

## User journey

1. The player sees the Organizer option locked inside the Player/Organizer mode switch.
2. Pressing the locked Organizer option opens the plan screen.
3. The player chooses Monthly or Annual and confirms the simulated checkout.
4. The server entitlement becomes active; no money is collected.
5. The player switches to Organizer mode while the subscription tier badge remains visible beside the name.
6. The demo controls can test cancellation, expiration, reinstall, and restoration.

## Production migration

The UI and capability boundary can remain, but local storage must not be trusted for real purchases. Before accepting money:

1. Replace mock activation with Apple In-App Purchase and Google Play Billing products.
2. Replace the demo activation/cancellation/expiration RPCs with backend-only store verification and App Store/Play subscription notifications.
3. Populate the existing server-owned entitlement table only from verified provider events.
4. Retain the existing database policy that enforces entitlement when creating organizer sessions.
5. Retain active-session recovery and completed history after expiration; only creation of new paid work should be blocked.
6. Add grace-period and billing-retry states.
7. Add purchase terms, renewal price, restore purchases, manage subscription, privacy policy, and terms links.
8. Remove the demo lifecycle controls from production builds.

## Launch measurement

Track the funnel without storing payment details:

- Player profile viewed
- Organizer Pass opened
- Plan selected
- Checkout started
- Subscription activated
- Organizer mode entered
- First session created
- First session completed
- Subscription canceled or expired

The primary validation metric is not checkout conversion alone. It is the percentage of activated organizers who complete a live session and return to host another one.
