import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';

// Thumbs up/down on "coming soon" teasers. vote: 1, -1, or null to clear.

async function currentUserId(client) {
  const { data } = await client.auth.getSession();
  return data?.session?.user?.id || null;
}

export async function getFeatureVote(feature) {
  if (DEMO_MODE) return null;
  const client = requireSupabase();
  const userId = await currentUserId(client);
  if (!userId) return null;
  const { data, error } = await client.from('feature_interest').select('vote').eq('user_id', userId).eq('feature', feature).maybeSingle();
  if (error) throw error;
  return data?.vote ?? null;
}

export async function setFeatureVote(feature, vote) {
  if (DEMO_MODE) return;
  const client = requireSupabase();
  const userId = await currentUserId(client);
  if (!userId) throw new Error('Sign in to vote.');
  const query = vote == null
    ? client.from('feature_interest').delete().eq('user_id', userId).eq('feature', feature)
    : client.from('feature_interest').upsert({ user_id: userId, feature, vote, updated_at: new Date().toISOString() }, { onConflict: 'user_id,feature' });
  const { error } = await query;
  if (error) throw error;
}
