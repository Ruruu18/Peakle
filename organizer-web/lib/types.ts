export type VenueRole = "owner" | "manager" | "front_desk" | "court_monitor" | "scorer" | "viewer" | "admin";

export type Court = {
  id: string;
  venue_id: string;
  name: string;
  environment?: string | null;
  surface?: string | null;
  hourly_price?: number | null;
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

export type Competition = {
  id: string;
  venue_id: string;
  name: string;
  kind?: string | null;
  starts_on?: string | null;
  status?: string | null;
  competition_divisions?: { id: string; name?: string | null; competition_entries?: { id: string; status?: string | null }[] }[];
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
  player_memberships?: { id: string; status?: string | null }[];
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

export type OrganizerData = {
  profile: { id: string; name: string; email?: string | null; avatar?: string | null; location?: string | null };
  entitlement: { status: string; tier?: string | null; currentPeriodEnd?: string | null } | null;
  isAdmin: boolean;
  venues: Venue[];
  sessions: OpenPlaySession[];
  archivedSessions: OpenPlaySession[];
  registrations: Registration[];
  liveCourts: {
    id: string;
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
};
