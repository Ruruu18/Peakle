export type VenueRole = "owner" | "manager" | "front_desk" | "court_monitor" | "scorer" | "viewer" | "admin";

export type Court = {
  id: string;
  venue_id: string;
  name: string;
  environment?: string | null;
  surface?: string | null;
  hourly_price?: number | null;
  owner_hourly_price?: number | null;
  active?: boolean | null;
  image_url?: string | null;
};

export type Venue = {
  id: string;
  name: string;
  area?: string | null;
  address?: string | null;
  venue_type?: string | null;
  opens_at?: string | null;
  closes_at?: string | null;
  verification_status?: string | null;
  active?: boolean | null;
  image_url?: string | null;
  role: VenueRole;
  courts: Court[];
};

export type OpenPlaySession = {
  id: string;
  organizer_id?: string;
  venue_id?: string | null;
  name: string;
  status: string;
  session_code?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  live_started_at?: string | null;
  capacity?: number | null;
  court_count?: number | null;
  visibility?: string | null;
  match_format?: string | null;
  fee_amount?: number | null;
  archived_at?: string | null;
  player_count?: number;
  registered_count?: number;
  requested_count?: number;
  waitlisted_count?: number;
  match_count?: number;
  revision?: number | null;
  is_demo?: boolean;
};

export type Registration = {
  id: string;
  session_id: string;
  user_id?: string | null;
  guest_name?: string | null;
  registration_status?: string | null;
  status?: string | null;
  games_played?: number | null;
  queue_position?: number | null;
  joined_at?: string | null;
  waiting_since?: string | null;
  checked_in_at?: string | null;
  departed_at?: string | null;
  profiles?: { display_name?: string | null; avatar_url?: string | null; skill_rating?: number | null } | null;
};

export type OpenPlayMatchPlayer = {
  player_id: string;
  side: number;
  position: number;
  open_play_players?: {
    id: string;
    guest_name?: string | null;
    profiles?: { display_name?: string | null; avatar_url?: string | null; skill_rating?: number | null } | null;
  } | null;
};

export type OpenPlayMatch = {
  id: string;
  status?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  started_at?: string | null;
  scorer_player_id?: string | null;
  open_play_match_players?: OpenPlayMatchPlayer[];
};

export type OpenPlayScoreEvent = {
  id: number;
  match_id: string;
  action?: string | null;
  rally_winner_side?: number | null;
  home_score: number;
  away_score: number;
  created_at: string;
  undone_at?: string | null;
};

export type StaffMember = {
  venue_id: string;
  user_id: string;
  role: VenueRole;
  created_at?: string;
  profiles?: { display_name?: string | null; avatar_url?: string | null } | null;
};

export type Program = {
  id: string;
  venue_id: string;
  name: string;
  kind?: string | null;
  starts_at?: string | null;
  capacity?: number | null;
  price?: number | null;
  registration_status?: string | null;
  program_registrations?: { status?: string | null }[];
};

export type CompetitionEntry = {
  id: string;
  competition_id: string;
  competition_division_id?: string | null;
  user_id?: string | null;
  team_id?: string | null;
  seed?: number | null;
  status?: string | null;
  eligibility_status?: string | null;
  played?: number | null;
  won?: number | null;
  lost?: number | null;
  points_for?: number | null;
  points_against?: number | null;
  standing_points?: number | null;
  profiles?: { display_name?: string | null; avatar_url?: string | null } | null;
  teams?: { name?: string | null; tag?: string | null } | null;
};

export type CompetitionMatchGame = {
  id: string;
  game_number: number;
  home_score: number;
  away_score: number;
  winner_side?: number | null;
};

export type CompetitionMatch = {
  id: string;
  status?: string | null;
  scheduled_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  match_games?: CompetitionMatchGame[];
};

export type CompetitionBracketMatch = {
  id: string;
  competition_id: string;
  competition_division_id: string;
  round_number: number;
  position: number;
  home_entry_id?: string | null;
  away_entry_id?: string | null;
  winner_entry_id?: string | null;
  match_id?: string | null;
  status: string;
  scheduled_at?: string | null;
  matches?: CompetitionMatch | null;
};

export type CompetitionDivision = {
  id: string;
  competition_id: string;
  name: string;
  participant_division?: string | null;
  format?: string | null;
  skill_category?: string | null;
  entry_type?: string | null;
  capacity?: number | null;
  status?: string | null;
  position?: number | null;
  competition_entries?: CompetitionEntry[];
  competition_bracket_matches?: CompetitionBracketMatch[];
};

export type Competition = {
  id: string;
  venue_id: string;
  name: string;
  kind?: string | null;
  starts_on?: string | null;
  status?: string | null;
  competition_divisions?: CompetitionDivision[];
};

export type MembershipProduct = {
  id: string;
  venue_id: string;
  name: string;
  kind?: string | null;
  price?: number | null;
  credits?: number | null;
  discount_percent?: number | null;
  validity_days?: number | null;
  active?: boolean | null;
  player_memberships?: {
    id: string;
    status?: string | null;
    payment_status?: string | null;
    payment_method?: string | null;
    amount_due?: number | null;
    paid_at?: string | null;
    profiles?: { display_name?: string | null } | null;
  }[];
};

export type Analytics = {
  bookings?: number;
  grossRevenue?: number;
  courtUtilization?: number;
  uniquePlayers?: number;
  returningPlayers?: number;
  cancellationRate?: number;
  openPlayAttendance?: number;
  openPlaySessions?: number;
  programRegistrations?: number;
  peakHour?: string;
  dailyUtilization?: { date: string; utilization: number }[];
};

export type EarningsHistoryEntry = {
  id: string;
  total_collected: number;
  venue_amount: number;
  platform_fee: number;
  outcome: "active" | "cancelled";
  status: "pending" | "requested" | "processing" | "paid";
  created_at: string;
  reference?: string | null;
  starts_at?: string | null;
  source_type?: "booking" | "membership" | null;
  description?: string | null;
};

export type Booking = {
  id: string;
  reference?: string | null;
  starts_at: string;
  ends_at: string;
  amount: number;
  currency: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | string;
  payment_status: "pay_at_venue" | "awaiting_payment" | "paid" | "refunded" | "partially_refunded" | "failed" | string;
  payment_method?: "gcash" | "paymaya" | "card" | "dob" | string | null;
  created_at: string;
  court_name?: string | null;
  player_name?: string | null;
};

export type Earnings = {
  available_balance: number;
  pending_withdrawal: number;
  total_earned: number;
  total_bookings: number;
  total_transactions?: number;
  min_withdrawal_amount: number;
  history: EarningsHistoryEntry[];
};

export type OrganizerData = {
  profile: { id: string; name: string; email?: string | null; avatar?: string | null; location?: string | null };
  isAdmin: boolean;
  venues: Venue[];
  sessions: OpenPlaySession[];
  archivedSessions: OpenPlaySession[];
  registrations: Registration[];
  liveCourts: {
    id: string;
    session_id?: string | null;
    court_number?: number | null;
    match_format?: string | null;
    venue_court?: { name?: string | null } | null;
    open_play_matches?: OpenPlayMatch[];
  }[];
  staff: StaffMember[];
  programs: Program[];
  competitions: Competition[];
  memberships: MembershipProduct[];
  analytics: Analytics | null;
  earnings: Earnings | null;
  bookings: Booking[];
};
