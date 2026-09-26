import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';

// Chat info data shared by private and team conversations: per-conversation
// nicknames (visible to everyone in the chat) and team chat mute.
// kind is 'direct' (conversation id) or 'team' (team id).

const schemaMissing = (error) => ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code);
const notReady = () => new Error('This feature is not available yet. Please try again after the next update.');

// Nicknames are optional: before the migration reaches a project every chat
// simply has none.
export async function listChatNicknames(kind, chatId) {
  if (DEMO_MODE || !chatId) return {};
  const { data, error } = await requireSupabase().from('chat_nicknames')
    .select('user_id, nickname')
    .eq('chat_kind', kind)
    .eq('chat_id', chatId);
  if (error) {
    if (schemaMissing(error)) return {};
    throw error;
  }
  return Object.fromEntries((data || []).map((row) => [row.user_id, row.nickname]));
}

// An empty nickname clears it. Returns the saved nickname or null.
export async function setChatNickname(kind, chatId, userId, nickname) {
  const next = nickname?.trim() || null;
  if (DEMO_MODE) return next;
  const { data, error } = await requireSupabase().rpc('set_chat_nickname', {
    p_kind: kind,
    p_chat_id: chatId,
    p_user_id: userId,
    p_nickname: next,
  });
  if (error) throw schemaMissing(error) ? notReady() : error;
  return data || null;
}

export async function getTeamChatMutedUntil(teamId) {
  if (DEMO_MODE || !teamId) return null;
  const { data, error } = await requireSupabase().from('team_chat_settings')
    .select('muted_until')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) {
    if (schemaMissing(error)) return null;
    throw error;
  }
  return data?.muted_until || null;
}

// Team ids this player has muted, with their muted_until value.
export async function listTeamChatMutes() {
  if (DEMO_MODE) return {};
  const { data, error } = await requireSupabase().from('team_chat_settings')
    .select('team_id, muted_until')
    .not('muted_until', 'is', null);
  if (error) {
    if (schemaMissing(error)) return {};
    throw error;
  }
  return Object.fromEntries((data || []).map((row) => [row.team_id, row.muted_until]));
}

// minutes: a number for a timed mute, null to mute until turned back on.
export async function muteTeamChat(teamId, minutes = null) {
  if (DEMO_MODE) return minutes == null ? 'infinity' : new Date(Date.now() + minutes * 60000).toISOString();
  const { data, error } = await requireSupabase().rpc('set_team_chat_muted', {
    p_team_id: teamId,
    p_muted: true,
    p_minutes: minutes,
  });
  if (error) throw schemaMissing(error) ? notReady() : error;
  return data || null;
}

export async function unmuteTeamChat(teamId) {
  if (DEMO_MODE) return null;
  const { error } = await requireSupabase().rpc('set_team_chat_muted', { p_team_id: teamId, p_muted: false });
  if (error) throw schemaMissing(error) ? notReady() : error;
  return null;
}
