import { requireSupabase } from '../../lib/supabase';
import { loadLeaderboard, loadTeamLeaderboard, unrankedHint } from '../leaderboard';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

function buildLeaderboardClient({
  authUser = { id: 'u1' },
  authError = null,
  profile = { id: 'u1', display_name: 'Ana', avatar_url: null, home_area: 'Makati' },
  profileError = null,
  board = { scope: 'local', area: 'Makati', standings: [], own: null },
  boardError = null,
} = {}) {
  const profileQuery = { select: () => profileQuery, eq: () => profileQuery, single: async () => ({ data: profile, error: profileError }) };
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: authUser }, error: authError })) },
    from: jest.fn(() => profileQuery),
    rpc: jest.fn(async () => ({ data: board, error: boardError })),
  };
}

describe('loadLeaderboard - auth guard', () => {
  it('propagates an auth lookup error', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({ authError: new Error('auth down') }));
    await expect(loadLeaderboard()).rejects.toThrow('auth down');
  });

  it('throws a sign-in error when nobody is signed in', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({ authUser: null }));
    await expect(loadLeaderboard()).rejects.toThrow('Sign in to view the leaderboard.');
  });
});

describe('loadLeaderboard - errors', () => {
  it('propagates a profile fetch error', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({ profileError: new Error('profile denied') }));
    await expect(loadLeaderboard()).rejects.toThrow('profile denied');
  });

  it('propagates a standings RPC error', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({ boardError: new Error('standings denied') }));
    await expect(loadLeaderboard()).rejects.toThrow('standings denied');
  });
});

describe('loadLeaderboard - RPC request and scope', () => {
  it('requests the given format and scope with a 50-row page', async () => {
    const client = buildLeaderboardClient();
    requireSupabase.mockReturnValue(client);
    await loadLeaderboard({ format: 'singles', scope: 'global' });
    expect(client.rpc).toHaveBeenCalledWith('get_player_leaderboard', { p_format: 'singles', p_scope: 'global', p_limit: 50 });
  });

  it('defaults to local doubles', async () => {
    const client = buildLeaderboardClient();
    requireSupabase.mockReturnValue(client);
    const result = await loadLeaderboard();
    expect(result.format).toBe('doubles');
    expect(client.rpc).toHaveBeenCalledWith('get_player_leaderboard', { p_format: 'doubles', p_scope: 'local', p_limit: 50 });
  });

  it('reports the scope and area the server resolved', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({ board: { scope: 'local', area: 'Makati', standings: [], own: null } }));
    await expect(loadLeaderboard({ scope: 'local' })).resolves.toMatchObject({ scope: 'local', area: 'Makati', homeArea: 'Makati' });
  });

  it('reports global when the server falls back because there is no home area', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({
      profile: { id: 'u1', display_name: 'Ana', avatar_url: null, home_area: null },
      board: { scope: 'global', area: '', standings: [], own: null },
    }));
    await expect(loadLeaderboard({ scope: 'local' })).resolves.toMatchObject({ scope: 'global', area: '', homeArea: '' });
  });
});

describe('loadLeaderboard - standings mapping', () => {
  it('maps rows with server ranks, keeping ties', async () => {
    const standings = [
      { user_id: 'a', display_name: 'A', rating: 5, verified_matches: 10, wins: 5, losses: 0, rank: 1 },
      { user_id: 'b', display_name: 'B', rating: 4, verified_matches: 8, wins: 4, losses: 1, rank: 2 },
      { user_id: 'c', display_name: 'C', rating: 4, verified_matches: 8, wins: 4, losses: 1, rank: 2 },
    ];
    requireSupabase.mockReturnValue(buildLeaderboardClient({ board: { scope: 'global', area: '', standings, own: null } }));
    const result = await loadLeaderboard();
    expect(result.standings.map((s) => [s.id, s.rank])).toEqual([['a', 1], ['b', 2], ['c', 2]]);
  });

  it('fills in defaults and coerces numeric fields', async () => {
    const standings = [{ user_id: 'x', rating: '4.5', rank: '1' }];
    requireSupabase.mockReturnValue(buildLeaderboardClient({ board: { scope: 'global', standings, own: null } }));
    const result = await loadLeaderboard();
    expect(result.standings[0]).toEqual({
      id: 'x', name: 'Peakle player', avatar: null, area: '', rating: 4.5, verifiedMatches: 0, wins: 0, losses: 0, rank: 1,
    });
  });

  it('tolerates a null payload', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({ board: null }));
    const result = await loadLeaderboard();
    expect(result.standings).toEqual([]);
    expect(result.scope).toBe('global');
  });
});

