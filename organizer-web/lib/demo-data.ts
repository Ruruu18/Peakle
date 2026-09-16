import { DEMO_USER_ID } from "./demo-mode";
import type {
  Analytics,
  Booking,
  Competition,
  CompetitionBracketMatch,
  CompetitionDivision,
  CompetitionEntry,
  Court,
  Earnings,
  EarningsHistoryEntry,
  MembershipProduct,
  OpenPlaySession,
  OrganizerData,
  Program,
  ProgramRegistration,
  Registration,
  StaffMember,
  Venue,
} from "./types";

// DEMO MODE — the full sample workspace shown to anyone using the "View the
// interactive demo" entry on the organizer login screen. See demo-mode.ts
// for the list of files this feature touches; delete this file alongside
// them when the demo is retired.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hoursFromNow = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const demoAvatarUrl = (groupId: string, seed: number) => `https://i.pravatar.cc/128?img=${((groupId.length + seed * 7) % 70) + 1}`;

export const DEMO_VENUE_ID = "demo-venue-bgc";

const DEMO_COURTS: Court[] = [
  { id: "demo-court-1", venue_id: DEMO_VENUE_ID, name: "Center Court", environment: "Indoor", surface: "Standard acrylic", hourly_price: 900, owner_hourly_price: 700, active: true, image_url: null },
  { id: "demo-court-2", venue_id: DEMO_VENUE_ID, name: "Court 2", environment: "Indoor", surface: "Standard acrylic", hourly_price: 800, owner_hourly_price: 620, active: true, image_url: null },
  { id: "demo-court-3", venue_id: DEMO_VENUE_ID, name: "Court 3", environment: "Indoor", surface: "Standard acrylic", hourly_price: 800, owner_hourly_price: 620, active: true, image_url: null },
  { id: "demo-court-4", venue_id: DEMO_VENUE_ID, name: "Garden Court", environment: "Outdoor", surface: "Concrete", hourly_price: 650, owner_hourly_price: 500, active: true, image_url: null },
  { id: "demo-court-5", venue_id: DEMO_VENUE_ID, name: "Court 5", environment: "Outdoor", surface: "Concrete", hourly_price: 650, owner_hourly_price: 500, active: true, image_url: null },
  { id: "demo-court-6", venue_id: DEMO_VENUE_ID, name: "Challenge Court", environment: "Indoor", surface: "Wood", hourly_price: 950, owner_hourly_price: 750, active: false, image_url: null },
];

const DEMO_VENUE: Venue = {
  id: DEMO_VENUE_ID,
  name: "Peakle Arena BGC",
  area: "Taguig City",
  address: "30th St corner 9th Ave, Bonifacio Global City, Taguig",
  venue_type: "Indoor",
  opens_at: "06:00",
  closes_at: "23:00",
  verification_status: "verified",
  active: true,
  image_url: null,
  role: "owner",
  courts: DEMO_COURTS,
};

// ---- Open Play ----------------------------------------------------------

const SESSION_LIVE = "demo-session-live-night";
const SESSION_LIVE_ROOKIES = "demo-session-live-rookies";
const SESSION_UPCOMING_LEAGUE = "demo-session-upcoming-league";
const SESSION_UPCOMING_SOCIAL = "demo-session-upcoming-social";

const sessions: OpenPlaySession[] = [
  {
    id: SESSION_LIVE,
    venue_id: DEMO_VENUE_ID,
    name: "Friday Night Open Play",
    status: "active",
    session_code: "BGC001",
    scheduled_start: hoursAgo(1.2),
    scheduled_end: hoursFromNow(2),
    live_started_at: hoursAgo(1.1),
    capacity: 24,
    court_count: 4,
    visibility: "public",
    match_format: "doubles",
    fee_amount: 250,
    is_demo: true,
  },
  {
    id: SESSION_LIVE_ROOKIES,
    venue_id: DEMO_VENUE_ID,
    name: "Rookie Rotation",
    status: "active",
    session_code: "BGC002",
    scheduled_start: hoursAgo(0.6),
    scheduled_end: hoursFromNow(1.5),
    live_started_at: hoursAgo(0.5),
    capacity: 16,
    court_count: 2,
    visibility: "public",
    match_format: "singles",
    fee_amount: 150,
    is_demo: true,
  },
  {
    id: SESSION_UPCOMING_LEAGUE,
    venue_id: DEMO_VENUE_ID,
    name: "Wednesday Ladder League",
    status: "active",
    session_code: "BGC003",
    scheduled_start: daysFromNow(2),
    scheduled_end: new Date(new Date(daysFromNow(2)).getTime() + 3 * HOUR).toISOString(),
    live_started_at: null,
    capacity: 20,
    court_count: 3,
    visibility: "public",
    match_format: "doubles",
    fee_amount: 300,
    is_demo: true,
  },
  {
    id: SESSION_UPCOMING_SOCIAL,
    venue_id: DEMO_VENUE_ID,
    name: "Sunday Social Mixers",
    status: "active",
    session_code: "BGC004",
    scheduled_start: daysFromNow(4),
    scheduled_end: new Date(new Date(daysFromNow(4)).getTime() + 3 * HOUR).toISOString(),
    live_started_at: null,
    capacity: 24,
    court_count: 3,
    visibility: "public",
    match_format: "mixed",
    fee_amount: 200,
    is_demo: true,
  },
];

