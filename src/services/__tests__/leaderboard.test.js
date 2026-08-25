import { requireSupabase } from '../../lib/supabase';
import { loadLeaderboard } from '../leaderboard';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

// A minimal, chainable Postgrest-style query-builder mock. Every filter
// method records its call and returns the same builder (so it supports any
// chain length), and the builder is itself awaitable/`.single()`-able,
// resolving to the configured `result` no matter which method it is awaited
// from - exactly like the real supabase-js query builder.
function makeQuery(result) {
  const calls = [];
  const builder = {};
  ['select', 'eq', 'gt', 'lt', 'order', 'limit', 'in', 'or', 'not'].forEach((method) => {
    builder[method] = (...args) => {
      calls.push([method, args]);
      return builder;
    };
  });
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return { builder, calls };
}

function buildLeaderboardClient({
  authUser = { id: 'u1' },
  authError = null,
  profile = { id: 'u1', display_name: 'Ana', avatar_url: null, home_area: 'Makati' },
  profileError = null,
  ownRating = null,
  ownError = null,
  standingsRows = [],
  standingsError = null,
  count = 0,
  countError = null,
} = {}) {
  const profileQuery = makeQuery({ data: profile, error: profileError });
  const ownQuery = makeQuery({ data: ownRating, error: ownError });
  const standingsQuery = makeQuery({ data: standingsRows, error: standingsError });
  const higherQuery = makeQuery({ count, error: countError });

  const from = jest.fn()
    .mockImplementationOnce(() => profileQuery.builder)
    .mockImplementationOnce(() => ownQuery.builder)
    .mockImplementationOnce(() => standingsQuery.builder)
    .mockImplementationOnce(() => higherQuery.builder);

  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: authUser }, error: authError })) },
    from,
    _queries: { profileQuery, ownQuery, standingsQuery, higherQuery },
  };
}

describe('loadLeaderboard - auth guard', () => {
  it('propagates an auth lookup error', async () => {
    const client = buildLeaderboardClient({ authError: new Error('auth down') });
    requireSupabase.mockReturnValue(client);
    await expect(loadLeaderboard()).rejects.toThrow('auth down');
  });

  it('throws a sign-in error when nobody is signed in', async () => {
    const client = buildLeaderboardClient({ authUser: null });
    requireSupabase.mockReturnValue(client);
    await expect(loadLeaderboard()).rejects.toThrow('Sign in to view the leaderboard.');
  });
});

describe('loadLeaderboard - profile/own-rating errors', () => {
  it('propagates a profile fetch error', async () => {
    const client = buildLeaderboardClient({ profileError: new Error('profile denied') });
    requireSupabase.mockReturnValue(client);
    await expect(loadLeaderboard()).rejects.toThrow('profile denied');
  });

  it('propagates an own-rating fetch error', async () => {
    const client = buildLeaderboardClient({ ownError: new Error('rating denied') });
    requireSupabase.mockReturnValue(client);
    await expect(loadLeaderboard()).rejects.toThrow('rating denied');
  });
});

describe('loadLeaderboard - scope resolution', () => {
  it('scopes to local standings and filters by home area when the profile has one', async () => {
    const client = buildLeaderboardClient({ standingsRows: [] });
    requireSupabase.mockReturnValue(client);
    const result = await loadLeaderboard({ format: 'doubles', scope: 'local' });
    expect(result.scope).toBe('local');
    expect(result.area).toBe('Makati');
    const calls = client._queries.standingsQuery.calls;
    expect(calls[0]).toEqual(['select', [expect.stringContaining('!inner')]]);
    expect(calls).toEqual(expect.arrayContaining([['eq', ['profile.home_area', 'Makati']]]));
  });

  it('falls back to global scope when "local" is requested but the profile has no home area', async () => {
    const client = buildLeaderboardClient({
      profile: { id: 'u1', display_name: 'Ana', avatar_url: null, home_area: null },
      standingsRows: [],
    });
    requireSupabase.mockReturnValue(client);
    const result = await loadLeaderboard({ scope: 'local' });
    expect(result.scope).toBe('global');
    expect(result.area).toBe('');
    const calls = client._queries.standingsQuery.calls;
    expect(calls.find(([name, args]) => name === 'eq' && args[0] === 'profile.home_area')).toBeUndefined();
    expect(calls[0]).toEqual(['select', [expect.not.stringContaining('!inner')]]);
  });

  it('uses global scope when explicitly requested, even with a home area on file', async () => {
    const client = buildLeaderboardClient({ standingsRows: [] });
    requireSupabase.mockReturnValue(client);
    const result = await loadLeaderboard({ scope: 'global' });
    expect(result.scope).toBe('global');
  });
});

