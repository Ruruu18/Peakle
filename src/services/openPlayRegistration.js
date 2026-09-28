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
    hosted: mapHostedOpenPlay(row.hosted),
  };
}

// Player-hosted open play: no venue, courts filled automatically by Peakle.
function mapHostedOpenPlay(hosted) {
  if (!hosted) return null;
  return {
    scheduledGameId: hosted.scheduled_game_id,
    place: hosted.place || '',
    area: hosted.area || '',
    courtCount: Number(hosted.court_count || 1),
    liveStartedAt: hosted.live_started_at,
    isHost: Boolean(hosted.is_host),
    canCheckIn: Boolean(hosted.can_check_in),
    players: (hosted.players || []).map((player) => ({
      userId: player.user_id,
      name: player.name || 'Player',
      avatar: player.avatar_url || null,
      isHost: Boolean(player.is_host),
      state: player.state,
      queuePosition: player.queue_position == null ? null : Number(player.queue_position),
      gamesPlayed: Number(player.games_played || 0),
    })),
  };
}

export function mapOpenPlayMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    courtId: row.court_id,
    courtNumber: Number(row.court_number || 0),
    courtName: row.court_name || `Court ${row.court_number || ''}`.trim(),
    matchFormat: row.match_format || 'doubles',
    scores: [Number(row.home_score || 0), Number(row.away_score || 0)],
    serverSide: Number(row.server_side || 0),
    servingPosition: Number(row.serving_position || 0),
    serviceNumber: Number(row.service_number ?? (row.match_format === 'doubles' ? 2 : 1)),
    canUndo: Boolean(row.can_undo),
    lastEvent: row.last_event || null,
    startedAt: row.started_at,
    scorerPlayerId: row.scorer_player_id,
    scorerName: row.scorer_name || 'Assigned scorer',
    canScore: Boolean(row.can_score),
    players: (row.players || []).map((player) => ({
      id: player.player_id,
      userId: player.user_id,
      name: player.name || 'Guest player',
      avatar: player.avatar_url || null,
      side: Number(player.side || 0),
      position: Number(player.position || 0),
      isMe: Boolean(player.is_me),
      isScorer: Boolean(player.is_scorer),
    })),
  };
}

export async function createOpenPlaySession(details) {
  const scheduledStart = new Date(details.scheduledStart);
  const scheduledEnd = new Date(details.scheduledEnd);
  if (Number.isNaN(scheduledStart.getTime()) || Number.isNaN(scheduledEnd.getTime()) || scheduledEnd <= scheduledStart) {
    throw new Error('Choose a valid session schedule.');
  }
  if (scheduledStart <= new Date()) {
    throw new Error('Choose a start time that has not passed yet.');
  }
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_open_play_session', {
    p_name: details.name.trim(),
    p_venue_id: details.venueId,
    p_court_ids: details.courtIds,
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
    p_court_formats: details.courtFormats || details.courtIds.map(() => details.matchFormat || 'doubles'),
    p_average_match_minutes: details.averageMatchMinutes || 15,
    p_max_consecutive_games: details.maxConsecutiveGames ?? 2,
    p_rest_minutes: details.restMinutes || 0,
  });
  if (error) throw error;
  const session = single(data);
  if (!session?.id) throw new Error('The session could not be published.');
  const { data: sessionCourts, error: courtsError } = await client
    .from('open_play_courts')
    .select('*, venue_court:courts(name)')
    .eq('session_id', session.id)
    .order('court_number');
  // The RPC has already committed the session and its courts. A transient
  // follow-up read must not make the organizer retry and create a duplicate
  // session (or see their newly reserved courts as unavailable).
  const fallbackCourts = details.courtIds.map((venueCourtId, index) => ({
    id: `${session.id}-court-${index + 1}`,
    session_id: session.id,
    court_number: index + 1,
    venue_court_id: venueCourtId,
    match_format: details.courtFormats?.[index] || details.matchFormat || 'doubles',
    venue_court: null,
  }));
  return {
    ...session,
    sessionCourts: courtsError || sessionCourts?.length !== details.courtIds.length ? fallbackCourts : sessionCourts,
  };
}

export async function listDiscoverableOpenPlaySessions() {
  const { data, error } = await requireSupabase().rpc('list_discoverable_open_play_sessions');
  if (error) throw error;
  return (data || []).map(mapOpenPlaySession);
}

