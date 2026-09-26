import { requireSupabase } from '../lib/supabase';
import { DEMO_MODE } from '../config/demoMode';
import { buildDemoLeaderboard } from '../config/demoData';

const PAGE_SIZE = 50;

// Set EXPO_PUBLIC_DEMO_LEADERBOARD=1 (e.g. in .env.local) to preview the
// leaderboard with fake standings while staying signed in as yourself.
const DEMO_LEADERBOARD = process.env.EXPO_PUBLIC_DEMO_LEADERBOARD === '1';

const PREVIEW_NAMES = [
  'Marcus Webb', 'Priya Shah', 'Diego Ramirez', 'Aisha Bello', 'Sam Whitfield',
  'Lena Ostrowski', 'Chris Nakamura', 'Rosa Fontaine', 'Tobias Kwan', 'Mika Santos',
  'Noah Castillo', 'Ivy Tran', 'Ben Adeyemi', 'Carla Reyes', 'Jonah Pierce',
  'Hana Mori', 'Leo Villanueva', 'Grace Okafor', 'Rafael Cruz', 'Zoe Lindqvist',
];

async function buildPreviewLeaderboard({ format, scope }) {
  let user = { id: 'preview-you', name: 'You', avatar: null, area: 'Makati' };
  try {
    const client = requireSupabase();
    const { data: auth } = await client.auth.getUser();
    if (auth?.user) {
      const { data: profile } = await client.from('profiles').select('display_name,avatar_url,home_area').eq('id', auth.user.id).maybeSingle();
      user = {
        id: auth.user.id,
        name: profile?.display_name || 'Player',
        avatar: profile?.avatar_url || null,
        area: profile?.home_area || 'Makati',
      };
    }
  } catch {
    // Fall back to the anonymous preview player.
  }

  const local = scope === 'local';
  const offset = format === 'singles' ? 7 : 0;
  const count = local ? 12 : 20;
  const globalAreas = ['Makati', 'Quezon City', 'Pasig', 'Cebu City', 'Taguig', 'Davao City'];
  const players = Array.from({ length: count }, (_, index) => {
    const verifiedMatches = 34 - index - (offset % 5);
    const wins = Math.max(1, Math.round(verifiedMatches * (0.82 - index * 0.025)));
    return {
      id: `preview-${format}-${index}`,
      name: PREVIEW_NAMES[(index + offset) % PREVIEW_NAMES.length],
      avatar: null,
      area: local ? user.area : globalAreas[index % globalAreas.length],
      rating: Number((1720 - index * 17.35 - offset * 3.1).toFixed(3)),
      verifiedMatches,
      wins,
      losses: verifiedMatches - wins,
    };
  });

  const youIndex = local ? 4 : 9;
  const you = {
    ...players[youIndex],
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    area: user.area,
  };
  players[youIndex] = you;
  const standings = players.map((player, index) => ({ ...player, rank: index + 1 }));

  return {
    format,
    scope,
    area: local ? user.area : '',
    homeArea: user.area,
    standings,
    user: { ...you, rank: youIndex + 1 },
  };
}

function standingRow(row) {
  return {
    id: row.user_id,
    name: row.display_name || 'Peakle player',
    avatar: row.avatar_url || null,
    // Home areas are "City · Region · Country" (or a legacy bare city); rows show the city.
    area: (row.home_area || '').split(' · ')[0].trim(),
    rating: Number(row.rating),
    verifiedMatches: Number(row.verified_matches || 0),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    rank: Number(row.rank),
  };
}

/**
 * Loads only genuine, verified competitive ratings. Standings come from the
 * get_player_leaderboard RPC, which lists everyone with verified matches
 * except players whose profile is set to "Only me".
 */