const player = (
  sessionId: string,
  number: number,
  name: string,
  status: "playing" | "waiting",
  registrationStatus: "approved" | "requested" | "waitlisted" = "approved",
  queuePosition?: number,
): Registration => ({
  id: `${sessionId}-player-${number}`,
  session_id: sessionId,
  user_id: `${sessionId}-user-${number}`,
  registration_status: registrationStatus,
  status,
  games_played: status === "playing" ? 2 : 1,
  queue_position: queuePosition ?? null,
  joined_at: hoursAgo(1.4),
  waiting_since: status === "waiting" ? hoursAgo(0.2 + number / 60) : null,
  checked_in_at: registrationStatus === "approved" ? hoursAgo(1.1) : null,
  profiles: { display_name: name, avatar_url: demoAvatarUrl(sessionId, number), skill_rating: 3 + (number % 5) / 10 },
});

const registrations: Registration[] = [
  player(SESSION_LIVE, 1, "Ari Flores", "playing"),
  player(SESSION_LIVE, 2, "CJ Ramos", "playing"),
  player(SESSION_LIVE, 3, "Kim Dela Cruz", "playing"),
  player(SESSION_LIVE, 4, "Jo Tan", "playing"),
  player(SESSION_LIVE, 5, "Pat Rivera", "waiting", "approved", 0),
  player(SESSION_LIVE, 6, "Max Lee", "waiting", "approved", 1),
  player(SESSION_LIVE, 7, "Rina Co", "waiting", "approved", 2),
  player(SESSION_LIVE, 8, "Theo Yu", "waiting", "approved", 3),
  player(SESSION_LIVE, 9, "Diane Ocampo", "waiting", "requested"),
  player(SESSION_LIVE, 10, "Marco Lim", "waiting", "requested"),
  player(SESSION_LIVE_ROOKIES, 1, "Elle Bautista", "playing"),
  player(SESSION_LIVE_ROOKIES, 2, "Ian Sy", "playing"),
  player(SESSION_LIVE_ROOKIES, 3, "Mae Chua", "waiting", "approved", 0),
  player(SESSION_LIVE_ROOKIES, 4, "Ken Ong", "waiting", "approved", 1),
  player(SESSION_LIVE_ROOKIES, 5, "Gia Torres", "waiting", "waitlisted"),
  player(SESSION_UPCOMING_LEAGUE, 1, "Sam Cruz", "waiting", "approved"),
  player(SESSION_UPCOMING_LEAGUE, 2, "Nico Garcia", "waiting", "approved"),
  player(SESSION_UPCOMING_LEAGUE, 3, "Aya Villanueva", "waiting", "requested"),
];

const sessionsWithCounts = sessions.map((session) => {
  const rows = registrations.filter((registration) => registration.session_id === session.id);
  return {
    ...session,
    player_count: rows.filter((row) => !["cancelled", "rejected"].includes(row.registration_status || "")).length,
    registered_count: rows.filter((row) => row.registration_status === "approved").length,
    requested_count: rows.filter((row) => row.registration_status === "requested").length,
    waitlisted_count: rows.filter((row) => row.registration_status === "waitlisted").length,
  };
});

const archivedSessions: OpenPlaySession[] = [
  { id: "demo-session-archived-1", venue_id: DEMO_VENUE_ID, name: "Tuesday Doubles Night", status: "completed", session_code: "BGC091", scheduled_start: daysAgo(4), scheduled_end: daysAgo(4), archived_at: daysAgo(3), capacity: 20, court_count: 3, visibility: "public", match_format: "doubles", fee_amount: 250, player_count: 18, match_count: 26 },
  { id: "demo-session-archived-2", venue_id: DEMO_VENUE_ID, name: "Weekend Singles Ladder", status: "completed", session_code: "BGC088", scheduled_start: daysAgo(9), scheduled_end: daysAgo(9), archived_at: daysAgo(8), capacity: 12, court_count: 2, visibility: "public", match_format: "singles", fee_amount: 150, player_count: 11, match_count: 19 },
  { id: "demo-session-archived-3", venue_id: DEMO_VENUE_ID, name: "Corporate Team Night", status: "cancelled", session_code: "BGC084", scheduled_start: daysAgo(15), scheduled_end: daysAgo(15), archived_at: daysAgo(15), capacity: 24, court_count: 4, visibility: "invite_only", match_format: "doubles", fee_amount: 0, player_count: 6, match_count: 2 },
];

