# Competition Divisions — Future Update Possibilities

**Status:** Proposed  
**Recommended release:** Next dedicated competition update  
**Current priority:** Stabilize mixed-format open play and skill categories

## Purpose

PEAKLE already supports competition records for leagues, ladders, seasons, and tournaments. Players or teams can register, organizers can view entries, standings can be recorded, and tournament brackets can be seeded.

The current competition model does not yet separate entries, standings, capacity, or brackets into professional divisions. Adding only a division picker would be incomplete because every downstream competition operation must understand the selected division.

## Current capabilities

- League, ladder, season, and tournament competition types
- Singles or doubles competition format
- Individual or team entries
- Competition capacity
- Registration and active statuses
- Standings data
- Tournament bracket seeding
- Public or restricted visibility
- Venue-linked organizer management

## Current limitations

- One format applies to the entire competition.
- All entries share one capacity.
- All entries share one standings table.
- A tournament produces one bracket.
- Competitions do not have skill divisions.
- Competitions do not have Open, Women’s, Men’s, or Mixed divisions.
- Venue program skill divisions are separate from competition divisions.

## Recommended division model

Keep these concepts separate:

### Competition type

- League
- Ladder
- Season
- Tournament

### Match format

- Singles
- Doubles

### Skill category

- Open level — any rating
- Novice — 1.0–2.5
- Intermediate — 2.6–3.9
- Advanced — 4.0–5.5

### Participant division

- Open
- Women’s
- Men’s
- Mixed

Participant division should be optional. Open should remain the default.

## Recommended organizer experience

Competition setup should remain a short guided flow:

1. Enter competition name, venue, dates, and type.
2. Add one or more divisions.
3. For each division, choose format, skill category, capacity, and entry type.
4. Review all divisions before publishing.

The first division should be created automatically with professional defaults:

- Open participant division
- Doubles format
- Open skill level
- Existing competition capacity

Organizers should only add more divisions when needed. A simple competition should not require additional configuration.

Example:

| Division name | Participant division | Format | Skill | Capacity |
|---|---|---|---|---:|
| Novice Doubles | Open | Doubles | Novice | 16 teams |
| Women’s Intermediate | Women’s | Doubles | Intermediate | 12 teams |
| Open Advanced Singles | Open | Singles | Advanced | 24 players |

## Player experience

Players should see available divisions before registering.

Each division should display:

- Division name
- Singles or doubles
- Skill category and rating range
- Individual or team entry
- Available spots
- Registration status
- Eligibility explanation

PEAKLE should recommend eligible divisions using the player’s earned rating. Unrated players may enter Open divisions or request organizer review, depending on competition rules.

Player profile gender information should not be mandatory for ordinary PEAKLE use. If a competition uses a restricted participant division, eligibility information should be requested privately and only for that event.

## Database direction

Add a child table instead of adding several division columns directly to `competitions`.

Suggested structure:

```sql
competition_divisions
  id
  competition_id
  name
  participant_division
  format
  skill_category
  skill_min
  skill_max
  entry_type
  capacity
  status
  created_at
  updated_at
```

Related records should reference `competition_division_id`:

- Competition entries
- Competition bracket matches
- Competition matches
- Standings and results

This permits one competition event to contain multiple independent divisions without duplicating the parent competition’s venue, dates, organizer, or branding.

## Required server rules

- Every entry belongs to exactly one division.
- Entry type must match the division: player or team.
- Singles divisions accept individual entries.
- Doubles divisions may accept teams or validated pairs.
- Capacity is enforced separately for each division.
- A player or team cannot create duplicate entries in the same division.
- Skill eligibility uses the saved rating at registration time and records the decision.
- Standings are calculated separately per division.
- Bracket seeding is executed separately per tournament division.
- Results cannot update a different division’s bracket or standings.
- Organizer permissions apply through the parent competition.

## Update possibilities

### Option A — Essential divisions

Recommended first release:

- Multiple divisions per competition
- Open participant division only
- Singles and doubles formats
- Novice, Intermediate, Advanced, and Open skill categories
- Separate capacity, registration, standings, and brackets

This provides the strongest immediate value with the lowest privacy and eligibility complexity.

### Option B — Full participant divisions

Add after Option A is stable:

- Women’s
- Men’s
- Mixed
- Private event-specific eligibility
- Organizer review for eligibility exceptions

### Option C — Advanced competition operations

Possible later enhancements:

- Age divisions
- Junior and senior divisions
- DUPR or external-rating verification
- Rating snapshots and rating-lock dates
- Qualifying rounds
- Pools followed by elimination brackets
- Round-robin scheduling
- Waitlists per division
- Division transfers before registration closes
- Division merging when registration is low
- Automated seeds
- Court and match scheduling
- Referee assignments
- Medals, awards, and downloadable results
- Division-specific fees and refund rules

## Recommended delivery phases

### Phase 1 — Data foundation

- Add `competition_divisions`.
- Backfill every existing competition with one default division.
- Link entries, matches, brackets, and standings to a division.
- Preserve current competitions during migration.

### Phase 2 — Organizer setup

- Add the division builder.
- Provide automatic defaults.
- Add review and validation.
- Prevent publishing invalid divisions.

### Phase 3 — Player registration

- Show divisions on competition details.
- Add eligibility messages.
- Register the player or team into one division.
- Enforce division capacity.

### Phase 4 — Operations

- Seed brackets per division.
- Maintain standings per division.
- Record results against the correct division.
- Add organizer division filters.

### Phase 5 — Participant divisions

- Add Women’s, Men’s, and Mixed divisions.
- Add private event-specific eligibility.
- Add organizer review and audit records.

## Launch criteria

Competition divisions are ready for public release when:

- Existing competitions migrate without losing entries or standings.
- A competition can contain at least two divisions.
- Each division independently enforces format, skill, capacity, and entry type.
- Players cannot register in an ineligible division without organizer review.
- Tournament brackets seed independently per division.
- Results update only the correct division.
- Organizer and player screens clearly show the division.
- Realtime updates work for entries, standings, and brackets.
- Dark mode, accessibility labels, and small-screen layouts pass review.
- Database permission and concurrency tests pass.

## Recommendation

Do not add partial competition divisions to the mixed-open-play release.

Complete mixed open play and skill categories first. Then deliver **Option A — Essential divisions** as the next competition update. Add gender-based participant divisions only after the core multi-division data model, registration, standings, and brackets are stable.
