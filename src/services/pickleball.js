import { requireSupabase } from '../lib/supabase';

async function currentUser(client) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Sign in to use competitive features.');
  return data.user;
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data || [];
}

export async function loadPlayerPickleballHub() {
  const client = requireSupabase();
  const user = await currentUser(client);
  const now = new Date().toISOString();
  const [profile, ratings, availability, posts, competitions, programs, memberships, products, matches, challenges, teams] = await Promise.all([
    client.from('profiles').select('id,display_name,home_area,profile_visibility,availability_visibility,matching_enabled').eq('id', user.id).single(),
    client.from('player_ratings').select('*').eq('user_id', user.id),
    client.from('player_availability').select('*').eq('user_id', user.id).gte('ends_at', now).order('starts_at'),
    client.from('matchmaking_posts')
      .select('*, profiles!matchmaking_posts_creator_id_fkey(display_name,avatar_url), matched_profile:profiles!matchmaking_posts_matched_user_id_fkey(display_name,avatar_url), venues(name)')
      .in('status', ['open', 'matched'])
      .gt('starts_at', now)
      .order('starts_at')
      .limit(30),
    client.from('competitions').select('*, competition_entries(id,user_id,team_id,played,won,lost,points_for,points_against,standing_points,profiles(display_name),teams(name,tag)), competition_bracket_matches(*)').in('status', ['registration', 'active']).order('starts_on').limit(20),
    client.from('venue_programs').select('*, venues(name), profiles!venue_programs_coach_id_fkey(display_name), program_registrations(user_id,status)').eq('registration_status', 'open').gt('starts_at', now).order('starts_at').limit(30),
    client.from('player_memberships').select('*, membership_products(*, venues(name))').eq('user_id', user.id).in('status', ['pending', 'active', 'paused']).order('expires_at'),
    client.from('membership_products').select('*, venues(name)').eq('active', true).order('created_at', { ascending: false }).limit(30),
    client.from('matches').select('id,match_type,mode,verification_status,result_revision,ended_at,venue_id,court_id,venues(name),courts(name),match_participants(user_id,side,position,profiles(display_name)),match_games(home_score,away_score,winner_side),match_result_confirmations(user_id,decision)').eq('status', 'completed').order('ended_at', { ascending: false }).limit(100),
    client.from('team_challenges').select('*, challenger:teams!team_challenges_challenger_team_id_fkey(id,name,tag), challenged:teams!team_challenges_challenged_team_id_fkey(id,name,tag), venues(name)').in('status', ['pending', 'accepted']).order('starts_at'),
    client.from('teams').select('id,name,tag,is_discoverable,team_members(user_id,role)').neq('status', 'archived').order('name'),
  ]);
  const results = [profile, ratings, availability, posts, competitions, programs, memberships, products, matches, challenges, teams];
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  return {
    userId: user.id,
    profile: profile.data,
    ratings: ratings.data || [],
    availability: availability.data || [],
    posts: posts.data || [],
    competitions: competitions.data || [],
    programs: programs.data || [],
    memberships: memberships.data || [],
    products: products.data || [],
    pendingResults: (matches.data || []).filter((match) => ['unverified', 'pending', 'disputed'].includes(match.verification_status) && match.match_participants?.some((participant) => participant.user_id === user.id)),
    performance: buildPerformance(matches.data || [], user.id),
    challenges: challenges.data || [],
    teams: teams.data || [],
  };
}

function buildPerformance(matches, userId) {
  const groups = new Map();
  const add = (dimension, label, won) => {
    if (!label) return;
    const key = `${dimension}:${label}`;
    const value = groups.get(key) || { dimension, label, played: 0, won: 0 };
    value.played += 1;
    value.won += won ? 1 : 0;
    groups.set(key, value);
  };
  matches.filter((match) => match.verification_status === 'verified').forEach((match) => {
    const mine = match.match_participants?.find((participant) => participant.user_id === userId);
    if (!mine) return;
    const homeWins = match.match_games?.filter((game) => game.winner_side === 0).length || 0;
    const awayWins = match.match_games?.filter((game) => game.winner_side === 1).length || 0;
    const won = mine.side === 0 ? homeWins > awayWins : awayWins > homeWins;
    add('Format', match.match_type, won);
    add('Venue', match.venues?.name || 'Unlisted court', won);
    add('Court', match.courts?.name, won);
    match.match_participants?.filter((participant) => participant.side === mine.side && participant.user_id !== userId).forEach((participant) => add('Partner', participant.profiles?.display_name || 'Guest partner', won));
    match.match_participants?.filter((participant) => participant.side !== mine.side).forEach((participant) => add('Opponent', participant.profiles?.display_name || 'Guest opponent', won));
  });
  return [...groups.values()].map((item) => ({ ...item, winRate: Math.round(item.won * 100 / item.played) })).sort((a, b) => b.played - a.played || b.winRate - a.winRate);
}