const lineupPlayer = (registration: Registration, side: number, position: number) => ({
  player_id: registration.id,
  side,
  position,
  open_play_players: { id: registration.id, guest_name: registration.guest_name, profiles: registration.profiles },
});
const byId = new Map(registrations.map((registration) => [registration.id, registration]));

const liveCourts: OrganizerData["liveCourts"] = [
  {
    id: `${SESSION_LIVE}-court-1`, session_id: SESSION_LIVE, court_number: 1, match_format: "doubles", venue_court: { name: "Center Court" },
    open_play_matches: [{
      id: `${SESSION_LIVE}-match-1`, status: "live", home_score: 8, away_score: 6, started_at: hoursAgo(0.4), scorer_player_id: `${SESSION_LIVE}-player-1`,
      server_side: 0, serving_position: 0,
      open_play_match_players: [
        lineupPlayer(byId.get(`${SESSION_LIVE}-player-1`)!, 0, 0),
        lineupPlayer(byId.get(`${SESSION_LIVE}-player-2`)!, 0, 1),
        lineupPlayer(byId.get(`${SESSION_LIVE}-player-3`)!, 1, 0),
        lineupPlayer(byId.get(`${SESSION_LIVE}-player-4`)!, 1, 1),
      ],
    }],
  },
  { id: `${SESSION_LIVE}-court-2`, session_id: SESSION_LIVE, court_number: 2, match_format: "doubles", venue_court: { name: "Court 2" }, open_play_matches: [] },
  { id: `${SESSION_LIVE}-court-3`, session_id: SESSION_LIVE, court_number: 3, match_format: "doubles", venue_court: { name: "Court 3" }, open_play_matches: [] },
  { id: `${SESSION_LIVE}-court-4`, session_id: SESSION_LIVE, court_number: 4, match_format: "singles", venue_court: { name: "Garden Court" }, open_play_matches: [] },
  {
    id: `${SESSION_LIVE_ROOKIES}-court-1`, session_id: SESSION_LIVE_ROOKIES, court_number: 1, match_format: "singles", venue_court: { name: "Court 5" },
    open_play_matches: [{
      id: `${SESSION_LIVE_ROOKIES}-match-1`, status: "live", home_score: 5, away_score: 3, started_at: hoursAgo(0.2), scorer_player_id: `${SESSION_LIVE_ROOKIES}-player-1`,
      server_side: 0, serving_position: 0,
      open_play_match_players: [
        lineupPlayer(byId.get(`${SESSION_LIVE_ROOKIES}-player-1`)!, 0, 0),
        lineupPlayer(byId.get(`${SESSION_LIVE_ROOKIES}-player-2`)!, 1, 0),
      ],
    }],
  },
];

// ---- Staff ---------------------------------------------------------------

const staff: StaffMember[] = [
  { venue_id: DEMO_VENUE_ID, user_id: DEMO_USER_ID, role: "owner", created_at: daysAgo(240), profiles: { display_name: "Jamie Cruz", avatar_url: null } },
  { venue_id: DEMO_VENUE_ID, user_id: "demo-staff-2", role: "manager", created_at: daysAgo(200), profiles: { display_name: "Carlo Villanueva", avatar_url: null } },
  { venue_id: DEMO_VENUE_ID, user_id: "demo-staff-3", role: "front_desk", created_at: daysAgo(150), profiles: { display_name: "Bea Santos", avatar_url: null } },
  { venue_id: DEMO_VENUE_ID, user_id: "demo-staff-4", role: "court_monitor", created_at: daysAgo(90), profiles: { display_name: "Kevin Tan", avatar_url: null } },
  { venue_id: DEMO_VENUE_ID, user_id: "demo-staff-5", role: "scorer", created_at: daysAgo(60), profiles: { display_name: "Nadine Reyes", avatar_url: null } },
];

// ---- Programs --------------------------------------------------------------

const programPlayers = (programId: string, count: number, waiting = 0): ProgramRegistration[] => Array.from({ length: count + waiting }, (_, index) => ({
  program_id: programId, user_id: `${programId}-player-${index + 1}`, status: index < count ? "registered" : "waitlisted",
  created_at: daysAgo(count + waiting - index), checked_in_at: null,
  profiles: { display_name: ["Alex Reyes", "Bea Santos", "Carlo Lim", "Dani Cruz", "Ella Tan", "Francis Yu", "Gia Ramos", "Hugo Torres", "Isabel Garcia", "Jules Mendoza", "Kai Flores"][index % 11], avatar_url: null },
}));

