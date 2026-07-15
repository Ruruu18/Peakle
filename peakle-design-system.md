# Peakle
### Design System & Product Specification — Pickleball App
*Prepared as a UI/UX design deliverable · v1.0*

---

## 0. How to use this document

This is a complete, build-ready design spec: brand direction, visual foundations, component library, information architecture, and full screen-by-screen breakdowns for **Book · Play · Compete · Profile**. Everything here is written so it can be handed to a developer, a Figma file, or another AI build tool and produce a consistent, non-generic result — not just "a pickleball app," but *Peakle* specifically.

---

## 1. Positioning

**Peakle** is a court-side app for players who take their game seriously, without turning it into a spreadsheet. It's where you book the court, keep score live, track how you're actually improving, and run your squad.

**One-line brief:** *The rating and rivalry engine for competitive rec pickleball.*

**Audience:** Players who've moved past "just for fun" — they know their rating, they track their win rate, they have a regular four, and they care who's actually better.

| Peakle is | Peakle is not |
|---|---|
| Court-side and glanceable | A dense analytics dashboard |
| Confident and a little competitive | Cute, cartoonish, or "fun app" generic |
| Built around real sport vocabulary — kitchen, dink, rally | Built around generic "sports app" clichés (trophies, confetti, podiums) |
| Warm and grounded (paper, ink, chalk lines) | Cold SaaS-blue or neon-on-black gamer aesthetic |
| Precise with numbers | Decorative with numbers |

**Voice in three words:** direct, dry-witted, respectful of effort.

---

## 2. Design Principles

Six rules specific to this product — not a generic style guide:

1. **Legible from the baseline.** Score and rating numerals must read from six feet away, court-side, in direct sun. If you have to ask "is this big enough," it isn't.
2. **One accent, one moment.** Optic (the ball-yellow) is reserved for exactly one live/active signal on screen at a time — the serving side, the primary CTA. Never decorative.
3. **The kitchen line divides, always.** Every structural divider — section breaks, timelines, progress steps — uses the same double-line motif (see §3.5). One recurring device, not a new decoration each time.
4. **Paddle-shaped, not phone-shaped.** Primary content cards use the signature asymmetric radius (§3.4), never a default uniform rounded rectangle.
5. **Numbers earn their own voice.** Anything counted — score, rating, streak, win rate — is set in Space Grotesk tabular figures. Body copy never carries a stat.
6. **Losses are not alarms.** Result and error states use dignified, muted tones. Red is reserved for destructive actions only (cancel, leave, delete) — never for "you lost."

---

## 3. Visual Foundations

### 3.1 Color

Grounded in the actual materials of the sport: chalk court lines, court paint, the optic-yellow ball, hard-court brick red.

| Token | Hex (Light) | Hex (Dark) | Usage |
|---|---|---|---|
| `peakle-ink` | `#0E2321` | `#EFF3ED` | Primary text, primary dark surfaces |
| `peakle-paper` | `#F3F5EF` | `#0B1613` | App background — a green-tinted chalk, not cream |
| `peakle-surface` | `#FFFFFF` | `#142420` | Card / sheet surfaces |
| `peakle-optic` | `#D6E94A` | `#D6E94A` | **Sole hero accent** — primary CTA, live indicator, serve marker |
| `peakle-teal` | `#1C6B66` | `#2E8A83` | Informational — booking, location, links, "win" state |
| `peakle-brick` | `#B6472E` | `#C85B3E` | Energy — streaks, challenges, ranked badges (never used for errors) |
| `peakle-error` | `#A63B2B` | `#C24A38` | Destructive actions only — cancel, leave squad, delete |
| `peakle-ink-70` | `#3C4A45` | `#C4CDC7` | Secondary text |
| `peakle-ink-40` | `#7C8983` | `#8B978F` | Tertiary text, placeholders, loss state |
| `peakle-line` | `#DDE3DA` | `#243530` | Borders, dividers, input outlines |

**Rule of thumb:** paper + ink carries 90% of every screen. Teal is the "informational" workhorse. Optic appears once per screen, maximum. Brick is earned (streaks, ranked), not ambient. Never pair optic directly on optic, or let two accents touch without ink/paper between them.

### 3.2 Typography

Three roles, each with a real functional job — not decoration:

| Role | Typeface | Weight | Why |
|---|---|---|---|
| Display / Headlines | **General Sans** | Semibold / Medium | Confident, geometric, distinct from default Inter |
| Body / UI | **Satoshi** | Regular / Medium | Clean humanist grotesk, quiet at small sizes |
| Numerals / Stats / Scores | **Space Grotesk** | Medium / Bold, tabular-nums | Distinct "scoreboard" character for anything counted |

