import { supabase } from '../lib/supabase';

// Another player's chat-safety setup and follow changes live behind RLS, so
// postgres_changes never reaches the people watching them. A broadcast ping on
// the player's topic tells open chats and inboxes to re-check instead. The
// ping carries no data: receivers always re-read through the normal RPCs.
const topicFor = (playerId) => `player-status-${playerId}`;

// supabase.channel() hands back the same channel for a topic, so share one
// subscription per player and only tear it down when the last watcher leaves.
const watched = new Map();

// Pings the signed-in player's own topic plus any others passed in. Never
// throws: a missed ping only delays the other side until its next check.
export async function announcePlayerStatusChange(...otherPlayerIds) {
  if (!supabase) return;
  let ownId = null;
  try {
    const { data } = await supabase.auth.getSession();
    ownId = data.session?.user?.id || null;
  } catch {
    // Still ping the other players.
  }
  const playerIds = [ownId, ...otherPlayerIds];
  const ids = [...new Set(playerIds.filter(Boolean))];
  await Promise.all(ids.map(async (playerId) => {
    const shared = watched.get(playerId)?.channel;
    const channel = shared || supabase.channel(topicFor(playerId));
    try {
      await channel.httpSend('changed', { at: Date.now() });
    } catch {
      // Best effort: watchers still fall back to focus and interval checks.
    } finally {
      if (!shared) supabase.removeChannel(channel);
    }
  }));
}

export function subscribePlayerStatus(playerId, onChange) {
  if (!supabase || !playerId) return () => {};
  let entry = watched.get(playerId);
  if (!entry) {
    const listeners = new Set();
    const channel = supabase.channel(topicFor(playerId))
      .on('broadcast', { event: 'changed' }, () => listeners.forEach((listener) => listener()))
      .subscribe();
    entry = { channel, listeners };
    watched.set(playerId, entry);
  }
  let timer;
  const listener = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  };
  entry.listeners.add(listener);
  return () => {
    clearTimeout(timer);
    entry.listeners.delete(listener);
    if (!entry.listeners.size && watched.get(playerId) === entry) {
      watched.delete(playerId);
      supabase.removeChannel(entry.channel);
    }
  };
}