let programs: Program[] = [
  { id: "demo-program-live", venue_id: DEMO_VENUE_ID, name: "Doubles Skills Workshop", kind: "coaching", skill_division: "intermediate", starts_at: hoursAgo(1), ends_at: hoursFromNow(1), capacity: 12, price: 600, registration_status: "closed", description: "Practice court positioning, partner communication, and shot selection with guided doubles drills.", program_registrations: programPlayers("demo-program-live", 8).map((player, index) => index < 2 ? { ...player, status: "attended", checked_in_at: hoursAgo(1) } : player) },
  { id: "demo-program-1", venue_id: DEMO_VENUE_ID, name: "Beginner Pickleball Clinic", kind: "clinic", skill_division: "beginner", starts_at: daysFromNow(3), ends_at: hoursFromNow(74), capacity: 16, price: 800, registration_status: "open", description: "Build confidence on court with guided drills, basic rules, and friendly practice games. Bring water and comfortable court shoes; paddles are available at the venue.", program_registrations: programPlayers("demo-program-1", 11) },
  { id: "demo-program-2", venue_id: DEMO_VENUE_ID, name: "Advanced Coaching Series", kind: "coaching", skill_division: "advanced", starts_at: daysFromNow(5), ends_at: hoursFromNow(122), capacity: 8, price: 1500, registration_status: "open", description: "Focused coaching on placement, transition play, and doubles strategy.", program_registrations: programPlayers("demo-program-2", 6, 2) },
  { id: "demo-program-3", venue_id: DEMO_VENUE_ID, name: "Weekend Youth Camp", kind: "camp", skill_division: "all", starts_at: daysFromNow(10), ends_at: hoursFromNow(244), capacity: 24, price: 2200, registration_status: "open", description: "A welcoming introduction to pickleball for young players of every skill level.", program_registrations: programPlayers("demo-program-3", 9) },
];

// Demo edits live in memory for this preview only and never reach Supabase.
export function addDemoProgram(details: Omit<Program, "id">) {
  const created = { ...details, id: `demo-program-${crypto.randomUUID()}`, updated_at: new Date().toISOString(), program_registrations: [] };
  programs = [...programs, created];
  return created;
}

export function updateDemoProgram(id: string, patch: Partial<Program>) {
  const current = programs.find((program) => program.id === id);
  if (!current) throw new Error("Program not found.");
  const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
  programs = programs.map((program) => program.id === id ? updated : program);
  return updated;
}

// ---- Competitions ----------------------------------------------------------

export const DEMO_COMPETITION_ID = "demo-founders-cup";

const entry = (divisionId: string, seed: number, displayName: string): CompetitionEntry => ({
  id: `${divisionId}-entry-${seed}`,
  competition_id: DEMO_COMPETITION_ID,
  competition_division_id: divisionId,
  user_id: `${divisionId}-player-${seed}`,
  seed,
  status: "active",
  eligibility_status: "eligible",
  profiles: { display_name: displayName, avatar_url: demoAvatarUrl(divisionId, seed) },
});

type MatchOptions = { round: number; position: number; homeSeed?: number; awaySeed?: number; winnerSeed?: number; status: string; score?: [number, number]; scheduledAt?: string; startedAt?: string; endedAt?: string };

const bracketMatch = (divisionId: string, options: MatchOptions): CompetitionBracketMatch => {
  const matchId = `${divisionId}-r${options.round}-m${options.position}`;
  const entryId = (seed?: number) => (seed ? `${divisionId}-entry-${seed}` : null);
  const hasMatch = Boolean(options.score || options.startedAt || options.endedAt);
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
    matches: hasMatch ? {
      id: `${matchId}-score`,
      status: options.status,
      scheduled_at: options.scheduledAt || null,
      started_at: options.startedAt || null,
      ended_at: options.endedAt || null,
      match_games: options.score ? [{
        id: `${matchId}-game-1`, game_number: 1, home_score: options.score[0], away_score: options.score[1],
        winner_side: options.score[0] === options.score[1] ? null : options.score[0] > options.score[1] ? 1 : 2,
      }] : [],
    } : null,
  };
};

const openDivisionId = "demo-open-division";
const openEntries = ["Mika Santos", "Paolo Reyes", "Bea Navarro", "Luis Mendoza", "Sam Cruz", "Nico Garcia", "Aya Villanueva", "Marco Lim"].map((name, index) => entry(openDivisionId, index + 1, name));