export async function updatePickleballPrivacy(settings) {
  const { data, error } = await requireSupabase().rpc('update_competitive_privacy', {
    p_profile_visibility: settings.profileVisibility,
    p_availability_visibility: settings.availabilityVisibility,
    p_matching_enabled: settings.matchingEnabled,
  });
  if (error) throw error;
  return data;
}

export async function publishAvailability({ startsAt, endsAt, area, formats = ['doubles'], recurringRule = null, note = '' }) {
  const client = requireSupabase();
  const user = await currentUser(client);
  const { data, error } = await client.from('player_availability').insert({ user_id: user.id, starts_at: startsAt, ends_at: endsAt, area, formats, recurring_rule: recurringRule, note: note || null }).select().single();
  if (error) throw error;
  return data;
}

export async function removeAvailability(id) {
  const { error } = await requireSupabase().from('player_availability').delete().eq('id', id);
  if (error) throw error;
}

export async function publishMatchRequest({ kind, format = 'doubles', startsAt, endsAt = null, area, venueId = null, minimumRating = null, maximumRating = null, note = '', teamId = null }) {
  const client = requireSupabase();
  const user = await currentUser(client);
  const { data, error } = await client.from('matchmaking_posts').insert({ creator_id: user.id, team_id: teamId, kind, format, starts_at: startsAt, ends_at: endsAt, area, venue_id: venueId, minimum_rating: minimumRating, maximum_rating: maximumRating, note: note || null }).select().single();
  if (error) throw error;
  return data;
}

export async function claimMatchRequest(postId) {
  const { data, error } = await requireSupabase().rpc('claim_matchmaking_post', { p_post_id: postId });
  if (error) throw error;
  return data;
}

export async function closeMatchRequest(postId) {
  const client = requireSupabase();
  const user = await currentUser(client);
  const { data, error } = await client.from('matchmaking_posts')
    .update({ status: 'closed' })
    .eq('id', postId)
    .eq('creator_id', user.id)
    .eq('status', 'open')
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This play request is no longer open.');
  return data;
}

export async function closeOpenMatchRequests() {
  const client = requireSupabase();
  const user = await currentUser(client);
  const { data, error } = await client.from('matchmaking_posts')
    .update({ status: 'closed' })
    .eq('creator_id', user.id)
    .eq('status', 'open')
    .select('id');
  if (error) throw error;
  return data || [];
}

export async function confirmMatchResult(matchId, confirm, note = '') {
  const { data, error } = await requireSupabase().rpc('confirm_match_result', { p_match_id: matchId, p_confirm: confirm, p_note: note || null });
  if (error) throw error;
  return data;
}

export async function joinProgram(programId) {
  const { data, error } = await requireSupabase().rpc('register_for_program', { p_program_id: programId });
  if (error) throw error;
  return data;
}

export async function joinCompetition(competitionId, teamId = null) {
  const client = requireSupabase();
  const user = await currentUser(client);
  const { data, error } = await client.from('competition_entries').insert({ competition_id: competitionId, user_id: teamId ? null : user.id, team_id: teamId }).select().single();
  if (error) throw error;
  return data;
}

export async function requestMembership(productId) {
  const { data, error } = await requireSupabase().rpc('request_membership_product', { p_product_id: productId });
  if (error) throw error;
  return data;
}

export async function createTeamChallenge({ challengerTeamId, challengedTeamId, startsAt, venueId = null, format = 'doubles', privacy = 'private', note = '' }) {
  const client = requireSupabase();
  const user = await currentUser(client);
  const { data, error } = await client.from('team_challenges').insert({ challenger_team_id: challengerTeamId, challenged_team_id: challengedTeamId, proposed_by: user.id, starts_at: startsAt, venue_id: venueId, format, privacy, note: note || null }).select().single();
  if (error) throw error;
  return data;
}