export async function loadLeaderboard({ format = 'doubles', scope = 'local' } = {}) {
  if (DEMO_MODE) return buildDemoLeaderboard({ format, scope });
  if (DEMO_LEADERBOARD) return buildPreviewLeaderboard({ format, scope });
  const client = requireSupabase();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error('Sign in to view the leaderboard.');

  const userId = auth.user.id;
  const [{ data: profile, error: profileError }, { data: board, error: boardError }] = await Promise.all([
    client.from('profiles').select('id,display_name,avatar_url,home_area').eq('id', userId).single(),
    client.rpc('get_player_leaderboard', { p_format: format, p_scope: scope, p_limit: PAGE_SIZE }),
  ]);
  if (profileError) throw profileError;
  if (boardError) throw boardError;

  const own = board?.own || null;
  return {
    format,
    scope: board?.scope === 'local' ? 'local' : 'global',
    area: board?.area || '',
    homeArea: profile?.home_area || '',
    standings: (board?.standings || []).map(standingRow),
    user: {
      id: userId,
      name: profile?.display_name || 'Player',
      avatar: profile?.avatar_url || null,
      rating: own?.rating == null ? null : Number(own.rating),
      verifiedMatches: Number(own?.verified_matches || 0),
      wins: Number(own?.wins || 0),
      losses: Number(own?.losses || 0),
      rank: own?.rank == null ? null : Number(own.rank),
      recordedMatches: Number(own?.recorded_matches || 0),
      pendingMatches: Number(own?.pending_matches || 0),
    },
  };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 'es'}`;

/**
 * Explains why an unranked player is not on the board. Saved matches build the
 * profile record, but only Ranked matches against a registered opponent that
 * every registered player confirmed move the leaderboard rating.
 */
export function unrankedHint(player) {
  const pending = Number(player?.pendingMatches || 0);
  const recorded = Number(player?.recordedMatches || 0);
  if (pending > 0) return `${plural(pending, 'ranked match')} waiting for the other players to confirm the score. You'll be ranked once they do.`;
  if (recorded > 0) return `${plural(recorded, 'recorded match')} · 0 verified. Only Ranked matches against a registered player count, once they confirm the score.`;
  return 'Play a Ranked match against a registered player. It counts once they confirm the score.';
}

const PREVIEW_TEAMS = [
  ['Dink Dynasty', 'DINK'], ['Kitchen Kings', 'KTCH'], ['Third Shot Crew', '3RD'], ['Erne Squad', 'ERNE'],
  ['Baseline Bandits', 'BASE'], ['Net Rushers', 'NET'], ['Drop Zone', 'DROP'], ['Lob City', 'LOB'],
];

function teamRow(row) {
  return {
    id: row.id,
    name: row.name || 'Peakle team',
    tag: row.tag || '',
    avatar: row.image_url || null,
    area: row.location || '',
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    matches: Number(row.matches || 0),
    rank: row.rank == null ? null : Number(row.rank),
    isMember: Boolean(row.is_member),
    isPublic: row.is_discoverable !== false,
  };
}

function buildPreviewTeamLeaderboard() {
  const standings = PREVIEW_TEAMS.map(([name, tag], index) => {
    const matches = 14 - index;
    const wins = Math.max(1, matches - 2 - index);
    return teamRow({ id: `preview-team-${index}`, name, tag, wins, losses: matches - wins, matches, rank: index + 1, is_member: index === 2 });
  });
  return { standings, mine: [standings[2]] };
}

/**
 * Team standings from completed team-challenge matches. Only win–loss totals
 * of public teams are exposed; the caller's own teams come back in `mine`,
 * with a null rank when the team is private or has no results yet.
 */
export async function loadTeamLeaderboard() {
  if (DEMO_MODE || DEMO_LEADERBOARD) return buildPreviewTeamLeaderboard();
  const { data, error } = await requireSupabase().rpc('get_team_leaderboard', { p_limit: PAGE_SIZE });
  if (error) throw error;
  return {
    standings: (data?.standings || []).map(teamRow),
    mine: (data?.mine || []).map(teamRow),
  };
}