const openDivision: CompetitionDivision = {
  id: openDivisionId, competition_id: DEMO_COMPETITION_ID, name: "Open Singles", participant_division: "open", format: "singles", skill_category: "open", entry_type: "player", capacity: 8, status: "active", position: 1,
  competition_entries: openEntries,
  competition_bracket_matches: [
    bracketMatch(openDivisionId, { round: 1, position: 1, homeSeed: 1, awaySeed: 8, winnerSeed: 1, status: "completed", score: [11, 4], scheduledAt: hoursAgo(3), startedAt: hoursAgo(2.9), endedAt: hoursAgo(2.6) }),
    bracketMatch(openDivisionId, { round: 1, position: 2, homeSeed: 4, awaySeed: 5, winnerSeed: 5, status: "completed", score: [9, 11], scheduledAt: hoursAgo(3), startedAt: hoursAgo(2.8), endedAt: hoursAgo(2.4) }),
    bracketMatch(openDivisionId, { round: 1, position: 3, homeSeed: 2, awaySeed: 7, status: "live", score: [7, 5], scheduledAt: hoursAgo(1), startedAt: hoursAgo(0.5) }),
    bracketMatch(openDivisionId, { round: 1, position: 4, homeSeed: 3, awaySeed: 6, status: "ready", scheduledAt: hoursFromNow(0.3) }),
    bracketMatch(openDivisionId, { round: 2, position: 1, homeSeed: 1, awaySeed: 5, status: "ready", scheduledAt: hoursFromNow(1.5) }),
    bracketMatch(openDivisionId, { round: 2, position: 2, status: "pending", scheduledAt: hoursFromNow(1.5) }),
    bracketMatch(openDivisionId, { round: 3, position: 1, status: "pending", scheduledAt: hoursFromNow(3) }),
  ],
};

const mixedDivisionId = "demo-mixed-division";
const mixedEntries = ["Team Dink Dynasty", "Team Kitchen Crew", "Team Paddle Pop", "Team Court Kings"].map((name, index) => ({
  ...entry(mixedDivisionId, index + 1, name), user_id: null, team_id: `${mixedDivisionId}-team-${index + 1}`, profiles: null, teams: { name, tag: `T${index + 1}` },
}));

const mixedDivision: CompetitionDivision = {
  id: mixedDivisionId, competition_id: DEMO_COMPETITION_ID, name: "Mixed Doubles 3.5", participant_division: "mixed", format: "doubles", skill_category: "3.5", entry_type: "team", capacity: 4, status: "active", position: 2,
  competition_entries: mixedEntries,
  competition_bracket_matches: [
    bracketMatch(mixedDivisionId, { round: 1, position: 1, homeSeed: 1, awaySeed: 4, winnerSeed: 1, status: "completed", score: [11, 6], scheduledAt: hoursAgo(4), startedAt: hoursAgo(3.9), endedAt: hoursAgo(3.6) }),
    bracketMatch(mixedDivisionId, { round: 1, position: 2, homeSeed: 2, awaySeed: 3, winnerSeed: 3, status: "completed", score: [8, 11], scheduledAt: hoursAgo(4), startedAt: hoursAgo(3.8), endedAt: hoursAgo(3.4) }),
    bracketMatch(mixedDivisionId, { round: 2, position: 1, homeSeed: 1, awaySeed: 3, status: "ready", scheduledAt: hoursFromNow(0.75) }),
  ],
};

export const DEMO_COMPETITION_DIVISIONS: CompetitionDivision[] = [openDivision, mixedDivision];

const competitions: Competition[] = [
  { id: DEMO_COMPETITION_ID, venue_id: DEMO_VENUE_ID, name: "Peakle BGC Founders Cup", kind: "tournament", starts_on: new Date().toISOString().slice(0, 10), status: "active", competition_divisions: DEMO_COMPETITION_DIVISIONS },
];

// ---- Memberships ------------------------------------------------------------

const memberships: MembershipProduct[] = [
  {
    id: "demo-membership-1", venue_id: DEMO_VENUE_ID, name: "Monthly Unlimited", kind: "membership", price: 3500, credits: null, discount_percent: 0, validity_days: 30, active: true,
    player_memberships: [
      { id: "demo-pm-1", status: "active", payment_status: "paid", payment_method: "gcash", amount_due: 0, paid_at: daysAgo(5), profiles: { display_name: "Ari Flores" } },
      { id: "demo-pm-2", status: "active", payment_status: "paid", payment_method: "card", amount_due: 0, paid_at: daysAgo(12), profiles: { display_name: "CJ Ramos" } },
      { id: "demo-pm-3", status: "pending", payment_status: "awaiting_payment", payment_method: "paymaya", amount_due: 3500, paid_at: null, profiles: { display_name: "Diane Ocampo" } },
    ],
  },
  {
    id: "demo-membership-2", venue_id: DEMO_VENUE_ID, name: "10-Session Court Pack", kind: "court_package", price: 4500, credits: 10, discount_percent: 10, validity_days: 90, active: true,
    player_memberships: [
      { id: "demo-pm-4", status: "active", payment_status: "paid", payment_method: "gcash", amount_due: 0, paid_at: daysAgo(20), profiles: { display_name: "Kim Dela Cruz" } },
      { id: "demo-pm-5", status: "active", payment_status: "paid", payment_method: "gcash", amount_due: 0, paid_at: daysAgo(2), profiles: { display_name: "Theo Yu" } },
    ],
  },
  {
    id: "demo-membership-3", venue_id: DEMO_VENUE_ID, name: "Family Plan (4 players)", kind: "membership", price: 9000, credits: null, discount_percent: 15, validity_days: 30, active: true,
    player_memberships: [
      { id: "demo-pm-6", status: "active", payment_status: "paid", payment_method: "card", amount_due: 0, paid_at: daysAgo(8), profiles: { display_name: "Marco Lim" } },
    ],
  },
];

