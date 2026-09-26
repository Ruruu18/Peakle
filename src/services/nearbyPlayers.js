import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';
import { DEMO_NEARBY_PLAYERS } from '../config/demoData';

export const INVITE_WINDOW_MS = 60 * 1000;
const JOINED_INVITE_WINDOW_MS = 15 * 60 * 1000;
const ACTIVE_LIVE_MATCH_WINDOW_MS = 90 * 60 * 1000;

function initials(name) {
  return (name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

export function distanceLabel(distance) {
  if (!Number.isFinite(distance) || distance < 0) return 'Nearby';
  if (distance < 0.01) return 'Less than 10 m';
  if (distance < 1) return `${Math.max(1, Math.round(distance * 100)) * 10} m`;
  if (distance < 100) return `${distance.toFixed(1)} km`;
  return `${Math.round(distance)} km`;
}

function accuracyLabel(accuracyM) {
  if (!Number.isFinite(accuracyM) || accuracyM <= 0) return null;
  if (accuracyM < 1000) return `${Math.max(5, Math.round(accuracyM / 5) * 5)} m`;
  return `${(accuracyM / 1000).toFixed(1)} km`;
}

export async function publishPresence(userId, location, { visible = true, availability = 'available' } = {}) {
  if (DEMO_MODE) return { user_id: userId, is_visible: true, availability, last_seen_at: new Date().toISOString() };
  if (!userId || ![location?.latitude, location?.longitude].every(Number.isFinite)) return;
  const now = new Date().toISOString();
  const client = requireSupabase();
  const presence = {
    user_id: userId,
    latitude: location.latitude,
    longitude: location.longitude,
    is_visible: visible,
    availability,
    last_seen_at: now,
    updated_at: now,
  };
  if (Number.isFinite(location.accuracy)) {
    presence.accuracy_m = Math.min(Math.max(location.accuracy, 0), 50000);
  }

  let { data, error } = await client
    .from('player_presence')
    .upsert(presence, { onConflict: 'user_id' })
    .select('user_id, is_visible, availability, last_seen_at')
    .single();

  // Keep visibility working while a release reaches devices before the
  // distance-accuracy migration reaches the linked Supabase project.
  const missingAccuracyColumn = error
    && ['PGRST204', '42703'].includes(error.code)
    && `${error.message || ''} ${error.details || ''}`.includes('accuracy_m');
  if (missingAccuracyColumn) {
    const compatiblePresence = { ...presence };
    delete compatiblePresence.accuracy_m;
    ({ data, error } = await client
      .from('player_presence')
      .upsert(compatiblePresence, { onConflict: 'user_id' })
      .select('user_id, is_visible, availability, last_seen_at')
      .single());
  }
  if (error) throw error;
  if (!data?.user_id || !data.is_visible) throw new Error('Peakle could not publish your nearby-player visibility.');
  return data;
}

export async function stopPresence(userId, { disable = false } = {}) {
  if (DEMO_MODE) return;
  if (!userId) return;
  const changes = { availability: 'offline', updated_at: new Date().toISOString() };
  if (disable) changes.is_visible = false;
  const { error } = await requireSupabase().from('player_presence').update(changes).eq('user_id', userId);
  if (error) throw error;
}

export async function listNearbyOnlinePlayers(location, radiusKm = 25) {
  if (DEMO_MODE) return DEMO_NEARBY_PLAYERS;
  if (![location?.latitude, location?.longitude].every(Number.isFinite)) return [];
  const { data, error } = await requireSupabase().rpc('nearby_online_players', {
    p_latitude: location.latitude,
    p_longitude: location.longitude,
    p_radius_km: radiusKm,
  });
  if (error) throw error;
  return (data || []).map((player) => {
    const localAccuracy = Number.isFinite(location.accuracy) ? location.accuracy : null;
    const remoteAccuracy = Number.isFinite(player.location_accuracy_m) ? player.location_accuracy_m : null;
    const distanceAccuracyM = localAccuracy != null || remoteAccuracy != null
      ? Math.ceil(Math.hypot(localAccuracy || 0, remoteAccuracy || 0))
      : null;
    return {
      id: player.id,
      name: player.display_name,
      avatar: player.avatar_url,
      initials: initials(player.display_name),
      rating: player.skill_rating ?? 'Unrated',
      distanceKm: player.distance_km,
      distance: distanceLabel(player.distance_km),
      distanceAccuracyM,
      distanceAccuracy: accuracyLabel(distanceAccuracyM),
      availability: player.availability,
      lastSeenAt: player.last_seen_at,
      color: '#1C6B66',
    };
  });
}

// Name search across every registered player, independent of distance or
// online presence, so players in other cities can still be found and invited.
export async function searchRegisteredPlayers(query) {
  const clean = (query || '').trim();
  if (clean.length < 2) return [];
  if (DEMO_MODE) {
    const needle = clean.toLocaleLowerCase();
    return DEMO_NEARBY_PLAYERS.filter((player) => player.name.toLocaleLowerCase().includes(needle));
  }
  const { data, error } = await requireSupabase().rpc('search_registered_players', { p_query: clean });
  if (error) throw error;
  return (data || []).map((player) => ({
    id: player.id,
    name: player.display_name || 'Peakle player',
    avatar: player.avatar_url,
    initials: initials(player.display_name),
    rating: player.skill_rating ?? 'Unrated',
    area: player.home_area || null,
    isSearchResult: true,
    color: '#1C6B66',
  }));
}

export async function sendMatchInvite(recipientId, matchPayload) {
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw authError || new Error('Sign in to invite a player.');
  const staleCutoff = new Date(Date.now() - INVITE_WINDOW_MS).toISOString();
  const { data: staleInvites, error: staleError } = await client.from('match_invites')
    .select('id')
    .eq('sender_id', auth.user.id)
    .eq('recipient_id', recipientId)
    .eq('status', 'pending')
    .lte('created_at', staleCutoff);
  if (staleError) throw staleError;
  for (const staleInvite of staleInvites || []) {
    const { error: cancelError } = await client.rpc('cancel_match_invite', { p_invite_id: staleInvite.id });
    if (cancelError) throw cancelError;
  }
  const { data, error } = await client.rpc('send_match_invite', { p_recipient_id: recipientId, p_match_payload: matchPayload });
  if (error) throw error;
  return data;
}

export async function listMatchInvites() {
  if (DEMO_MODE) return { incoming: [], outgoing: [], joinedInvite: null, removedInvite: null };
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return { incoming: [], outgoing: [], joinedInvite: null, removedInvite: null };
  const pendingCutoff = new Date(Date.now() - INVITE_WINDOW_MS).toISOString();
  const historyCutoff = new Date(Date.now() - JOINED_INVITE_WINDOW_MS).toISOString();
  const [incomingResult, outgoingResult] = await Promise.all([
    client.from('match_invites')
      .select('*, sender:profiles!match_invites_sender_id_fkey(id, display_name, avatar_url)')
      .eq('recipient_id', auth.user.id).gte('created_at', historyCutoff).order('created_at', { ascending: false }),
    client.from('match_invites')
      .select('*, recipient:profiles!match_invites_recipient_id_fkey(id, display_name, avatar_url)')
      .eq('sender_id', auth.user.id).gte('created_at', historyCutoff).order('created_at', { ascending: false }),
  ]);
  const error = incomingResult.error || outgoingResult.error;
  if (error) throw error;
  const incomingRows = incomingResult.data || [];
  const joinedInvite = incomingRows.find((invite) => invite.status === 'accepted') || null;
  return {
    incoming: incomingRows.filter((invite) => invite.status === 'pending' && invite.created_at >= pendingCutoff),
    joinedInvite,
    // Only surface a removal when it is the recipient's latest invitation
    // event. This prevents an older removal from interrupting a later re-invite.
    removedInvite: !joinedInvite && incomingRows[0]?.status === 'removed' ? incomingRows[0] : null,
    outgoing: outgoingResult.data || [],
  };
}

export async function respondToMatchInvite(inviteId, accept) {
  const { data, error } = await requireSupabase().rpc('respond_match_invite', { p_invite_id: inviteId, p_accept: accept });
  if (error) throw error;
  return data;
}

export async function leaveMatchInvite(inviteId) {
  const { data, error } = await requireSupabase().rpc('leave_match_invite', { p_invite_id: inviteId });
  if (error) throw error;
  return data;
}

export async function removeMatchInvitee(inviteId) {
  const { data, error } = await requireSupabase().rpc('remove_match_invitee', { p_invite_id: inviteId });
  if (error) throw error;
  return data;
}

export async function startNearbyLiveMatch({ setupId, configuration, initialState, scorerId }) {
  const { data, error } = await requireSupabase().rpc('start_nearby_live_match', {
    p_setup_id: setupId,
    p_configuration: configuration,
    p_initial_state: initialState,
    p_scorer_id: scorerId,
  });
  if (error) throw error;
  return data;
}

export async function getNearbyLiveMatch(matchId) {
  if (!matchId || DEMO_MODE) return null;
  const { data, error } = await requireSupabase().from('nearby_live_matches')
    .select('*, nearby_live_match_members(user_id,role,profiles(display_name,avatar_url))')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Matches often outlast the invite history window, so recover the caller's
// in-progress session directly from the live match table (RLS limits rows to
// sessions the caller hosts or belongs to).
export async function getActiveNearbyLiveMatchId() {
  if (DEMO_MODE) return null;
  const since = new Date(Date.now() - ACTIVE_LIVE_MATCH_WINDOW_MS).toISOString();
  const { data, error } = await requireSupabase().from('nearby_live_matches')
    .select('id')
    .in('status', ['live', 'paused'])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

export async function updateNearbyLiveMatch(matchId, expectedRevision, state, status = null) {
  const { data, error } = await requireSupabase().rpc('update_nearby_live_match', {
    p_match_id: matchId,
    p_expected_revision: expectedRevision,
    p_state: state,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

export async function handoffNearbyLiveScorer(matchId, scorerId) {
  const { data, error } = await requireSupabase().rpc('handoff_nearby_live_scorer', {
    p_match_id: matchId,
    p_scorer_id: scorerId,
  });
  if (error) throw error;
  return data;
}

export async function cancelMatchInvite(inviteId) {
  const { data, error } = await requireSupabase().rpc('cancel_match_invite', { p_invite_id: inviteId });
  if (error) throw error;
  return data;
}
