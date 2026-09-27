// supabase.channel(name) hands back the existing channel with that name while
// it is still closing. An effect that re-subscribes (new dependencies, a chat
// reopened) then gets a channel that is about to be torn down, and stops
// receiving changes until the app is refreshed. Database-change subscriptions
// don't need a shared name, so each one gets its own. Broadcast channels
// (typing indicators) must keep a name every participant shares.
let sequence = 0;

export const uniqueTopic = (name) => `${name}:${(sequence += 1)}`;