// `status = 'active'` covers both a published-but-not-started session and a
// currently live one; `live_started_at` is the field that tells them apart.
export async function listOrganizerOpenPlaySessions({ segment = 'past', limit = 20, offset = 0 } = {}) {
  const client = requireSupabase();
  let query = client
    .from('open_play_sessions')
    .select('id, name, status, scheduled_start, scheduled_end, live_started_at, started_at, ended_at, capacity, venues(name, area)')
    .range(offset, offset + limit - 1);
  if (segment === 'current') {
    query = query.eq('status', 'active').not('live_started_at', 'is', null).order('live_started_at', { ascending: false });
  } else if (segment === 'upcoming') {
    query = query.eq('status', 'active').is('live_started_at', null).order('scheduled_start', { ascending: true });
  } else {
    query = query.in('status', ['completed', 'cancelled']).order('ended_at', { ascending: false, nullsFirst: false });
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    venueName: row.venues?.name || 'Venue',
    venueArea: row.venues?.area || null,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    liveStartedAt: row.live_started_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    capacity: Number(row.capacity || 0),
  }));
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
  const [{ data: liveState, error: liveError }, { data: activeMatch, error: matchError }] = await Promise.all([
    client.rpc('get_open_play_live_state', { p_session_id: mapped.id }),
    client.rpc('get_my_open_play_match', { p_session_id: mapped.id }),
  ]);
  // Live state is intentionally registration-gated. Session discovery and
  // invitation previews still work before a player joins.
  if (!liveError && liveState) mapped.liveState = single(liveState);
  if (!matchError && activeMatch) mapped.liveState = { ...(mapped.liveState || {}), activeMatch: mapOpenPlayMatch(single(activeMatch)) };
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
    .select('*, profiles!open_play_players_user_id_fkey(display_name, avatar_url)')
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
    .select('id, display_name, avatar_url, home_area')
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

export async function updateOpenPlayMatchScore(matchId, scores) {
  const { data, error } = await requireSupabase().rpc('update_open_play_match_score', {
    p_match_id: matchId,
    p_home_score: Number(scores[0]),
    p_away_score: Number(scores[1]),
  });
  if (error) throw error;
  return single(data);
}

export async function recordOpenPlayRally(matchId, winningSide) {
  const { data, error } = await requireSupabase().rpc('record_open_play_rally', {
    p_match_id: matchId,
    p_winning_side: Number(winningSide),
  });
  if (error) throw error;
  return single(data);
}

export async function undoOpenPlayRally(matchId) {
  const { data, error } = await requireSupabase().rpc('undo_open_play_rally', {
    p_match_id: matchId,
  });
  if (error) throw error;
  return single(data);
}

export async function startHostedOpenPlay({ gameId, courtCount, presentIds }) {
  const { data, error } = await requireSupabase().rpc('start_hosted_open_play', {
    p_game_id: gameId,
    p_court_count: courtCount,
    p_present_user_ids: presentIds,
  });
  if (error) throw error;
  const result = single(data);
  if (!result?.session_id) throw new Error('Open play could not be started.');
  return result.session_id;
}

// The live session a scheduled open play is running, or null before it starts.
export async function getHostedOpenPlay(gameId) {
  const { data, error } = await requireSupabase().rpc('get_hosted_open_play', { p_game_id: gameId });
  if (error) throw error;
  const row = single(data);
  if (!row?.session_id) return null;
  return { sessionId: row.session_id, status: row.status, liveStartedAt: row.live_started_at, endedAt: row.ended_at };
}

export async function checkInHostedOpenPlay(sessionId, userId = null) {
  const { error } = await requireSupabase().rpc('check_in_hosted_open_play', { p_session_id: sessionId, p_user_id: userId });
  if (error) throw error;
}

export async function leaveHostedOpenPlayQueue(sessionId, userId = null) {
  const { error } = await requireSupabase().rpc('leave_hosted_open_play_queue', { p_session_id: sessionId, p_user_id: userId });
  if (error) throw error;
}

export async function endHostedOpenPlay(sessionId) {
  const { error } = await requireSupabase().rpc('end_hosted_open_play', { p_session_id: sessionId });
  if (error) throw error;
}

export async function completeOpenPlayMatchByScorer(matchId, scores) {
  const { data, error } = await requireSupabase().rpc('complete_open_play_match_by_scorer', {
    p_match_id: matchId,
    p_home_score: Number(scores[0]),
    p_away_score: Number(scores[1]),
  });
  if (error) throw error;
  return single(data);
}