**Type scale**

| Style | Face | Size / Line-height | Usage |
|---|---|---|---|
| Score Display | Space Grotesk Bold | 96 / 96, tabular | Live scoring numerals |
| Stat Display | Space Grotesk Bold | 34 / 38, tabular | Rating, win rate, big stat cards |
| H1 | General Sans Semibold | 32 / 38 | Screen titles |
| H2 | General Sans Semibold | 24 / 30 | Section headers |
| H3 | General Sans Medium | 18 / 24 | Card titles |
| Body | Satoshi Regular | 15 / 22 | Default copy |
| Body Small | Satoshi Regular | 13 / 18 | Secondary copy, meta |
| Label / Overline | Satoshi Medium | 12 / 16, +0.04em, uppercase | Eyebrows, section labels |
| Button | Satoshi Medium | 15 / 20 | All button text |

### 3.3 Spacing & Grid

Base unit **4px**. Scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.
Screen margin: 20px. Card internal padding: 16–20px. Gap between stacked cards: 12px.
12-column grid on tablet/desktop companion views; single-column stack on mobile (390px reference width).

### 3.4 Radius & Elevation

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 8px | Chips, inputs, small badges |
| `radius-md` | 14px | Buttons, secondary cards |
| `radius-lg` | 20px | Standard cards, sheets |
| **`radius-paddle`** | **24 / 24 / 10 / 10** (TL/TR/BL/BR) | **Signature card shape** — court cards, match cards, squad cards. Face rounds like a paddle face, base tapers like the throat. |

Shadows are ink-tinted, never pure black:

```
shadow-sm: 0 1px 2px rgba(14, 35, 33, 0.06)
shadow-md: 0 4px 12px rgba(14, 35, 33, 0.08)
shadow-lg: 0 12px 32px rgba(14, 35, 33, 0.12)
```

The Live Scoring screen is the one exception: **flat, no shadow**, full-bleed color blocking for glare readability outdoors.

### 3.5 The Kitchen Line — signature motif

