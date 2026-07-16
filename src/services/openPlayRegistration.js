import { requireSupabase } from '../lib/supabase';

function single(data) {
  return Array.isArray(data) ? data[0] : data;
}

export function mapOpenPlayRegistration(row) {
  if (!row) return null;
  const profile = row.profiles || row.profile || null;
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    name: profile?.display_name || row.guest_name || 'Guest player',
    avatar: profile?.avatar_url || null,
    skill: profile?.skill_rating ?? null,
    status: row.registration_status,
    playStatus: row.status,
    gamesPlayed: row.games_played || 0,
    queuePosition: row.queue_position,
    joinedAt: row.joined_at,
    checkedInAt: row.checked_in_at,
    departedAt: row.departed_at,
    waitingSince: row.waiting_since || row.checked_in_at || row.joined_at,
    consecutiveGames: Number(row.consecutive_games || 0),
    lastMatchEndedAt: row.last_match_ended_at,
    playPreference: row.play_preference || 'either',
    priorityBoost: Number(row.priority_boost || 0),
  };
}

export function mapOpenPlaySession(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.session_code || null,
    visibility: row.visibility,
    approvalMode: row.approval_mode,
    capacity: Number(row.capacity),
    skillMin: row.skill_min == null ? null : Number(row.skill_min),
    skillMax: row.skill_max == null ? null : Number(row.skill_max),
    feeAmount: Number(row.fee_amount || 0),
    currency: row.currency || 'PHP',
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    rules: row.rules,
    cancellationPolicy: row.cancellation_policy,
    matchFormat: row.match_format || 'doubles',
    averageMatchMinutes: Number(row.average_match_minutes || 15),
    maxConsecutiveGames: Number(row.max_consecutive_games ?? 2),
    restMinutes: Number(row.rest_minutes || 0),
    organizer: row.organizer,
    venue: row.venue,
    registeredCount: Number(row.registered_count || 0),
    registration: mapOpenPlayRegistration(row.my_registration),
    liveState: row.live_state || null,
  };
}

export async function createOpenPlaySession(details) {
  const { data, error } = await requireSupabase().rpc('create_open_play_session', {
    p_name: details.name.trim(),
    p_venue_id: details.venueId,
    p_court_count: details.courtCount,
    p_capacity: details.capacity,
    p_visibility: details.visibility,
    p_approval_mode: details.approvalMode,
    p_skill_min: details.skillMin,
    p_skill_max: details.skillMax,
    p_fee_amount: details.feeAmount,
    p_scheduled_start: details.scheduledStart,
    p_scheduled_end: details.scheduledEnd,
    p_rules: details.rules,
    p_cancellation_policy: details.cancellationPolicy,
    p_match_format: details.matchFormat || 'doubles',
    p_average_match_minutes: details.averageMatchMinutes || 15,
    p_max_consecutive_games: details.maxConsecutiveGames ?? 2,
    p_rest_minutes: details.restMinutes || 0,
  });
  if (error) throw error;
  return single(data);
}

export async function listDiscoverableOpenPlaySessions() {
  const { data, error } = await requireSupabase().rpc('list_discoverable_open_play_sessions');
  if (error) throw error;
  return (data || []).map(mapOpenPlaySession);
}

export async function getOpenPlaySession({ sessionId = null, code = null } = {}) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_open_play_session', {
    p_session_id: sessionId,
    p_code: code?.trim().toUpperCase() || null,
  });
  if (error) throw error;
  const mapped = mapOpenPlaySession(single(data));
  if (!mapped?.id) return mapped;
  const { data: liveState, error: liveError } = await client.rpc('get_open_play_live_state', { p_session_id: mapped.id });
  // Live state is intentionally registration-gated. Session discovery and
  // invitation previews still work before a player joins.
  if (!liveError && liveState) mapped.liveState = single(liveState);
  return mapped;
}

export async function joinOpenPlaySession(sessionId, code = null) {
  const { data, error } = await requireSupabase().rpc('join_open_play_session', {
    p_session_id: sessionId,
    p_code: code?.trim().toUpperCase() || null,
  });
  if (error) throw error;
  return mapOpenPlayRegistration(single(data));
}

export async function reviewOpenPlayRegistration(playerId, approve) {
  const { data, error } = await requireSupabase().rpc('review_open_play_registration', {
    p_player_id: playerId,
    p_approve: Boolean(approve),
  });
  if (error) throw error;
  return mapOpenPlayRegistration(single(data));
}

export async function checkInOpenPlayPlayer(playerId) {
  const { data, error } = await requireSupabase().rpc('check_in_open_play_player', { p_player_id: playerId });
  if (error) throw error;
  return mapOpenPlayRegistration(single(data));
}

export async function cancelOpenPlayRegistration(playerId) {
  const { data, error } = await requireSupabase().rpc('cancel_open_play_registration', { p_player_id: playerId });
  if (error) throw error;
  return mapOpenPlayRegistration(single(data));
}

export async function listOrganizerOpenPlayRegistrations(sessionId) {
  if (!sessionId) return [];
  const { data, error } = await requireSupabase()
    .from('open_play_players')
    .select('*, profiles!open_play_players_user_id_fkey(display_name, avatar_url, skill_rating)')
    .eq('session_id', sessionId)
    .order('joined_at');
  if (error) throw error;
  return (data || []).map(mapOpenPlayRegistration);
}

export async function searchOpenPlayInviteCandidates(query) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const clean = query.trim();
  if (!auth.user || clean.length < 2) return [];
  const { data, error } = await client.from('profiles')
    .select('id, display_name, avatar_url, skill_rating, home_area')
    .neq('id', auth.user.id)
    .ilike('display_name', `%${clean}%`)
    .order('display_name')
    .limit(15);
  if (error) throw error;
  return data || [];
}

export async function inviteOpenPlayPlayer(sessionId, userId) {
  const { data, error } = await requireSupabase().rpc('invite_open_play_player', {
    p_session_id: sessionId,
    p_invited_user_id: userId,
  });
  if (error) throw error;
  return single(data);
}

export async function recordFairPlayAssignment({ sessionId, courtId, matchId, playerIds, scorerId, explanation, recommendedIds, overrideReason = null }) {
  const { data, error } = await requireSupabase().rpc('assign_fair_play_match', {
    p_session_id: sessionId,
    p_court_id: courtId,
    p_match_id: matchId,
    p_player_ids: playerIds,
    p_scorer_player_id: scorerId,
    p_explanation: explanation || {},
    p_recommended_ids: recommendedIds,
    p_override_reason: overrideReason?.trim() || null,
  });
  if (error) throw error;
  return single(data);
}

export async function completeFairPlayMatch({ matchId, doneIds = [], scores = [0, 0], winner = null, endedAt = new Date().toISOString() }) {
  const { data, error } = await requireSupabase().rpc('complete_fair_play_match', {
    p_match_id: matchId,
    p_done_player_ids: doneIds,
    p_home_score: scores[0],
    p_away_score: scores[1],
    p_winner_side: winner,
    p_ended_at: endedAt,
  });
  if (error) throw error;
  return single(data);
}
