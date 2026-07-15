import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireSupabase } from '../lib/supabase';

const unfinishedMatchKey = (userId) => `@peakle/unfinished-match/${userId}`;

function isMissingResumeState(error) {
  return error?.code === '42703' || error?.message?.includes('resume_state') && error.message.includes('does not exist');
}

async function readLocalUnfinishedMatch(userId) {
  if (!userId) return null;
  const stored = await AsyncStorage.getItem(unfinishedMatchKey(userId)).catch(() => null);
  if (!stored) return null;
  try { return JSON.parse(stored); } catch { return null; }
}

async function writeLocalUnfinishedMatch(userId, match) {
  if (!userId) return;
  await AsyncStorage.setItem(unfinishedMatchKey(userId), JSON.stringify(match));
}

async function clearLocalUnfinishedMatch(userId) {
  if (!userId) return;
  await AsyncStorage.removeItem(unfinishedMatchKey(userId)).catch(() => {});
}

function localDateTime(date, time) {
  const [clock, period] = time.split(' ');
  const [rawHour, minute] = clock.split(':').map(Number);
  const hour = (rawHour % 12) + (period === 'PM' ? 12 : 0);
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;
}

export async function createBooking({ userId, venue, court, booking }) {
  const client = requireSupabase();
  const startsAt = new Date(localDateTime(booking.dateIso, booking.time));
  const endsAt = new Date(startsAt.getTime() + booking.duration * 60_000);
  let { data, error } = await client.rpc('create_booking', {
    p_court_id: court.id,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_invite_team: booking.inviteTeam,
    p_team_id: booking.inviteTeam ? booking.teamId : null,
  });
  // Keep court booking available during a rolling deploy where the client can
  // arrive before the migration that adds the team_id RPC argument.
  if (error?.code === 'PGRST202') {
    ({ data, error } = await client.rpc('create_booking', {
      p_court_id: court.id,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_invite_team: booking.inviteTeam,
    }));
  }
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function listVenues({ signal } = {}) {
  let query = requireSupabase().from('venues').select('*, courts(*)').eq('active', true).order('name');
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listMyBookings() {
  const client = requireSupabase();
  const { data, error } = await client.from('bookings').select('*, venues(*), courts(*)').order('starts_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function extendBooking(bookingId) {
  const { data, error } = await requireSupabase().rpc('extend_booking', {
    p_booking_id: bookingId,
    p_minutes: 30,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function listCourtSchedule(courtId, dateIso) {
  const start = new Date(`${dateIso}T00:00:00+08:00`).toISOString();
  const end = new Date(`${dateIso}T23:59:59+08:00`).toISOString();
  const { data, error } = await requireSupabase().from('bookings').select('starts_at, ends_at').eq('court_id', courtId).in('status', ['pending', 'confirmed']).lt('starts_at', end).gt('ends_at', start);
  if (error) throw error;
  return data;
}

export async function loadActiveOpenPlay() {
  const client = requireSupabase();
  const { data: root, error } = await client.from('open_play_sessions').select('*').eq('status', 'active').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!root) return null;
  const [playerResult, courtResult, matchResult] = await Promise.all([
    client.from('open_play_players').select('*').eq('session_id', root.id),
    client.from('open_play_courts').select('*').eq('session_id', root.id).order('court_number'),
    client.from('open_play_matches').select('*, open_play_match_players(*)').eq('session_id', root.id).order('started_at'),
  ]);
  const failure = playerResult.error || courtResult.error || matchResult.error;
  if (failure) throw failure;
  const players = playerResult.data.map((player) => ({ id: player.id, name: player.guest_name || 'Registered player', status: player.status, gamesPlayed: player.games_played }));
  const byMatch = (row) => {
    const lineup = [...row.open_play_match_players].sort((a, b) => a.side - b.side || a.position - b.position);
    const playerIds = lineup.map((item) => item.player_id);
    return {
      id: row.id,
      playerIds,
      teams: [lineup.filter((item) => item.side === 0).map((item) => item.player_id), lineup.filter((item) => item.side === 1).map((item) => item.player_id)],
      scorerId: row.scorer_player_id,
      scores: [row.home_score, row.away_score],
      history: [],
      startedAt: new Date(row.started_at).getTime(),
      endedAt: row.ended_at ? new Date(row.ended_at).getTime() : undefined,
      complete: row.status === 'completed',
      winner: row.winner_side,
    };
  };
  const matches = matchResult.data.map(byMatch);
  const courts = courtResult.data.map((court) => ({
    id: court.id,
    number: court.court_number,
    match: matches.find((match) => matchResult.data.find((row) => row.id === match.id)?.session_court_id === court.id && !match.complete) || null,
  }));
  return {
    id: root.id,
    players,
    queue: playerResult.data.filter((player) => player.queue_position !== null).sort((a, b) => a.queue_position - b.queue_position).map((player) => player.id),
    courts,
    completedMatches: matches.filter((match) => match.complete),
  };
}

export async function syncOpenPlay(session) {
  if (!session) return;
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw authError || new Error('No authenticated organizer.');
  const { error: rootError } = await client.from('open_play_sessions').upsert({
    id: session.id,
    organizer_id: auth.user.id,
    name: 'Open play',
    status: 'active',
    court_count: session.courts.length,
  });
  if (rootError) throw rootError;
  const queuePositions = new Map(session.queue.map((id, index) => [id, index]));
  const { error: playerError } = await client.from('open_play_players').upsert(session.players.map((player) => ({
    id: player.id,
    session_id: session.id,
    guest_name: player.name,
    status: player.status,
    games_played: player.gamesPlayed,
    queue_position: queuePositions.has(player.id) ? queuePositions.get(player.id) : null,
  })));
  if (playerError) throw playerError;
  const { error: courtError } = await client.from('open_play_courts').upsert(session.courts.map((court) => ({ id: court.id, session_id: session.id, court_number: court.number })));
  if (courtError) throw courtError;
  const activeMatches = session.courts.flatMap((court) => court.match ? [{ ...court.match, courtId: court.id }] : []);
  const completedMatches = session.completedMatches.map((match) => ({ ...match, courtId: session.courts.find((court) => court.number === match.courtNumber)?.id }));
  const matches = [...completedMatches, ...activeMatches].filter((match) => match.courtId);
  for (const match of matches) {
    const complete = Boolean(match.endedAt || match.complete && completedMatches.some((item) => item.id === match.id));
    const { error: matchError } = await client.from('open_play_matches').upsert({
      id: match.id,
      session_id: session.id,
      session_court_id: match.courtId,
      scorer_player_id: match.scorerId || null,
      home_score: match.scores[0],
      away_score: match.scores[1],
      winner_side: match.winner,
      status: complete ? 'completed' : 'live',
      started_at: new Date(match.startedAt).toISOString(),
      ended_at: match.endedAt ? new Date(match.endedAt).toISOString() : null,
    });
    if (matchError) throw matchError;
    const lineup = match.teams.flatMap((team, side) => team.map((playerId, position) => ({ match_id: match.id, player_id: playerId, side, position })));
    const { error: lineupError } = await client.from('open_play_match_players').upsert(lineup);
    if (lineupError) throw lineupError;
  }
}

export async function completeOpenPlay(sessionId) {
  if (!sessionId) return;
  const { error } = await requireSupabase().from('open_play_sessions').update({ status: 'completed', ended_at: new Date().toISOString() }).eq('id', sessionId);
  if (error) throw error;
}

export async function listTeams() {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('teams').select('*, team_members(user_id, role, profiles(display_name, avatar_url, skill_rating))').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((team) => {
    const mine = team.team_members.find((member) => member.user_id === auth.user?.id);
    return {
      id: team.id, name: team.name, tag: team.tag, location: team.location || '', latitude: team.latitude, longitude: team.longitude,
      members: team.team_members.length, capacity: team.capacity, rating: '—', level: team.skill_level || 'Open level', color: team.color || '#1C6B66',
      icon: 'people-outline', role: mine ? ({ creator: 'Creator', admin: 'Admin', co_admin: 'Co-admin', member: 'Member' }[mine.role]) : null, motto: team.motto || '', about: team.about || '',
      image: team.image_url,
      roster: team.team_members.map((member) => ({ id: member.user_id, name: member.profiles?.display_name || 'Player', initials: (member.profiles?.display_name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), role: ({ creator: 'Creator', admin: 'Admin', co_admin: 'Co-admin', member: 'Member' }[member.role]) || 'Member', rating: member.profiles?.skill_rating ?? 'Unrated', color: '#1C6B66' })),
      acceptedMembers: team.team_members.filter((member) => member.user_id !== auth.user?.id).map((member) => ({ id: member.user_id, name: member.profiles?.display_name || 'Player', rating: member.profiles?.skill_rating ?? 'Unrated' })),
    };
  });
}

export async function createTeamRecord(details) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to create a team.');
  const { data, error } = await client.from('teams').insert({
    creator_id: auth.user.id, name: details.name, tag: details.tag, motto: details.motto, about: details.about,
    location: details.location, latitude: details.latitude, longitude: details.longitude, skill_level: details.level,
    capacity: details.capacity, color: details.color || '#1C6B66', image_url: details.image || null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateTeamRecord(teamId, details) {
  const { error } = await requireSupabase().from('teams').update({
    name: details.name, tag: details.tag, motto: details.motto, about: details.about, location: details.location,
    latitude: details.latitude, longitude: details.longitude, skill_level: details.level, capacity: details.capacity,
    color: details.color, image_url: details.image || null,
  }).eq('id', teamId);
  if (error) throw error;
}

export async function requestTeamJoin(teamId, note = '') {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to join a team.');
  const { error } = await client.from('team_join_requests').upsert({ team_id: teamId, user_id: auth.user.id, note, status: 'pending' }, { onConflict: 'team_id,user_id' });
  if (error) throw error;
}

export async function listTeamRequests(teamIds) {
  if (!teamIds.length) return [];
  const { data, error } = await requireSupabase().from('team_join_requests').select('*, profiles(display_name, skill_rating, avatar_url)').in('team_id', teamIds).eq('status', 'pending');
  if (error) throw error;
  return data;
}

export async function listMyTeamRequests() {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await client.from('team_join_requests').select('team_id').eq('user_id', auth.user.id).eq('status', 'pending');
  if (error) throw error;
  return data.map((item) => item.team_id);
}

export async function reviewTeamRequest(request, accept) {
  const client = requireSupabase();
  const { error } = await client.rpc('review_team_request', { p_request_id: request.id, p_accept: accept });
  if (error) throw error;
}

export async function listTeamMessages(teamId) {
  const { data, error } = await requireSupabase().from('team_messages').select('*, profiles(display_name, avatar_url)').eq('team_id', teamId).order('created_at');
  if (error) throw error;
  return data;
}

export async function sendTeamMessage(teamId, body, imageUrl = null) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('team_messages').insert({ team_id: teamId, sender_id: auth.user.id, body: body || null, image_url: imageUrl }).select('*, profiles(display_name, avatar_url)').single();
  if (error) throw error;
  return data;
}

export async function uploadTeamImage(teamId, uri) {
  if (!uri || uri.startsWith('http')) return uri;
  const client = requireSupabase();
  const extension = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  const response = await fetch(uri);
  const file = await response.arrayBuffer();
  const path = `${teamId}/${Date.now()}.${extension}`;
  const { error } = await client.storage.from('team-images').upload(path, file, { contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`, upsert: true });
  if (error) throw error;
  return client.storage.from('team-images').getPublicUrl(path).data.publicUrl;
}

export async function saveCompletedMatch(userId, result, userName) {
  const client = requireSupabase();
  const venueId = ['yard', 'rockwell', 'valley'].find((id) => result.court?.id?.startsWith(id));
  const courtNumber = result.court?.id?.match(/(\d+)$/)?.[1];
  const matchValues = {
    created_by: userId,
    scorer_id: userId,
    venue_id: venueId || null,
    court_id: venueId && courtNumber ? `${venueId}-court-${courtNumber}` : null,
    match_type: result.matchType,
    mode: result.mode,
    visibility: result.access === 'public' ? 'public' : 'private',
    target_score: result.target,
    best_of: result.bestOf,
    win_by_two: result.winByTwo,
    status: 'completed',
    started_at: new Date(Date.now() - (result.elapsed || 0) * 1000).toISOString(),
    ended_at: new Date().toISOString(),
    resume_state: null,
  };
  const persistMatch = (values) => (result.savedMatchId
    ? client.from('matches').update(values).eq('id', result.savedMatchId).eq('created_by', userId)
    : client.from('matches').insert(values)).select().single();
  let { data: match, error } = await persistMatch(matchValues);
  if (isMissingResumeState(error)) {
    const { resume_state: _resumeState, ...legacyMatchValues } = matchValues;
    ({ data: match, error } = await persistMatch(legacyMatchValues));
  }
  if (error) throw error;
  if (result.savedMatchId) {
    const [participants, games] = await Promise.all([
      client.from('match_participants').delete().eq('match_id', match.id),
      client.from('match_games').delete().eq('match_id', match.id),
    ]);
    if (participants.error || games.error) throw participants.error || games.error;
  }
  const normalizedUserName = userName?.trim().toLowerCase();
  const registeredByName = new Map((result.registeredPlayers || [])
    .filter((player) => player?.id && player?.name)
    .map((player) => [player.name.trim().toLowerCase(), player.id]));
  if (normalizedUserName && userId) registeredByName.set(normalizedUserName, userId);
  let userAssigned = false;
  const lineup = result.players.flatMap((team, side) => team.map((guestName, position) => {
    const normalizedName = guestName.trim().toLowerCase();
    const currentUser = !userAssigned && normalizedUserName && normalizedName === normalizedUserName;
    if (currentUser) userAssigned = true;
    const registeredId = registeredByName.get(normalizedName) || null;
    return { match_id: match.id, user_id: registeredId, guest_name: registeredId ? null : guestName, side, position };
  }));
  const { error: participantError } = await client.from('match_participants').insert(lineup);
  if (participantError) throw participantError;
  const scores = result.gameScores?.length ? result.gameScores : [result.scores];
  const { error: gameError } = await client.from('match_games').insert(scores.map((score, index) => ({
    match_id: match.id, game_number: index + 1, home_score: score[0], away_score: score[1], winner_side: score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1, ended_at: new Date().toISOString(),
  })));
  if (gameError) throw gameError;
  const rating = calculatePerformanceRating(await listMyMatches());
  const { error: ratingError } = await client.from('profiles').update({ skill_rating: rating }).eq('id', userId);
  if (ratingError) throw ratingError;
  await clearLocalUnfinishedMatch(userId);
  return match;
}

export async function saveUnfinishedMatch(userId, result, userName) {
  const client = requireSupabase();
  const venueId = ['yard', 'rockwell', 'valley'].find((id) => result.court?.id?.startsWith(id));
  const courtNumber = result.court?.id?.match(/(\d+)$/)?.[1];
  const resumeState = { ...result, savedMatchId: result.savedMatchId || null };
  const values = {
    created_by: userId,
    scorer_id: userId,
    venue_id: venueId || null,
    court_id: venueId && courtNumber ? `${venueId}-court-${courtNumber}` : null,
    match_type: result.matchType,
    mode: result.mode,
    visibility: result.access === 'public' ? 'public' : 'private',
    target_score: result.target,
    best_of: result.bestOf,
    win_by_two: result.winByTwo,
    status: 'live',
    started_at: new Date(Date.now() - (result.elapsed || 0) * 1000).toISOString(),
    ended_at: null,
    resume_state: resumeState,
  };
  const query = result.savedMatchId
    ? client.from('matches').update(values).eq('id', result.savedMatchId).eq('created_by', userId)
    : client.from('matches').insert(values);
  const { data, error } = await query.select().single();
  if (isMissingResumeState(error)) {
    const localMatch = { ...resumeState, savedMatchId: null };
    await writeLocalUnfinishedMatch(userId, localMatch);
    return localMatch;
  }
  if (error) throw error;
  const saved = { ...resumeState, savedMatchId: data.id };
  await writeLocalUnfinishedMatch(userId, saved);
  return saved;
}

export async function loadUnfinishedMatch() {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const userId = auth.user?.id;
  const { data, error } = await client.from('matches')
    .select('id, resume_state')
    .eq('status', 'live')
    .not('resume_state', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingResumeState(error)) return readLocalUnfinishedMatch(userId);
  if (error) throw error;
  return data?.resume_state ? { ...data.resume_state, savedMatchId: data.id } : readLocalUnfinishedMatch(userId);
}

export async function listPlayers() {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('profiles').select('id, display_name, avatar_url, skill_rating').neq('id', auth.user.id).limit(25);
  if (error) throw error;
  return data.map((player) => ({ id: player.id, name: player.display_name, avatar: player.avatar_url, initials: player.display_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2), rating: player.skill_rating ?? 'Unrated', distance: 'Available', color: '#1C6B66' }));
}

export async function listMyMatches() {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  const { data, error } = await client.from('matches').select('*, match_games(*), match_participants(*, profiles(display_name)), venues(name), courts(name)').eq('status', 'completed').order('ended_at', { ascending: false });
  if (error) throw error;
  return data.map((match) => {
    const games = [...match.match_games].sort((a, b) => a.game_number - b.game_number);
    const currentParticipant = match.match_participants.find((player) => player.user_id === auth.user?.id);
    const currentSide = currentParticipant?.side ?? 0;
    const normalizedGames = games.map((game) => ({ homeScore: currentSide === 0 ? game.home_score : game.away_score, awayScore: currentSide === 0 ? game.away_score : game.home_score }));
    const homeWins = normalizedGames.filter((game) => game.homeScore > game.awayScore).length;
    const awayWins = normalizedGames.filter((game) => game.awayScore > game.homeScore).length;
    const playerName = (player) => player.guest_name || player.profiles?.display_name || 'Player';
    const opponents = match.match_participants.filter((player) => player.side !== currentSide).sort((a, b) => a.position - b.position).map(playerName).join(' & ');
    const partnerRow = currentParticipant
      ? match.match_participants.find((player) => player.side === currentSide && player.user_id !== auth.user?.id && player.position !== currentParticipant.position)
      : match.match_participants.find((player) => player.side === currentSide && player.position === 1);
    const partner = partnerRow ? playerName(partnerRow) : null;
    return { id: match.id, opponent: opponents || 'Opponent', partner, score: normalizedGames.map((game) => `${game.homeScore}–${game.awayScore}`).join(', '), games: normalizedGames, result: homeWins > awayWins ? 'W' : 'L', date: new Date(match.ended_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase(), endedAt: match.ended_at, startedAt: match.started_at, type: `${match.mode === 'ranked' ? 'Ranked' : 'Casual'} ${match.match_type}`, rating: '—', venue: match.venues ? `${match.venues.name}${match.courts ? ` · ${match.courts.name}` : ''}` : 'Unlisted court', duration: match.started_at && match.ended_at ? `${Math.max(1, Math.round((new Date(match.ended_at) - new Date(match.started_at)) / 60000))} min` : '—', longestRally: null, sideOuts: null, serveWon: null, returnWon: null, kitchenWon: null, errors: null, takeaway: homeWins > awayWins ? 'Match completed and recorded.' : 'Review the scoring pattern from this match.', improve: 'Use the score history to plan the next match.' };
  });
}

export function calculatePerformanceRating(matches) {
  if (!matches?.length) return null;
  let rating = 3;
  [...matches].reverse().forEach((match) => {
    const games = match.games || [];
    const pointsFor = games.reduce((total, game) => total + Number(game.homeScore || 0), 0);
    const pointsAgainst = games.reduce((total, game) => total + Number(game.awayScore || 0), 0);
    const totalPoints = pointsFor + pointsAgainst;
    const margin = totalPoints ? (pointsFor - pointsAgainst) / totalPoints : 0;
    const resultChange = match.result === 'W' ? 0.12 : -0.12;
    rating = Math.min(5.5, Math.max(1, rating + resultChange + margin * 0.08));
  });
  return Number(rating.toFixed(1));
}