describe('loadLeaderboard - caller summary', () => {
  it("returns the caller's rating and server-computed rank", async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({
      board: { scope: 'local', area: 'Makati', standings: [], own: { rating: '4', verified_matches: 5, wins: 3, losses: 2, rank: 8, recorded_matches: 9, pending_matches: 1 } },
    }));
    const { user } = await loadLeaderboard();
    expect(user).toEqual({ id: 'u1', name: 'Ana', avatar: null, rating: 4, verifiedMatches: 5, wins: 3, losses: 2, rank: 8, recordedMatches: 9, pendingMatches: 1 });
  });

  it('leaves the rank null when the caller has no verified matches', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient({
      board: { scope: 'local', area: 'Makati', standings: [], own: { rating: 3, verified_matches: 0, wins: 0, losses: 0, rank: null } },
    }));
    const { user } = await loadLeaderboard();
    expect(user.rank).toBeNull();
  });

  it('returns an unrated caller when they have no rating row', async () => {
    requireSupabase.mockReturnValue(buildLeaderboardClient());
    const { user } = await loadLeaderboard();
    expect(user).toMatchObject({ id: 'u1', name: 'Ana', rating: null, verifiedMatches: 0, wins: 0, losses: 0, rank: null });
  });
});

describe('unrankedHint', () => {
  it('points to pending confirmations first', () => {
    expect(unrankedHint({ recordedMatches: 4, pendingMatches: 1 })).toMatch(/^1 ranked match waiting for the other players to confirm/);
    expect(unrankedHint({ recordedMatches: 4, pendingMatches: 2 })).toMatch(/^2 ranked matches waiting/);
  });

  it('explains why recorded matches have not ranked the player', () => {
    expect(unrankedHint({ recordedMatches: 3, pendingMatches: 0 })).toMatch(/^3 recorded matches · 0 verified\. Only Ranked matches against a registered player count/);
    expect(unrankedHint({ recordedMatches: 1 })).toMatch(/^1 recorded match · 0 verified/);
  });

  it('gives the first step to a player with no matches', () => {
    expect(unrankedHint({})).toBe('Play a Ranked match against a registered player. It counts once they confirm the score.');
    expect(unrankedHint(null)).toMatch(/^Play a Ranked match/);
  });
});

describe('loadTeamLeaderboard', () => {
  it('maps public standings and the caller\'s own teams from the RPC', async () => {
    const rpc = jest.fn(async () => ({
      data: {
        standings: [{ id: 't1', name: 'Dink Dynasty', tag: 'DINK', image_url: 'x.png', location: 'Makati', wins: 5, losses: 1, matches: 6, rank: 1, is_member: true }],
        mine: [{ id: 't2', name: 'Private Crew', tag: 'PRV', wins: 2, losses: 0, matches: 2, rank: null, is_discoverable: false }],
      },
      error: null,
    }));
    requireSupabase.mockReturnValue({ rpc });

    const result = await loadTeamLeaderboard();

    expect(rpc).toHaveBeenCalledWith('get_team_leaderboard', { p_limit: 50 });
    expect(result.standings[0]).toMatchObject({ id: 't1', avatar: 'x.png', area: 'Makati', wins: 5, losses: 1, matches: 6, rank: 1, isMember: true, isPublic: true });
    expect(result.mine[0]).toMatchObject({ id: 't2', rank: null, isPublic: false, wins: 2 });
  });

  it('returns empty lists when nobody has results', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: { standings: [], mine: [] }, error: null })) });
    await expect(loadTeamLeaderboard()).resolves.toEqual({ standings: [], mine: [] });
  });

  it('surfaces RPC errors', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('boom') })) });
    await expect(loadTeamLeaderboard()).rejects.toThrow('boom');
  });
});