The product's one recurring structural device, drawn from the sport's own most iconic line (the non-volley-zone boundary):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
```
2px solid `peakle-ink` (or `peakle-line` at low emphasis) with a 1px dashed rule 4px beneath it. Used for: section dividers, the spine of match-history and rating timelines, the active-tab indicator in bottom nav, and the divider between the two sides of the live scoreboard. It never appears more than once per screen region — it marks the one meaningful boundary, not every boundary.

Secondary, quieter motif: a sparse dot pattern (echoing the ball's dimples) used only in empty states, at 4–6% opacity — never as a loud background texture.

### 3.6 Iconography

Custom line icon set, 2px stroke, rounded caps, 24px grid. Sport-specific icons drawn rather than borrowed from a generic set: paddle, dink, kitchen zone, serve arc, rally. Generic UI icons (search, bell, settings) stay in the same stroke weight for consistency.

### 3.7 Motion

Restrained by design — one orchestrated moment, not ambient animation everywhere.

- **Ball-bounce easing** `cubic-bezier(0.34, 1.56, 0.64, 1)` — used *only* for score increments on the Live Scoring screen and the splash-screen mark. Fast down, elastic settle, like a ball landing.
- Page transitions: simple 200ms slide/fade. No parallax, no bounce-everywhere.
- `prefers-reduced-motion` disables the bounce easing in favor of a plain 100ms fade.

---

## 4. Logo & App Icon

**Wordmark:** "Peakle" set in General Sans Semibold, tight tracking. The dot above the *i* is replaced by a small dimpled ball glyph in `peakle-optic`.

**App icon:** an abstract paddle face on `peakle-ink`, with a single kitchen-line stroke crossing the lower third in `peakle-optic` — reads as a mark even at 40px, and ties directly to the signature motif above rather than being an unrelated logomark.

**Squad crests:** users build a simple crest from a fixed set of shapes (shield / roundel / paddle-face) + one accent color + one icon — not freeform generative art, so the squad list stays visually consistent.

---

## 5. Component Library

| Component | Anatomy | States | Notes |
|---|---|---|---|
| **Button — Primary** | Fill `peakle-ink`, text `peakle-paper`, `radius-md` | default / pressed (scale 0.98) / disabled (40% opacity) | Reserved for one per screen |
| **Button — Accent** | Fill `peakle-optic`, text `peakle-ink` | same | Only for the single "live" action (Start Match, Confirm Booking) |
| **Button — Ghost** | Transparent, 1px `peakle-line` border | default / pressed | Secondary actions |
| **Paddle Card** | `radius-paddle`, `shadow-sm`, 16–20px padding | default / pressed (shadow-md) | Court cards, match cards, squad cards |
| **Score Pill** | Space Grotesk numeral, `radius-sm` fill | live (optic dot pulses) / final | Compact score anywhere off the live screen |
| **Rating Badge** | Space Grotesk numeral + tier label, teal outline | — | e.g. "4.2 · Advanced" |
| **Avatar / Avatar Stack** | Circular, 2px `peakle-paper` ring when stacked | 1–4 visible + "+N" overflow | Used in match, squad, leaderboard rows |
| **Chip / Tag** | `radius-sm`, ink-10% fill | selected (optic outline) / default | Filters, skill level, court type |
| **Segmented Control** | Ink text, kitchen-line as active indicator | — | Leaderboard scope, format toggle |
| **Bottom Nav** | 5 items, center item elevated +8px in an optic-ringed circle | active (ink fill + kitchen-line tick above) / inactive (ink-40) | See §6 |
| **Calendar / Date Strip** | Horizontal scroller, selected date = ink pill | — | Booking flow |
| **Time Slot Grid** | 2-col grid of ghost buttons | available / selected (optic fill) / booked (disabled, struck) | Booking flow |
| **Empty State** | Icon + H3 + one-line direction + single CTA | — | Always tells the user what to do next, never just "nothing here" |
| **Toast / Confirmation** | Slim ink bar, bottom-anchored, auto-dismiss 3s | — | "Booked. See it in Home." style — states what happened |

---

## 6. Information Architecture

Five-tab bottom navigation. The center tab is visually elevated — it's the one truly modal, in-the-moment action.

```
┌───────┬───────┬─────────┬─────────┬────────┐
│ Home  │ Book  │  ⬤PLAY  │ Compete │ Profile│
└───────┴───────┴─────────┴─────────┴────────┘
```

| Tab | Covers |
|---|---|
| **Home** | Dashboard, next-up match, weekly snapshot, activity feed |
| **Book** | Court discovery, court detail, booking flow |
| **Play** *(elevated center)* | Match setup, live scoring, match summary |
| **Compete** | Leaderboards, Squad hub, squad challenges |
| **Profile** | Player stats, rating history, achievements, match history, settings, notifications |

Note: "clan / team group" and "squad" are the same underlying feature by design — consolidated under **Compete → Squad** rather than split into two, so the app doesn't ask a player to maintain two overlapping identities.

---

## 7. Screens

### 7.0 Onboarding & Auth
- **Splash** — ink background, wordmark center-set, kitchen-line draws on, ball-dot settles with the bounce easing. One-time only.
- **Skill Intake** — three short questions (years playing, self-rated 2.0–8.0 skill slider, singles/doubles preference) to seed an initial rating. Copy: *"Rate yourself. We'll refine it after your first few matches."*
- **Permissions** — location and notifications requested in plain terms tied to a benefit: *"Find courts near you"* / *"Know when your squad challenges you"* — never generic OS-style permission text.

---

### 7.1 Home — Dashboard

```
┌─────────────────────────────┐
│ Good morning, Julian    🔔  │
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │  ← kitchen line
│  NEXT UP                    │
│ ┌─────────────────────────┐ │
│ │ Sport Court of USA       │ │  ← paddle card
│ │ Today · 6:00 PM          │ │
│ │ vs. Team Rivera  02:14:00│ │
│ └─────────────────────────┘ │
│ [Book Court][Start Live][Find Players]
│  THIS WEEK                  │
│  Win rate 78%   Rating 4.3 ↗│
│  NEARBY COURTS      See all →│
│  [ ][ ][ ]                  │
│  ACTIVITY                   │
│  · Mia beat you, rating -0.1│
│  · Dink Dynasty +1 this wk  │
└─────────────────────────────┘
```

- **Key components:** Paddle Card (next-up), three quick-action buttons (one ink, one optic — Start Live gets the accent since it's the one live moment), stat snapshot row, horizontal court scroll, activity feed with kitchen-line dividers between entries.
- **Empty state (no upcoming match):** *"Nothing on the books. Find a court or challenge your squad."* with two CTAs, not a blank illustration.

---

### 7.2 Book — Court Discovery, Detail, Booking

**Discovery:** search bar + filter chips (indoor/outdoor, lit, surface, price, distance) + map/list toggle. Court rows use the Paddle Card: photo, name, teal rating badge, distance, amenity icon row, price/hr.

**Court Detail:**
```
[ photo carousel ]
Sport Court of USA           🔖
4.5 · 32 reviews · 100 mi
Paddle & Ball · Dedicated · Lit
Description ......... Read more
[ mini map ]
──────────── Availability ────────────
 5   6   7   8   9  10  11   ← date strip, selected = ink pill
