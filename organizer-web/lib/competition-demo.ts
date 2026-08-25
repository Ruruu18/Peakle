import type {
  Competition,
  CompetitionBracketMatch,
  CompetitionDivision,
  CompetitionEntry,
} from "./types";

export const DEMO_COMPETITION_ID = "demo-peakle-cup-2026";

export const competitionDemoEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_COMPETITION_DEMO === "true";

// Deterministic, realistic-looking placeholder faces so the demo bracket
// reads the same as it will once real player avatar_url values are present.
const demoAvatarUrl = (divisionId: string, seed: number) =>
  `https://i.pravatar.cc/128?img=${((divisionId.length + seed * 7) % 70) + 1}`;

const entry = (
  divisionId: string,
  seed: number,
  displayName: string,
): CompetitionEntry => ({
  id: `${divisionId}-entry-${seed}`,
  competition_id: DEMO_COMPETITION_ID,
  competition_division_id: divisionId,
  user_id: `${divisionId}-player-${seed}`,
  seed,
  status: "active",
  eligibility_status: "eligible",
  profiles: {
    display_name: displayName,
    avatar_url: demoAvatarUrl(divisionId, seed),
  },
});

type DemoMatchOptions = {
  round: number;
  position: number;
  homeSeed?: number;
  awaySeed?: number;
  winnerSeed?: number;
  status: string;
  score?: [number, number];
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
};

const bracketMatch = (
  divisionId: string,
  options: DemoMatchOptions,
): CompetitionBracketMatch => {
  const matchId = `${divisionId}-r${options.round}-m${options.position}`;
  const entryId = (seed?: number) =>
    seed ? `${divisionId}-entry-${seed}` : null;
  const hasMatch = Boolean(
    options.score || options.startedAt || options.endedAt,
  );

  return {
    id: matchId,
    competition_id: DEMO_COMPETITION_ID,
    competition_division_id: divisionId,
    round_number: options.round,
    position: options.position,
    home_entry_id: entryId(options.homeSeed),
    away_entry_id: entryId(options.awaySeed),
    winner_entry_id: entryId(options.winnerSeed),
    match_id: hasMatch ? `${matchId}-score` : null,
    status: options.status,
    scheduled_at: options.scheduledAt || null,
    matches: hasMatch
      ? {
          id: `${matchId}-score`,
          status: options.status,
          scheduled_at: options.scheduledAt || null,
          started_at: options.startedAt || null,
          ended_at: options.endedAt || null,
          match_games: options.score
            ? [
                {
                  id: `${matchId}-game-1`,
                  game_number: 1,
                  home_score: options.score[0],
                  away_score: options.score[1],
                  winner_side:
                    options.score[0] === options.score[1]
                      ? null
                      : options.score[0] > options.score[1]
                        ? 1
                        : 2,
                },
              ]
            : [],
        }
      : null,
  };
};

const openDivisionId = "demo-open-division";
const openEntries = [
  "Mika Santos",
  "Paolo Reyes",
  "Bea Navarro",
  "Luis Mendoza",
  "Sam Cruz",
  "Nico Garcia",
  "Aya Villanueva",
  "Marco Lim",
].map((name, index) => entry(openDivisionId, index + 1, name));

