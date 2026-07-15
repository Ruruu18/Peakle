import { requireSupabase } from '../lib/supabase';

const INVITE_WINDOW_MS = 15 * 60 * 1000;

function initials(name) {
  return (name || 'P').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function distanceLabel(distance) {
  if (!Number.isFinite(distance)) return 'Nearby';
  if (distance < 1) return `${Math.max(10, Math.round(distance * 1000 / 10) * 10)} m`;
  return `${distance.toFixed(1)} km`;
}

export async function publishPresence(userId, location, { visible = true, availability = 'available' } = {}) {
  if (!userId || ![location?.latitude, location?.longitude].every(Number.isFinite)) return;
  const now = new Date().toISOString();
  const { error } = await requireSupabase().from('player_presence').upsert({
    user_id: userId,
    latitude: location.latitude,
    longitude: location.longitude,
    is_visible: visible,
    availability,
    last_seen_at: now,
    updated_at: now,
  });
  if (error) throw error;
}

export async function stopPresence(userId, { disable = false } = {}) {
  if (!userId) return;
  const changes = { availability: 'offline', updated_at: new Date().toISOString() };
  if (disable) changes.is_visible = false;
  const { error } = await requireSupabase().from('player_presence').update(changes).eq('user_id', userId);
  if (error) throw error;
}

export async function listNearbyOnlinePlayers(location, radiusKm = 25) {
  if (![location?.latitude, location?.longitude].every(Number.isFinite)) return [];
  const { data, error } = await requireSupabase().rpc('nearby_online_players', {
    p_latitude: location.latitude,
    p_longitude: location.longitude,
    p_radius_km: radiusKm,
  });
  if (error) throw error;
  return (data || []).map((player) => ({
    id: player.id,
    name: player.display_name,
    avatar: player.avatar_url,
    initials: initials(player.display_name),
    rating: player.skill_rating ?? 'Unrated',
    distanceKm: player.distance_km,
    distance: distanceLabel(player.distance_km),
    availability: player.availability,
    lastSeenAt: player.last_seen_at,
    color: '#1C6B66',
  }));
}

export async function sendMatchInvite(recipientId, matchPayload) {
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw authError || new Error('Sign in to invite a player.');
  const { data, error } = await client.rpc('send_match_invite', { p_recipient_id: recipientId, p_match_payload: matchPayload });
  if (error) throw error;
  return data;
}

export async function listMatchInvites() {
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return { incoming: [], outgoing: [] };
  const cutoff = new Date(Date.now() - INVITE_WINDOW_MS).toISOString();
  const [incomingResult, outgoingResult] = await Promise.all([
    client.from('match_invites')
      .select('*, sender:profiles!match_invites_sender_id_fkey(id, display_name, avatar_url, skill_rating)')
      .eq('recipient_id', auth.user.id).eq('status', 'pending').gte('created_at', cutoff).order('created_at', { ascending: false }),
    client.from('match_invites')
      .select('*, recipient:profiles!match_invites_recipient_id_fkey(id, display_name, avatar_url, skill_rating)')
      .eq('sender_id', auth.user.id).gte('created_at', cutoff).order('created_at', { ascending: false }),
  ]);
  const error = incomingResult.error || outgoingResult.error;
  if (error) throw error;
  return { incoming: incomingResult.data || [], outgoing: outgoingResult.data || [] };
}

export async function respondToMatchInvite(inviteId, accept) {
  const { data, error } = await requireSupabase().rpc('respond_match_invite', { p_invite_id: inviteId, p_accept: accept });
  if (error) throw error;
  return data;
}

export async function cancelMatchInvite(inviteId) {
  const { data, error } = await requireSupabase().rpc('cancel_match_invite', { p_invite_id: inviteId });
  if (error) throw error;
  return data;
}