[08:00][09:00][10:00 ✕][11:00]  ← time grid, booked slots struck
┌───────────────────────────┐
│        Book Now            │ ← sticky, optic accent
└───────────────────────────┘
```

**Booking confirmation:** summary card, "Invite squad" toggle, payment summary, single Confirm CTA. **Success:** a plain check mark with the bounce easing (once) — no confetti, per Principle 6's restraint cousin: earn the moment, don't decorate it.

---

### 7.3 Play — Match Setup, Live Scoring, Summary

**Match Setup:** format (Singles/Doubles), Casual/Ranked toggle (ranked affects rating — labelled clearly, since this matters to the player), add players (search, QR invite, squad quick-add chips), scoring rules (points to win: 11/15/21, win-by-2 toggle, best-of). Big ink "Start Match" CTA, bottom-anchored.

**Live Scoring** — the signature screen. Designed to be read from six feet away, one-handed, in direct sun.

```
┌─────────────────────────────┐
│ Game 1 of 3          ⏸  ⋯   │
│ ┏━━━━━━━━━┳━━━━━━━━━┓        │
│ ┃ TEAM A  ┃  TEAM B ┃        │
│ ┃ ● serve ┃          ┃        │
│ ┃         ┃          ┃        │
│ ┃    6    ┃    4     ┃        │  ← Space Grotesk 96pt
│ ┃         ┃          ┃        │
│ ┃ Lisa/Rob┃ Mia/Sam  ┃        │
│ ┃ (tap to score) (tap)┃        │
│ ┗━━━━━━━━━┻━━━━━━━━━┛        │
│  ↩ Undo      12:04     ⏹ End │
└─────────────────────────────┘
```

- Full-bleed color block per side (ink vs. a muted teal fill), separated by a vertical kitchen-line.
- Entire team half is the tap target — no small buttons court-side.
- Serve indicator: a single small optic dot next to the serving side — the *one* accent moment on this screen.
- Score increment plays the ball-bounce scale animation once per tap.
- Undo, elapsed timer, and End Match sit in a low-emphasis footer bar — accessible but not competing with the score.
- No shadows on this screen (§3.4) — pure flat color for outdoor glare.

**Match Summary:** final score in a Paddle Card, duration, rating delta (`+0.1` in Space Grotesk with a small up-arrow), point-by-point timeline using the kitchen-line as its spine, serve-win % and rally stats, MVP tag, "Share result" (generates a static branded image), "Rematch" / "Save".

---

### 7.4 Compete — Leaderboards & Squad

**Leaderboards:** segmented control (Global / Local / Friends / Squad), filter chips (skill bracket, format, season). List rows: rank number in Space Grotesk, avatar, name, squad tag chip, rating badge, trend arrow. Top 3 get a quietly larger avatar and a thin optic underline — not a 3D podium graphic. Sticky footer shows the viewer's own rank if scrolled out of view: *"You're #47 · ↑3 this week."*

**Squad Hub:**
```
[ crest ]  Dink Dynasty
12 members · Squad rating 4.6
"We don't lose, we learn." — motto
──────────────────────────────
Roster | Stats | Activity | Challenges
```
- **Roster:** member rows with role tag (Captain/Co-captain/Member), individual rating, invite CTA.
- **Stats:** squad win/loss record, best doubles pairing ("chemistry" stat), rating trend chart with kitchen-line axis.
- **Activity:** recent squad results and rating changes, same feed pattern as Home.
- **Challenges:** challenge another squad, pending/history list.
- **Create Squad flow:** name, crest builder (shape + color + icon, not freeform art), public/invite-only privacy, initial members.

---

### 7.5 Profile — Stats, Achievements, History, Settings

```
[ avatar ]  Julian Cruz
Rating  4.3 ↗          Advanced
Squad: Dink Dynasty
──────────────────────────────
Win rate ring 78%   Matches 100   Streak 4🔥
Rating history ─────────────── (chart)
──────────────────────────────
Serve win %, favorite court, head-to-head vs.
frequent opponents, longest win streak
──────────────────────────────
ACHIEVEMENTS
[First Win][Kitchen Commander][Iron Paddle][…greyed, unearned…]
──────────────────────────────
MATCH HISTORY
vs. Mia Chen   6-4  W    Jul 9
vs. Team Ortiz 3-6  L    Jul 6      ← muted grey, not red
```

- Streak chip only appears at 3+ — not shown as "0 streak," per the principle of not decorating absence.
- Loss rows use `peakle-ink-40`, never `peakle-error` — reserved strictly for destructive actions elsewhere in the app.
- **Settings** (same tab): Account, Notification preferences, Privacy, Payment methods, Calendar sync, Rating recalibration, Help, Log out — each control named for what it does ("Turn off squad notifications," not "Configure alerts").
- **Notifications:** grouped Today / This Week / Earlier, icon-coded by type, swipe to dismiss.

---

## 8. Voice & Microcopy

Plain, active, specific. A button's label survives into its confirmation.

| Context | Peakle says | Not |
|---|---|---|
| Primary booking CTA | "Book Now" → toast: "Booked. See it in Home." | "Submit" → "Success!" |
| Empty match history | "No matches yet. Start one from Play." | "No data available" |
| Ranked toggle | "Ranked — affects your rating" | "Enable competitive mode" |
| Cancel booking | "Cancel booking" (red, confirm sheet) | "Delete" |
| Loss row | "3–6 · L" in muted grey | Red badge, exclamation icon |
| Location permission | "Find courts near you" | "Allow location access" |

---

## 9. Design Tokens — Dev Handoff

```css
:root {
  /* Color — Light */
  --peakle-ink: #0E2321;
  --peakle-paper: #F3F5EF;
  --peakle-surface: #FFFFFF;
  --peakle-optic: #D6E94A;
  --peakle-teal: #1C6B66;
  --peakle-brick: #B6472E;
  --peakle-error: #A63B2B;
  --peakle-ink-70: #3C4A45;
  --peakle-ink-40: #7C8983;
  --peakle-line: #DDE3DA;

  /* Radius */
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-paddle: 24px 24px 10px 10px;

  /* Spacing */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 24px; --space-6: 32px;
  --space-7: 48px; --space-8: 64px;

  /* Elevation */
  --shadow-sm: 0 1px 2px rgba(14, 35, 33, 0.06);
  --shadow-md: 0 4px 12px rgba(14, 35, 33, 0.08);
  --shadow-lg: 0 12px 32px rgba(14, 35, 33, 0.12);

  /* Motion */
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Type */
  --font-display: "General Sans", sans-serif;
  --font-body: "Satoshi", sans-serif;
  --font-numeral: "Space Grotesk", sans-serif;
}

