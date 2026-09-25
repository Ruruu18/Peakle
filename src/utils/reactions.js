/**
 * Local mirror of the server reaction toggles so a tap updates the bubble
 * immediately instead of waiting for the RPC and the follow-up fetch.
 *
 * singlePerUser matches toggle_direct_message_reaction (one reaction per
 * person, choosing another replaces it); otherwise it matches
 * toggle_team_message_reaction (each emoji toggles independently).
 */
export function toggleOwnReaction(reactions = [], userId, emoji, { singlePerUser = false } = {}) {
  const hadEmoji = reactions.some((reaction) => reaction.user_id === userId && reaction.emoji === emoji);
  const kept = reactions.filter((reaction) => reaction.user_id !== userId || (!singlePerUser && reaction.emoji !== emoji));
  return hadEmoji ? kept : [...kept, { user_id: userId, emoji }];
}

/**
 * Tracks in-flight reaction toggles per message. While a message has pending
 * toggles, server snapshots (RPC results, realtime refetches) may be older than
 * what the user sees, so only the snapshot from the last toggle is applied.
 */
export function createReactionTracker() {
  const pending = {};
  return {
    start(messageId) { pending[messageId] = (pending[messageId] || 0) + 1; },
    finish(messageId) {
      pending[messageId] = Math.max(0, (pending[messageId] || 0) - 1);
      const settled = pending[messageId] === 0;
      if (settled) delete pending[messageId];
      return settled;
    },
    isPending(messageId) { return Boolean(pending[messageId]); },
  };
}
