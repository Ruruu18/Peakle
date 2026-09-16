import type { User } from "@supabase/supabase-js";
import { requireSupabase } from "./supabase";
import type { Analytics, Earnings, OpenPlaySession, OrganizerData, Venue } from "./types";
import { isLiveOpenPlaySession } from "./open-play";
import { isDemoUser } from "./demo-mode";
import { buildDemoOrganizerData } from "./demo-data";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function loadOrganizerData(user: User | null, venueId?: string | null): Promise<OrganizerData> {
  if (!user) throw new Error("Sign in to load the organizer workspace.");
  if (isDemoUser(user)) return buildDemoOrganizerData();
  const client = requireSupabase();

  const [profileResult, adminResult, membershipsResult] = await Promise.all([
    client.from("profiles").select("id,display_name,avatar_url,home_area").eq("id", user.id).maybeSingle(),
    client.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
    client.from("venue_members").select("role,venues(*,courts(*))").order("created_at"),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (adminResult.error) throw adminResult.error;
  if (membershipsResult.error) throw membershipsResult.error;

  let venues: Venue[];
  if (adminResult.data) {
    const allVenues = unwrap(await client.from("venues").select("*,courts(*)").order("name"));
    venues = ((allVenues ?? []) as unknown as Venue[]).map((venue) => ({ ...venue, role: "admin", courts: venue.courts ?? [] }));
  } else {
    venues = ((membershipsResult.data ?? []) as unknown as { role: Venue["role"]; venues: Omit<Venue, "role"> | null }[])
      .filter((membership) => membership.venues)
      .map((membership) => ({ ...membership.venues!, role: membership.role, courts: membership.venues?.courts ?? [] }));
  }

  const activeVenueId = venueId && venues.some((venue) => venue.id === venueId) ? venueId : venues[0]?.id;
  const sessionsResult = activeVenueId
    ? await client.from("open_play_sessions").select("*").eq("venue_id", activeVenueId).order("scheduled_start", { ascending: false }).limit(40)
    : { data: [], error: null };
  if (sessionsResult.error) throw sessionsResult.error;
  const visibleSessions = ((sessionsResult.data ?? []) as unknown as OrganizerData["sessions"]).filter((session) => !session.archived_at);
  const activeSessionIds = visibleSessions.filter((session) => isLiveOpenPlaySession(session)).map((session) => session.id);
  const visibleSessionIds = visibleSessions.map((session) => session.id);

  const [archivedSessionsResult, registrationsResult, liveCourtsResult, staffResult, programsResult, competitionsResult, productsResult, analyticsResult, earningsResult, bookingsResult] = await Promise.all([
    activeVenueId
      ? client.from("open_play_sessions").select("*,open_play_players(count),open_play_matches(count)").eq("venue_id", activeVenueId).not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    visibleSessionIds.length
      ? client.from("open_play_players").select("*,profiles!open_play_players_user_id_fkey(display_name,avatar_url)").in("session_id", visibleSessionIds).order("joined_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    activeSessionIds.length
      ? client.from("open_play_courts").select("id,session_id,court_number,match_format,venue_court:courts(name),open_play_matches(id,status,home_score,away_score,server_side,serving_position,started_at,scorer_player_id,open_play_match_players(player_id,side,position,open_play_players(id,guest_name,profiles!open_play_players_user_id_fkey(display_name,avatar_url))))").in("session_id", activeSessionIds).order("session_id").order("court_number")
      : Promise.resolve({ data: [], error: null }),
    activeVenueId
      ? client.from("venue_members").select("venue_id,user_id,role,created_at,profiles!venue_members_user_id_fkey(display_name,avatar_url)").eq("venue_id", activeVenueId).order("created_at")
      : Promise.resolve({ data: [], error: null }),
    activeVenueId
      ? client.from("venue_programs").select("*,program_registrations(program_id,user_id,status,checked_in_at,created_at,profiles!program_registrations_user_id_fkey(display_name,avatar_url))").eq("venue_id", activeVenueId).order("starts_at")
      : Promise.resolve({ data: [], error: null }),
    activeVenueId
      ? client.from("competitions").select("*,competition_divisions(id,name,competition_entries(id,status))").eq("venue_id", activeVenueId).order("starts_on")
      : Promise.resolve({ data: [], error: null }),
    activeVenueId
      ? client.from("membership_products").select("*,player_memberships(id,status,payment_status,payment_method,amount_due,paid_at,profiles!player_memberships_user_id_fkey(display_name))").eq("venue_id", activeVenueId).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    activeVenueId
      ? client.rpc("get_venue_pickleball_analytics", {
          p_venue_id: activeVenueId,
          p_from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
          p_to: new Date().toISOString().slice(0, 10),
        })
      : Promise.resolve({ data: null, error: null }),
    activeVenueId
      ? client.rpc("get_venue_earnings_summary", { p_venue_id: activeVenueId })
      : Promise.resolve({ data: null, error: null }),
    activeVenueId
      ? client.rpc("list_venue_bookings", { p_venue_id: activeVenueId })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (registrationsResult.error) throw new Error(`Open Play registrations could not be loaded: ${registrationsResult.error.message}`);
  if (programsResult.error) throw new Error(`Programs could not be loaded: ${programsResult.error.message}`);

  const soft = <T,>(result: { data: T | null; error: unknown }) => result.error ? null : result.data;
  const profile = profileResult.data;
  type ArchivedRow = OpenPlaySession & { open_play_players?: { count: number }[]; open_play_matches?: { count: number }[] };
  const archivedSessions = ((soft(archivedSessionsResult) ?? []) as unknown as ArchivedRow[]).map(({ open_play_players, open_play_matches, ...session }) => ({
    ...session,
    player_count: Number(open_play_players?.[0]?.count || 0),
    match_count: Number(open_play_matches?.[0]?.count || 0),
  }));
  const registrations = (registrationsResult.data ?? []) as unknown as OrganizerData["registrations"];
  const sessions = visibleSessions.map((session) => {
    const sessionRegistrations = registrations.filter((registration) => registration.session_id === session.id);
    return {
      ...session,
      player_count: sessionRegistrations.filter((registration) => !["cancelled", "rejected"].includes(registration.registration_status || "")).length,
      registered_count: sessionRegistrations.filter((registration) => registration.registration_status === "approved").length,
      requested_count: sessionRegistrations.filter((registration) => registration.registration_status === "requested").length,
      waitlisted_count: sessionRegistrations.filter((registration) => registration.registration_status === "waitlisted").length,
    };
  });

  return {
    profile: {
      id: user.id,
      name: profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Organizer",
      email: user.email,
      avatar: profile?.avatar_url,
      location: profile?.home_area,
    },
    isAdmin: Boolean(adminResult.data),
    venues,
    sessions,
    archivedSessions,
    registrations,
    liveCourts: (soft(liveCourtsResult) ?? []) as unknown as OrganizerData["liveCourts"],
    staff: (soft(staffResult) ?? []) as unknown as OrganizerData["staff"],
    programs: (soft(programsResult) ?? []) as unknown as OrganizerData["programs"],
    competitions: (soft(competitionsResult) ?? []) as unknown as OrganizerData["competitions"],
    memberships: (soft(productsResult) ?? []) as unknown as OrganizerData["memberships"],
    analytics: (soft(analyticsResult) as Analytics | null) ?? null,
    earnings: (soft(earningsResult) as Earnings | null) ?? null,
    bookings: (soft(bookingsResult) ?? []) as unknown as OrganizerData["bookings"],
  };
}