// ---- Analytics --------------------------------------------------------------

const analytics: Analytics = {
  bookings: 186,
  grossRevenue: 214500,
  courtUtilization: 71,
  uniquePlayers: 312,
  returningPlayers: 224,
  cancellationRate: 4,
  openPlayAttendance: 96,
  openPlaySessions: 14,
  programRegistrations: 38,
  peakHour: "6:00 PM – 8:00 PM",
  dailyUtilization: Array.from({ length: 14 }, (_, index) => {
    const dayIndex = 13 - index;
    const weekday = new Date(Date.now() - dayIndex * DAY).getDay();
    const base = weekday === 0 || weekday === 6 ? 82 : 62;
    const wobble = [0, 6, -4, 9, -7, 3, -2, 8, -5, 4, 1, -6, 7, -3][index] || 0;
    return { date: new Date(Date.now() - dayIndex * DAY).toISOString().slice(0, 10), utilization: Math.max(30, Math.min(96, base + wobble)) };
  }),
};

// ---- Earnings ---------------------------------------------------------------

const earningsHistory: EarningsHistoryEntry[] = [
  { id: "demo-earn-1", total_collected: 3600, venue_amount: 3060, platform_fee: 540, outcome: "active", status: "paid", created_at: daysAgo(6), reference: "BGC-10231", starts_at: daysAgo(6), source_type: "booking", description: "Center Court · 3-hour block" },
  { id: "demo-earn-2", total_collected: 3500, venue_amount: 3500, platform_fee: 0, outcome: "active", status: "paid", created_at: daysAgo(10), reference: "MEM-4471", starts_at: daysAgo(10), source_type: "membership", description: "Monthly Unlimited · Ari Flores" },
  { id: "demo-earn-3", total_collected: 1800, venue_amount: 1530, platform_fee: 270, outcome: "active", status: "processing", created_at: daysAgo(2), reference: "BGC-10288", starts_at: daysAgo(2), source_type: "booking", description: "Garden Court · 2-hour block" },
  { id: "demo-earn-4", total_collected: 4050, venue_amount: 4050, platform_fee: 0, outcome: "active", status: "paid", created_at: daysAgo(20), reference: "MEM-4408", starts_at: daysAgo(20), source_type: "membership", description: "10-Session Court Pack · Kim Dela Cruz" },
  { id: "demo-earn-5", total_collected: 900, venue_amount: 765, platform_fee: 135, outcome: "cancelled", status: "pending", created_at: daysAgo(1), reference: "BGC-10299", starts_at: daysAgo(1), source_type: "booking", description: "Court 3 · Cancelled by player" },
  { id: "demo-earn-6", total_collected: 2700, venue_amount: 2295, platform_fee: 405, outcome: "active", status: "requested", created_at: hoursAgo(18), reference: "BGC-10305", starts_at: hoursAgo(18), source_type: "booking", description: "Challenge Court · 3-hour block" },
];

const earnings: Earnings = {
  available_balance: 48250,
  pending_withdrawal: 12000,
  total_earned: 612400,
  total_bookings: 186,
  total_transactions: 214,
  min_withdrawal_amount: 1000,
  history: earningsHistory,
};

// ---- Bookings ---------------------------------------------------------------