const openDivision: CompetitionDivision = {
  id: openDivisionId,
  competition_id: DEMO_COMPETITION_ID,
  name: "Open Singles",
  participant_division: "open",
  format: "singles",
  skill_category: "open",
  entry_type: "player",
  capacity: 8,
  status: "active",
  position: 1,
  competition_entries: openEntries,
  competition_bracket_matches: [
    bracketMatch(openDivisionId, {
      round: 1,
      position: 1,
      homeSeed: 1,
      awaySeed: 8,
      winnerSeed: 1,
      status: "completed",
      score: [11, 4],
      scheduledAt: "2026-08-10T01:00:00.000Z",
      startedAt: "2026-08-10T01:03:00.000Z",
      endedAt: "2026-08-10T01:19:00.000Z",
    }),
    bracketMatch(openDivisionId, {
      round: 1,
      position: 2,
      homeSeed: 4,
      awaySeed: 5,
      winnerSeed: 5,
      status: "completed",
      score: [9, 11],
      scheduledAt: "2026-08-10T01:00:00.000Z",
      startedAt: "2026-08-10T01:05:00.000Z",
      endedAt: "2026-08-10T01:24:00.000Z",
    }),
    bracketMatch(openDivisionId, {
      round: 1,
      position: 3,
      homeSeed: 2,
      awaySeed: 7,
      status: "live",
      score: [7, 5],
      scheduledAt: "2026-08-10T01:30:00.000Z",
      startedAt: "2026-08-10T01:32:00.000Z",
    }),
    bracketMatch(openDivisionId, {
      round: 1,
      position: 4,
      homeSeed: 3,
      awaySeed: 6,
      status: "ready",
      scheduledAt: "2026-08-10T01:30:00.000Z",
    }),
    bracketMatch(openDivisionId, {
      round: 2,
      position: 1,
      homeSeed: 1,
      awaySeed: 5,
      status: "ready",
      scheduledAt: "2026-08-10T02:15:00.000Z",
    }),
    bracketMatch(openDivisionId, {
      round: 2,
      position: 2,
      status: "pending",
      scheduledAt: "2026-08-10T02:15:00.000Z",
    }),
    bracketMatch(openDivisionId, {
      round: 3,
      position: 1,
      status: "pending",
      scheduledAt: "2026-08-10T03:00:00.000Z",
    }),
  ],
};

const mixedDivisionId = "demo-mixed-division";
const mixedEntries = [
  "Team Dink Dynasty",
  "Team Kitchen Crew",
  "Team Paddle Pop",
  "Team Court Kings",
].map((name, index) => ({
  ...entry(mixedDivisionId, index + 1, name),
  user_id: null,
  team_id: `${mixedDivisionId}-team-${index + 1}`,
  profiles: null,
  teams: { name, tag: `T${index + 1}` },
}));

const mixedDivision: CompetitionDivision = {
  id: mixedDivisionId,
  competition_id: DEMO_COMPETITION_ID,
  name: "Mixed Doubles 3.5",
  participant_division: "mixed",
  format: "doubles",
  skill_category: "3.5",
  entry_type: "team",
  capacity: 4,
  status: "active",
  position: 2,
  competition_entries: mixedEntries,
  competition_bracket_matches: [
    bracketMatch(mixedDivisionId, {
      round: 1,
      position: 1,
      homeSeed: 1,
      awaySeed: 4,
      winnerSeed: 1,
      status: "completed",
      score: [11, 6],
      scheduledAt: "2026-08-10T00:30:00.000Z",
      startedAt: "2026-08-10T00:34:00.000Z",
      endedAt: "2026-08-10T00:51:00.000Z",
    }),
    bracketMatch(mixedDivisionId, {
      round: 1,
      position: 2,
      homeSeed: 2,
      awaySeed: 3,
      winnerSeed: 3,
      status: "completed",
      score: [8, 11],
      scheduledAt: "2026-08-10T00:30:00.000Z",
      startedAt: "2026-08-10T00:36:00.000Z",
      endedAt: "2026-08-10T00:56:00.000Z",
    }),
    bracketMatch(mixedDivisionId, {
      round: 2,
      position: 1,
      homeSeed: 1,
      awaySeed: 3,
      status: "ready",
      scheduledAt: "2026-08-10T01:45:00.000Z",
    }),
  ],
};

export const demoCompetitionDivisions: CompetitionDivision[] = [
  openDivision,
  mixedDivision,
];

export function makeDemoCompetition(venueId?: string | null): Competition {
  return {
    id: DEMO_COMPETITION_ID,
    venue_id: venueId || "demo-venue",
    name: "Peakle Summer Smash · Demo",
    kind: "tournament",
    starts_on: "2026-08-10",
    status: "active",
    competition_divisions: demoCompetitionDivisions,
  };
}