describe('loadLeaderboard - rankedRows ranking behavior', () => {
  it('assigns standard competition ranks: ties share a rank and the next rank skips ahead (1,2,2,4)', async () => {
    const rows = [
      { user_id: 'a', rating: 5, verified_matches: 10, wins: 5, losses: 0, profile: { display_name: 'A' } },
      { user_id: 'b', rating: 4, verified_matches: 8, wins: 4, losses: 1, profile: { display_name: 'B' } },
      { user_id: 'c', rating: 4, verified_matches: 8, wins: 4, losses: 1, profile: { display_name: 'C' } },
      { user_id: 'd', rating: 3, verified_matches: 6, wins: 3, losses: 2, profile: { display_name: 'D' } },
    ];
    const client = buildLeaderboardClient({ standingsRows: rows });
    requireSupabase.mockReturnValue(client);
    const { standings } = await loadLeaderboard();
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 2, 4]);
    expect(standings.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ranks strictly by input position rather than re-sorting the rows by rating', async () => {
    const rows = [
      { user_id: 'a', rating: 3, profile: {} },
      { user_id: 'b', rating: 5, profile: {} },
      { user_id: 'c', rating: 4, profile: {} },
    ];
    const client = buildLeaderboardClient({ standingsRows: rows });
    requireSupabase.mockReturnValue(client);
    const { standings } = await loadLeaderboard();
    expect(standings.map((s) => ({ id: s.id, rank: s.rank }))).toEqual([
      { id: 'a', rank: 1 },
      { id: 'b', rank: 2 },
      { id: 'c', rank: 3 },
    ]);
  });

  it('tolerates null standings data, returning an empty array instead of throwing', async () => {
    const client = buildLeaderboardClient({ standingsRows: null });
    requireSupabase.mockReturnValue(client);
    const { standings } = await loadLeaderboard();
    expect(standings).toEqual([]);
  });

  it('tolerates an empty standings array', async () => {
    const client = buildLeaderboardClient({ standingsRows: [] });
    requireSupabase.mockReturnValue(client);
    const { standings } = await loadLeaderboard();
    expect(standings).toEqual([]);
  });

  it('fills in sensible defaults when a row has no linked profile, and coerces numeric fields', async () => {
    const rows = [{ user_id: 'x', rating: '4.5', profile: null }];
    const client = buildLeaderboardClient({ standingsRows: rows });
    requireSupabase.mockReturnValue(client);
    const { standings } = await loadLeaderboard();
    expect(standings[0]).toMatchObject({
      id: 'x', name: 'Peakle player', avatar: null, area: '', rating: 4.5, verifiedMatches: 0, wins: 0, losses: 0, rank: 1,
    });
  });

  it('propagates a standings query error', async () => {
    const client = buildLeaderboardClient({ standingsError: new Error('standings denied') });
    requireSupabase.mockReturnValue(client);
    await expect(loadLeaderboard()).rejects.toThrow('standings denied');
  });

  it('limits the standings page to PAGE_SIZE (50)', async () => {
    const client = buildLeaderboardClient({ standingsRows: [] });
    requireSupabase.mockReturnValue(client);
    await loadLeaderboard();
    expect(client._queries.standingsQuery.calls).toEqual(expect.arrayContaining([['limit', [50]]]));
  });
});

describe('loadLeaderboard - user rank', () => {
  it("computes the caller's rank as one plus the count of higher-rated players, only when they have verified matches", async () => {
    const client = buildLeaderboardClient({
      ownRating: { user_id: 'u1', rating: 4, verified_matches: 5, wins: 3, losses: 2 },
      count: 7,
    });
    requireSupabase.mockReturnValue(client);
    const { user } = await loadLeaderboard();
    expect(user.rank).toBe(8);
    expect(user.rating).toBe(4);
    expect(user.verifiedMatches).toBe(5);
  });

  it('leaves the rank null and skips the extra rank query entirely when the caller has no verified matches', async () => {
    const client = buildLeaderboardClient({ ownRating: null });
    requireSupabase.mockReturnValue(client);
    const { user } = await loadLeaderboard();
    expect(user.rank).toBeNull();
    expect(client.from).toHaveBeenCalledTimes(3);
  });

  it('propagates an error from the rank-count query', async () => {
    const client = buildLeaderboardClient({
      ownRating: { rating: 4, verified_matches: 3 },
      countError: new Error('count denied'),
    });
    requireSupabase.mockReturnValue(client);
    await expect(loadLeaderboard()).rejects.toThrow('count denied');
  });

  it('also scopes the rank-count query to the home area when local', async () => {
    const client = buildLeaderboardClient({
      ownRating: { rating: 4, verified_matches: 3 },
      count: 2,
    });
    requireSupabase.mockReturnValue(client);
    await loadLeaderboard({ scope: 'local' });
    expect(client._queries.higherQuery.calls).toEqual(expect.arrayContaining([['eq', ['profile.home_area', 'Makati']]]));
  });
});

describe('loadLeaderboard - format filtering and return shape', () => {
  it('filters by the given format on every ratings query, defaulting to doubles', async () => {
    const client = buildLeaderboardClient({ ownRating: { rating: 4, verified_matches: 1 } });
    requireSupabase.mockReturnValue(client);
    await loadLeaderboard({ format: 'singles' });
    expect(client._queries.ownQuery.calls).toEqual(expect.arrayContaining([['eq', ['format', 'singles']]]));
    expect(client._queries.standingsQuery.calls).toEqual(expect.arrayContaining([['eq', ['format', 'singles']]]));
    expect(client._queries.higherQuery.calls).toEqual(expect.arrayContaining([['eq', ['format', 'singles']]]));
  });

  it('defaults to doubles when no format is given', async () => {
    const client = buildLeaderboardClient({});
    requireSupabase.mockReturnValue(client);
    const result = await loadLeaderboard();
    expect(result.format).toBe('doubles');
    expect(client._queries.standingsQuery.calls).toEqual(expect.arrayContaining([['eq', ['format', 'doubles']]]));
  });

  it('returns the caller profile fields alongside the standings and homeArea', async () => {
    const client = buildLeaderboardClient({});
    requireSupabase.mockReturnValue(client);
    const result = await loadLeaderboard();
    expect(result.homeArea).toBe('Makati');
    expect(result.user).toMatchObject({ id: 'u1', name: 'Ana', avatar: null, rating: null, verifiedMatches: 0, wins: 0, losses: 0, rank: null });
  });
});