const bookings: Booking[] = [
  { id: "demo-booking-1", reference: "BGC-10231", starts_at: daysAgo(6), ends_at: daysAgo(6), amount: 3600, currency: "PHP", status: "completed", payment_status: "paid", payment_method: "gcash", created_at: daysAgo(7), court_name: "Center Court", player_name: "Ari Flores" },
  { id: "demo-booking-2", reference: "BGC-10288", starts_at: daysAgo(2), ends_at: daysAgo(2), amount: 1800, currency: "PHP", status: "completed", payment_status: "paid", payment_method: "card", created_at: daysAgo(3), court_name: "Garden Court", player_name: "Rina Co" },
  { id: "demo-booking-3", reference: "BGC-10299", starts_at: daysAgo(1), ends_at: daysAgo(1), amount: 900, currency: "PHP", status: "cancelled", payment_status: "refunded", payment_method: "paymaya", created_at: daysAgo(2), court_name: "Court 3", player_name: "Theo Yu" },
  { id: "demo-booking-4", reference: "BGC-10305", starts_at: hoursAgo(18), ends_at: hoursAgo(15), amount: 2700, currency: "PHP", status: "completed", payment_status: "paid", payment_method: "gcash", created_at: daysAgo(1), court_name: "Challenge Court", player_name: "Marco Lim" },
  { id: "demo-booking-5", reference: "BGC-10312", starts_at: hoursFromNow(3), ends_at: hoursFromNow(5), amount: 1600, currency: "PHP", status: "confirmed", payment_status: "paid", payment_method: "card", created_at: hoursAgo(4), court_name: "Court 2", player_name: "Mae Chua" },
  { id: "demo-booking-6", reference: "BGC-10318", starts_at: daysFromNow(1), ends_at: daysFromNow(1), amount: 2400, currency: "PHP", status: "confirmed", payment_status: "pay_at_venue", payment_method: null, created_at: hoursAgo(2), court_name: "Center Court", player_name: "Ken Ong" },
  { id: "demo-booking-7", reference: "BGC-10322", starts_at: daysFromNow(2), ends_at: daysFromNow(2), amount: 1300, currency: "PHP", status: "pending", payment_status: "awaiting_payment", payment_method: "dob", created_at: hoursAgo(1), court_name: "Court 5", player_name: "Gia Torres" },
  { id: "demo-booking-8", reference: "BGC-10203", starts_at: daysAgo(11), ends_at: daysAgo(11), amount: 3200, currency: "PHP", status: "completed", payment_status: "paid", payment_method: "gcash", created_at: daysAgo(12), court_name: "Center Court", player_name: "Nico Garcia" },
  { id: "demo-booking-9", reference: "BGC-10188", starts_at: daysAgo(14), ends_at: daysAgo(14), amount: 950, currency: "PHP", status: "completed", payment_status: "partially_refunded", payment_method: "card", created_at: daysAgo(15), court_name: "Garden Court", player_name: "Aya Villanueva" },
  { id: "demo-booking-10", reference: "BGC-10329", starts_at: daysFromNow(3), ends_at: daysFromNow(3), amount: 1800, currency: "PHP", status: "confirmed", payment_status: "paid", payment_method: "gcash", created_at: hoursAgo(6), court_name: "Court 3", player_name: "Leo Go" },
];

// ---- Live scoring simulation -----------------------------------------------
// Ticks any match currently "live" forward one rally — and, once a side wins
// the game, ends it — so the Live Monitor (Open Play courts and the
// competition bracket) plays out during a demo instead of sitting on the
// same frozen score. Driven by the mock realtime channel in
// demo-supabase.ts, which calls this on an interval and then notifies
// subscribers the same way a real postgres_changes event would.
//
// This follows real side-out scoring, not "every rally scores": only the
// serving side can add to the score. If the receiving side wins the rally,
// it's a side out (serve passes over) instead — and in doubles, the serving
// team gets two servers per turn (the first side-out of the game is the one
// exception: the starting server only gets one serve), so a lost rally there
// often just rotates the serve to the second partner rather than costing the
// team the serve outright. See recordRally()/announceRally() in
// src/screens/PlayerOpenPlayScreen.js for the same state machine on mobile.
const GAME_POINT = 11;
const gameOver = (home: number, away: number) => Math.max(home, away) >= GAME_POINT && Math.abs(home - away) >= 2;

const openPlayPlayerLabel = (player?: { open_play_players?: { guest_name?: string | null; profiles?: { display_name?: string | null } | null } | null } | null) =>
  player?.open_play_players?.profiles?.display_name || player?.open_play_players?.guest_name || "Guest player";

const competitionEntryLabel = (entry?: CompetitionEntry | null) =>
  entry?.profiles?.display_name || (entry?.teams?.name ? `${entry.teams.name}${entry.teams.tag ? ` (${entry.teams.tag})` : ""}` : null);

const pointId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type ServeState = { server: 0 | 1; position: 0 | 1; secondServer: boolean; firstServeOfGame: boolean };
const serveStates = new Map<string, ServeState>();
const getServeState = (matchId: string): ServeState => {
  let state = serveStates.get(matchId);
  if (!state) { state = { server: 0, position: 0, secondServer: false, firstServeOfGame: true }; serveStates.set(matchId, state); }
  return state;
};