export async function respondTeamChallenge(challengeId, accept) {
  const { data, error } = await requireSupabase().from('team_challenges').update({ status: accept ? 'accepted' : 'declined' }).eq('id', challengeId).eq('status', 'pending').select().single();
  if (error) throw error;
  return data;
}

export async function loadOrganizerPickleballHub(venues) {
  const client = requireSupabase();
  const venueIds = venues.map((venue) => venue.id);
  if (!venueIds.length) return { programs: [], competitions: [], products: [], analytics: null };
  const [programs, competitions, products] = await Promise.all([
    client.from('venue_programs').select('*, program_registrations(status)').in('venue_id', venueIds).order('starts_at'),
    client.from('competitions').select('*, competition_entries(id,status,played,won,lost,standing_points), competition_bracket_matches(*)').in('venue_id', venueIds).order('starts_on'),
    client.from('membership_products').select('*, player_memberships(*, profiles(display_name))').in('venue_id', venueIds).order('created_at', { ascending: false }),
  ]);
  return { programs: unwrap(programs), competitions: unwrap(competitions), products: unwrap(products) };
}

export async function createVenueProgram({ venueId, name, kind, skillDivision = 'all', startsAt, endsAt, capacity, price = 0, recurringRule = null, description = '' }) {
  const client = requireSupabase();
  const user = await currentUser(client);
  const { data, error } = await client.from('venue_programs').insert({ venue_id: venueId, created_by: user.id, name, kind, skill_division: skillDivision, starts_at: startsAt, ends_at: endsAt, recurrence_rule: recurringRule, capacity, price, registration_status: 'open', description: description || null }).select().single();
  if (error) throw error;
  return data;
}

export async function createCompetition({ venueId, name, kind, format = 'doubles', startsOn, endsOn = null, capacity = 16, rules = '', visibility = 'public' }) {
  const client = requireSupabase();
  const user = await currentUser(client);
  const { data, error } = await client.from('competitions').insert({ venue_id: venueId, organizer_id: user.id, name, kind, format, status: 'registration', starts_on: startsOn, ends_on: endsOn, capacity, rules: rules || null, visibility }).select().single();
  if (error) throw error;
  return data;
}

export async function seedTournamentBracket(competitionId) {
  const { data, error } = await requireSupabase().rpc('seed_tournament_bracket', { p_competition_id: competitionId });
  if (error) throw error;
  return data;
}

export async function createMembershipProduct({ venueId, name, kind, price, credits = 0, discountPercent = 0, validityDays = 30, terms = '' }) {
  const { data, error } = await requireSupabase().from('membership_products').insert({ venue_id: venueId, name, kind, price, credits, discount_percent: discountPercent, validity_days: validityDays, terms: terms || null }).select().single();
  if (error) throw error;
  return data;
}

export async function activateMembership(membershipId) {
  const { data, error } = await requireSupabase().rpc('activate_player_membership', { p_membership_id: membershipId });
  if (error) throw error;
  return data;
}

export async function loadVenueAnalytics(venueId, from, to) {
  const { data, error } = await requireSupabase().rpc('get_venue_pickleball_analytics', { p_venue_id: venueId, p_from: from, p_to: to });
  if (error) throw error;
  return data;
}

export function venueAnalyticsCsv(venueName, analytics) {
  const rows = [
    ['Venue', venueName], ['From', analytics.from], ['To', analytics.to], ['Bookings', analytics.bookings],
    ['Cancelled bookings', analytics.cancelledBookings], ['Cancellation rate', `${analytics.cancellationRate}%`],
    ['Gross revenue (PHP)', analytics.grossRevenue], ['Booked court hours', analytics.bookedCourtHours],
    ['Unique players', analytics.uniquePlayers], ['Open-play sessions', analytics.openPlaySessions],
    ['Returning players', analytics.returningPlayers], ['Court utilization', `${analytics.courtUtilization}%`], ['Peak hour', analytics.peakHour],
    ['Open-play attendance', analytics.openPlayAttendance], ['Program registrations', analytics.programRegistrations],
  ];
  return rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}
