import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';
import { buildDemoLeaderboard } from '../config/demoData';

const PAGE_SIZE = 50;

function rankedRows(rows) {
  let lastRating = null;
  let lastRank = 0;
  return (rows || []).map((row, index) => {
    const rating = Number(row.rating);
    if (rating !== lastRating) {
      lastRating = rating;
      lastRank = index + 1;
    }
    return {
      id: row.user_id,
      name: row.profile?.display_name || 'Peakle player',
      avatar: row.profile?.avatar_url || null,
      area: row.profile?.home_area || '',
      rating,
      verifiedMatches: Number(row.verified_matches || 0),
      wins: Number(row.wins || 0),
      losses: Number(row.losses || 0),
      rank: lastRank,
    };
  });
}

/**
 * Loads only genuine, verified competitive ratings. Visibility is enforced by
 * the player_ratings RLS policy, so private players never enter the standings.
 */
export async function loadLeaderboard({ format = 'doubles', scope = 'local' } = {}) {
  if (DEMO_MODE) return buildDemoLeaderboard({ format, scope });
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error('Sign in to view the leaderboard.');

  const userId = auth.user.id;
  const [{ data: profile, error: profileError }, { data: ownRating, error: ownError }] = await Promise.all([
    client.from('profiles').select('id,display_name,avatar_url,home_area').eq('id', userId).single(),
    client.from('player_ratings').select('user_id,format,rating,verified_matches,wins,losses,updated_at').eq('user_id', userId).eq('format', format).maybeSingle(),
  ]);
  if (profileError) throw profileError;
  if (ownError) throw ownError;

  const effectiveScope = scope === 'local' && profile?.home_area ? 'local' : 'global';
  const ratingFields = effectiveScope === 'local'
    ? 'user_id,format,rating,verified_matches,wins,losses,updated_at,profile:profiles!player_ratings_user_id_fkey!inner(id,display_name,avatar_url,home_area)'
    : 'user_id,format,rating,verified_matches,wins,losses,updated_at,profile:profiles!player_ratings_user_id_fkey(id,display_name,avatar_url,home_area)';

  let standingsQuery = client
    .from('player_ratings')
    .select(ratingFields)
    .eq('format', format)
    .gt('verified_matches', 0)
    .order('rating', { ascending: false })
    .order('verified_matches', { ascending: false })
    .limit(PAGE_SIZE);
  if (effectiveScope === 'local') standingsQuery = standingsQuery.eq('profile.home_area', profile.home_area);

  const { data: rows, error: standingsError } = await standingsQuery;
  if (standingsError) throw standingsError;
  const standings = rankedRows(rows);

  let userRank = null;
  if (ownRating?.verified_matches > 0) {
    let higherQuery = client
      .from('player_ratings')
      .select(
        effectiveScope === 'local'
          ? 'user_id,profile:profiles!player_ratings_user_id_fkey!inner(home_area)'
          : 'user_id',
        { count: 'exact', head: true },
      )
      .eq('format', format)
      .gt('verified_matches', 0)
      .gt('rating', ownRating.rating);
    if (effectiveScope === 'local') higherQuery = higherQuery.eq('profile.home_area', profile.home_area);
    const { count, error: rankError } = await higherQuery;
    if (rankError) throw rankError;
    userRank = Number(count || 0) + 1;
  }

  return {
    format,
    scope: effectiveScope,
    area: effectiveScope === 'local' ? profile.home_area : '',
    homeArea: profile?.home_area || '',
    standings,
    user: {
      id: userId,
      name: profile?.display_name || 'Player',
      avatar: profile?.avatar_url || null,
      rating: ownRating ? Number(ownRating.rating) : null,
      verifiedMatches: Number(ownRating?.verified_matches || 0),
      wins: Number(ownRating?.wins || 0),
      losses: Number(ownRating?.losses || 0),
      rank: userRank,
    },
  };
}