export function advanceDemoScoring() {
  liveCourts.forEach((court) => {
    const match = court.open_play_matches?.find((item) => item.status === "live");
    if (!match) return;
    const home = match.home_score ?? 0;
    const away = match.away_score ?? 0;
    if (gameOver(home, away)) return;
    const doubles = court.match_format === "doubles";
    const state = getServeState(match.id);
    const roster = (side: 0 | 1) => (match.open_play_match_players || []).filter((player) => player.side === side).sort((a, b) => a.position - b.position);
    const teamLabel = (side: 0 | 1) => roster(side).map(openPlayPlayerLabel).join(" + ") || (side === 0 ? "Home" : "Away");
    const serverLabel = () => openPlayPlayerLabel(doubles ? roster(state.server)[state.position] : roster(state.server)[0]);

    const rallyWinner: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
    let action: string;
    let note: string;
    let announcer: string;
    let finished = false;

    if (rallyWinner === state.server) {
      if (state.server === 0) match.home_score = home + 1; else match.away_score = away + 1;
      announcer = serverLabel();
      action = "SCORES!";
      note = "Score recorded for every player";
      state.firstServeOfGame = false;
      finished = gameOver(match.home_score ?? 0, match.away_score ?? 0);
      if (finished) { match.status = "completed"; action = "WINS THE MATCH!"; announcer = teamLabel(state.server); note = "Final score"; }
    } else if (doubles && !state.secondServer && !state.firstServeOfGame) {
      state.position = state.position === 0 ? 1 : 0;
      state.secondServer = true;
      announcer = serverLabel();
      action = "SECOND SERVER";
      note = `${announcer} serving next`;
    } else {
      state.server = rallyWinner;
      state.position = 0;
      state.secondServer = false;
      state.firstServeOfGame = false;
      announcer = serverLabel();
      action = "SIDE OUT";
      note = `${announcer} serving next`;
    }

    match.server_side = state.server;
    match.serving_position = state.position;
    match.last_point = {
      id: pointId(),
      player: announcer,
      team: finished ? announcer : teamLabel(state.server),
      action,
      score: `${match.home_score ?? 0} – ${match.away_score ?? 0}`,
      note,
    };
  });
  DEMO_COMPETITION_DIVISIONS.forEach((division) => {
    const entryById = new Map((division.competition_entries || []).map((entry) => [entry.id, entry]));
    const entryLabel = (side: 0 | 1, match: CompetitionBracketMatch) => {
      const entryId = side === 0 ? match.home_entry_id : match.away_entry_id;
      return competitionEntryLabel(entryId ? entryById.get(entryId) : null) || (side === 0 ? "Home" : "Away");
    };
    division.competition_bracket_matches?.forEach((match) => {
      if (match.status !== "live") return;
      const game = match.matches?.match_games?.[0];
      if (!game || gameOver(game.home_score, game.away_score)) return;
      const doubles = division.format === "doubles";
      const state = getServeState(match.id);
      const rallyWinner: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
      let action: string;
      let note: string;
      let finished = false;

      if (rallyWinner === state.server) {
        if (state.server === 0) game.home_score += 1; else game.away_score += 1;
        action = "SCORES!";
        note = "Score recorded for every player";
        state.firstServeOfGame = false;
        finished = gameOver(game.home_score, game.away_score);
        if (finished) {
          match.status = "completed";
          match.winner_entry_id = (state.server === 0 ? match.home_entry_id : match.away_entry_id) ?? null;
          game.winner_side = state.server === 0 ? 1 : 2;
          if (match.matches) { match.matches.status = "completed"; match.matches.ended_at = new Date().toISOString(); }
        }
      } else if (doubles && !state.secondServer && !state.firstServeOfGame) {
        state.secondServer = true;
        action = "SECOND SERVER";
        note = `${entryLabel(state.server, match)} serving next`;
      } else {
        state.server = rallyWinner;
        state.secondServer = false;
        state.firstServeOfGame = false;
        action = "SIDE OUT";
        note = `${entryLabel(state.server, match)} serving next`;
      }

      match.last_point = {
        id: pointId(),
        player: entryLabel(state.server, match),
        team: division.name,
        action: finished ? "WINS THE MATCH!" : action,
        score: `${game.home_score} – ${game.away_score}`,
        note: finished ? "Final score" : note,
      };
    });
  });
}

// Backs the demo stand-in for the "assign_fair_play_match" RPC — without
// this, a court freed up by advanceDemoScoring() above would look open but
// "Assign & send to court" would silently do nothing in demo mode.
export function assignDemoLineup(courtId: string, playerIds: string[], scorerPlayerId: string) {
  const court = liveCourts.find((item) => item.id === courtId);
  if (!court) return;
  const players = playerIds
    .map((id) => registrations.find((item) => item.id === id))
    .filter((item): item is Registration => Boolean(item));
  if (!players.length) return;
  players.forEach((registration) => { registration.status = "playing"; });
  const half = Math.ceil(players.length / 2);
  court.open_play_matches = [{
    id: globalThis.crypto.randomUUID(),
    status: "live",
    home_score: 0,
    away_score: 0,
    server_side: 0,
    serving_position: 0,
    started_at: new Date().toISOString(),
    scorer_player_id: scorerPlayerId,
    open_play_match_players: players.map((registration, index) => lineupPlayer(registration, index < half ? 0 : 1, index % half)),
  }];
}

// ---- Assembled workspace ------------------------------------------------

export function buildDemoOrganizerData(): OrganizerData {
  return {
    profile: { id: DEMO_USER_ID, name: "Jamie Cruz", email: "demo.organizer@peakle.app", avatar: null, location: "Taguig City" },
    isAdmin: false,
    venues: [DEMO_VENUE],
    sessions: sessionsWithCounts,
    archivedSessions,
    registrations,
    liveCourts,
    staff,
    programs,
    competitions,
    memberships,
    analytics,
    earnings,
    bookings,
  };
}