[data-theme="dark"] {
  --peakle-ink: #EFF3ED;
  --peakle-paper: #0B1613;
  --peakle-surface: #142420;
  --peakle-teal: #2E8A83;
  --peakle-brick: #C85B3E;
  --peakle-error: #C24A38;
  --peakle-ink-70: #C4CDC7;
  --peakle-ink-40: #8B978F;
  --peakle-line: #243530;
}
```

```json
{
  "color": {
    "ink": { "light": "#0E2321", "dark": "#EFF3ED" },
    "paper": { "light": "#F3F5EF", "dark": "#0B1613" },
    "surface": { "light": "#FFFFFF", "dark": "#142420" },
    "optic": "#D6E94A",
    "teal": { "light": "#1C6B66", "dark": "#2E8A83" },
    "brick": { "light": "#B6472E", "dark": "#C85B3E" },
    "error": { "light": "#A63B2B", "dark": "#C24A38" }
  },
  "radius": { "sm": 8, "md": 14, "lg": 20, "paddle": [24, 24, 10, 10] },
  "spacing": [4, 8, 12, 16, 24, 32, 48, 64],
  "type": {
    "display": "General Sans",
    "body": "Satoshi",
    "numeral": "Space Grotesk"
  }
}
```

---

## 10. Accessibility

- Text/background pairs meet **WCAG AA (4.5:1)** minimum; ink-on-paper exceeds AAA.
- Minimum tap target **44×44px** — enforced especially on Live Scoring's full-half tap zones.
- Serve indicator and win/loss states never rely on color alone — always paired with an icon, label, or position.
- Dynamic type supported to at least 130% before truncation; numerals reflow before wrapping.
- `prefers-reduced-motion` removes the bounce easing app-wide, replaced with a plain fade.

---

## 11. Next Steps

This document covers brand, foundations, components, IA, and all core screens — enough to hand to a developer or a design/build tool as-is. Natural next steps, if useful:

1. **High-fidelity visual mockups** of key screens (Home, Live Scoring, Squad Hub) as actual rendered HTML/SVG.
2. **Figma-ready component specs** broken into a redline format.
3. **App icon and squad-crest builder** as a working prototype.

Let me know which of these you want next — happy to pick up from here.
