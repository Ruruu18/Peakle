import type { OrganizerData, OpenPlaySession, Registration } from "./types";

export const openPlayDemoEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_OPEN_PLAY_DEMO === "true";

const SESSION_ONE = "demo-open-play-night";
const SESSION_TWO = "demo-open-play-rookies";

const player = (
  sessionId: string,
  number: number,
  name: string,
  status: "playing" | "waiting",
  queuePosition?: number,
): Registration => ({
  id: `${sessionId}-player-${number}`,
  session_id: sessionId,
  user_id: `${sessionId}-user-${number}`,
  registration_status: "approved",
  status,
  games_played: status === "playing" ? 2 : 1,
  queue_position: queuePosition ?? null,
  joined_at: "2026-08-10T07:10:00.000Z",
  waiting_since: status === "waiting" ? `2026-08-10T07:${40 + number}:00.000Z` : null,
  checked_in_at: "2026-08-10T07:25:00.000Z",
  profiles: {
    display_name: name,
    avatar_url: null,
    skill_rating: 3.1 + number / 10,
  },
});

const lineupPlayer = (registration: Registration, side: number, position: number) => ({
  player_id: registration.id,
  side,
  position,
  open_play_players: {
    id: registration.id,
    guest_name: registration.guest_name,
    profiles: registration.profiles,
  },
});

const sessions: OpenPlaySession[] = [
  {
    id: SESSION_ONE,
    name: "Monday Night Open Play · Demo",
    status: "active",
    session_code: "DEMO01",
    scheduled_start: "2026-08-10T07:30:00.000Z",
    scheduled_end: "2026-08-10T10:30:00.000Z",
    live_started_at: "2026-08-10T07:31:00.000Z",
    capacity: 20,
    court_count: 4,
    visibility: "public",
    match_format: "doubles",
    fee_amount: 250,
    player_count: 8,
    registered_count: 8,
    is_demo: true,
  },
  {
    id: SESSION_TWO,
    name: "Rookie Rotation · Demo",
    status: "active",
    session_code: "DEMO02",
    scheduled_start: "2026-08-10T08:00:00.000Z",
    scheduled_end: "2026-08-10T10:00:00.000Z",
    live_started_at: "2026-08-10T08:01:00.000Z",
    capacity: 12,
    court_count: 2,
    visibility: "public",
    match_format: "singles",
    fee_amount: 150,
    player_count: 6,
    registered_count: 6,
    is_demo: true,
  },
];

const registrations: Registration[] = [
  player(SESSION_ONE, 1, "Ari Flores", "playing"),
  player(SESSION_ONE, 2, "CJ Ramos", "playing"),
  player(SESSION_ONE, 3, "Kim Dela Cruz", "playing"),
  player(SESSION_ONE, 4, "Jo Tan", "playing"),
  player(SESSION_ONE, 5, "Pat Rivera", "waiting", 0),
  player(SESSION_ONE, 6, "Max Lee", "waiting", 1),
  player(SESSION_ONE, 7, "Rina Co", "waiting", 2),
  player(SESSION_ONE, 8, "Theo Yu", "waiting", 3),
  player(SESSION_TWO, 1, "Elle Bautista", "playing"),
  player(SESSION_TWO, 2, "Ian Sy", "playing"),
  player(SESSION_TWO, 3, "Mae Chua", "waiting", 0),
  player(SESSION_TWO, 4, "Ken Ong", "waiting", 1),
  player(SESSION_TWO, 5, "Gia Torres", "waiting", 2),
  player(SESSION_TWO, 6, "Leo Go", "waiting", 3),
];

const byId = new Map(registrations.map((registration) => [registration.id, registration]));

const liveCourts: OrganizerData["liveCourts"] = [
  {
    id: `${SESSION_ONE}-court-1`,
    session_id: SESSION_ONE,
    court_number: 1,
    match_format: "doubles",
    venue_court: { name: "Center Court" },
    open_play_matches: [{
      id: `${SESSION_ONE}-match-1`,
      status: "live",
      home_score: 8,
      away_score: 6,
      started_at: "2026-08-10T07:55:00.000Z",
      scorer_player_id: `${SESSION_ONE}-player-1`,
      open_play_match_players: [
        lineupPlayer(byId.get(`${SESSION_ONE}-player-1`)!, 0, 0),
        lineupPlayer(byId.get(`${SESSION_ONE}-player-2`)!, 0, 1),
        lineupPlayer(byId.get(`${SESSION_ONE}-player-3`)!, 1, 0),
        lineupPlayer(byId.get(`${SESSION_ONE}-player-4`)!, 1, 1),
      ],
    }],
  },
  { id: `${SESSION_ONE}-court-2`, session_id: SESSION_ONE, court_number: 2, match_format: "doubles", venue_court: { name: "Garden Court" }, open_play_matches: [] },
  { id: `${SESSION_ONE}-court-3`, session_id: SESSION_ONE, court_number: 3, match_format: "doubles", venue_court: { name: "North Court" }, open_play_matches: [] },
  { id: `${SESSION_ONE}-court-4`, session_id: SESSION_ONE, court_number: 4, match_format: "singles", venue_court: { name: "Challenge Court" }, open_play_matches: [] },
  {
    id: `${SESSION_TWO}-court-1`,
    session_id: SESSION_TWO,
    court_number: 1,
    match_format: "singles",
    venue_court: { name: "Rookie Court A" },
    open_play_matches: [{
      id: `${SESSION_TWO}-match-1`,
      status: "live",
      home_score: 5,
      away_score: 3,
      started_at: "2026-08-10T08:04:00.000Z",
      scorer_player_id: `${SESSION_TWO}-player-1`,
      open_play_match_players: [
        lineupPlayer(byId.get(`${SESSION_TWO}-player-1`)!, 0, 0),
        lineupPlayer(byId.get(`${SESSION_TWO}-player-2`)!, 1, 0),
      ],
    }],
  },
  { id: `${SESSION_TWO}-court-2`, session_id: SESSION_TWO, court_number: 2, match_format: "singles", venue_court: { name: "Rookie Court B" }, open_play_matches: [] },
];

export function withDemoOpenPlay(data: OrganizerData, venueId?: string | null): OrganizerData {
  if (!openPlayDemoEnabled) return data;
  const demoSessions = sessions.map((session) => ({ ...session, venue_id: venueId || "demo-venue" }));
  return {
    ...data,
    sessions: [...demoSessions, ...data.sessions],
    registrations: [...registrations, ...data.registrations],
    liveCourts: [...liveCourts, ...data.liveCourts],
  };
}
