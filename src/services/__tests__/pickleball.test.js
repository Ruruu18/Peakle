import { requireSupabase } from '../../lib/supabase';
import { saveCompetitionCover } from '../organizerMedia';
import {
  loadPlayerPickleballHub,
  updatePickleballPrivacy,
  publishMatchRequest,
  claimMatchRequest,
  closeMatchRequest,
  closeOpenMatchRequests,
  confirmMatchResult,
  joinProgram,
  joinCompetition,
  loadCompetitionDivisionDetail,
  requestMembership,
  startMembershipCheckout,
  createTeamChallenge,
  respondTeamChallenge,
  getAcceptedTeamChallenges,
  getTeamMatch,
  startTeamMatch,
  handoffTeamMatchScorer,
  recordTeamMatchRally,
  undoTeamMatchRally,
  completeTeamMatchGame,
  completeTeamMatch,
  loadOrganizerPickleballHub,
  createVenueProgram,
  COMPETITION_FORMATS,
  COMPETITION_PARTICIPANT_DIVISIONS,
  COMPETITION_SKILL_CATEGORIES,
  COMPETITION_ENTRY_TYPES,
  createCompetition,
  seedTournamentBracket,
  reviewCompetitionEntry,
  updateCompetitionDetails,
  setCompetitionStatus,
  setCompetitionDivisionStatus,
  updateCompetitionDivisionDetails,
  scheduleCompetitionMatch,
  recordCompetitionMatchResult,
  createMembershipProduct,
  activateMembership,
  loadVenueAnalytics,
  venueAnalyticsCsv,
} from '../pickleball';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));
jest.mock('../organizerMedia', () => ({ saveCompetitionCover: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
});

// A minimal, chainable Postgrest-style query-builder mock: every method
// records its call and returns the same builder, and the builder itself
// resolves (via `.then`/`.single`/`.maybeSingle`) to the configured result -
// matching how the real supabase-js query builder behaves at any point in
// a chain.
function makeChain(result) {
  const calls = [];
  const chain = {};
  ['select', 'eq', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq', 'not', 'or', 'insert', 'update', 'upsert'].forEach((method) => {
    chain[method] = (...args) => {
      calls.push([method, args]);
      return chain;
    };
  });
  chain.single = async () => result;
  chain.maybeSingle = async () => result;
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  chain._calls = calls;
  return chain;
}

// Generic client builder. `tableResults` maps table name -> {data, error}
// (the result every chain off `client.from(table)` will resolve to).
function makeClient({ user = { id: 'u1' }, authError = null, tableResults = {}, rpc, invoke } = {}) {
  const fromCalls = [];
  const chainsByTable = {};
  const from = jest.fn((table) => {
    fromCalls.push(table);
    const result = tableResults[table] !== undefined ? tableResults[table] : { data: [], error: null };
    const chain = makeChain(result);
    chainsByTable[table] = chain;
    return chain;
  });
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user }, error: authError })) },
    from,
    rpc: rpc || jest.fn(async () => ({ data: null, error: null })),
    functions: { invoke: invoke || jest.fn(async () => ({ data: null, error: null })) },
    _fromCalls: fromCalls,
    _chainsByTable: chainsByTable,
  };
}

const MATCH_VERIFIED = {
  id: 'm1',
  match_type: 'doubles',
  verification_status: 'verified',
  ended_at: 't1',
  venue_id: 'v1',
  court_id: 'c1',
  venues: { name: 'Court Central' },
  courts: { name: 'Court 1' },
  match_participants: [
    { user_id: 'u1', side: 0, position: 0, profiles: { display_name: 'Ana' } },
    { user_id: 'p2', side: 0, position: 1, profiles: { display_name: 'Ben Cruz' } },
    { user_id: 'o1', side: 1, position: 0, profiles: { display_name: 'Opp1' } },
    { user_id: 'o2', side: 1, position: 1, profiles: { display_name: 'Opp2' } },
  ],
  match_games: [
    { home_score: 11, away_score: 5, winner_side: 0 },
    { home_score: 9, away_score: 11, winner_side: 1 },
    { home_score: 11, away_score: 7, winner_side: 0 },
  ],
  match_result_confirmations: [],
};

const MATCH_PENDING = {
  id: 'm2',
  match_type: 'singles',
  verification_status: 'pending',
  ended_at: 't2',
  venue_id: 'v1',
  court_id: 'c1',
  venues: { name: 'Court Central' },
  courts: { name: 'Court 1' },
  match_participants: [
    { user_id: 'u1', side: 0, position: 0, profiles: { display_name: 'Ana' } },
    { user_id: 'o3', side: 1, position: 0, profiles: { display_name: 'Opp3' } },
  ],
  match_games: [],
  match_result_confirmations: [],
};

describe('loadPlayerPickleballHub (currentUser + unwrap-style filtering)', () => {
  const profile = { id: 'u1', display_name: 'Ana', home_area: 'Makati', profile_visibility: 'public', availability_visibility: 'public', matching_enabled: true };

  it('throws a friendly sign-in error when there is no authenticated user', async () => {
    requireSupabase.mockReturnValue(makeClient({ user: null }));
    await expect(loadPlayerPickleballHub()).rejects.toThrow('Sign in to use competitive features.');
  });

  it('propagates the underlying auth error when the auth lookup itself fails', async () => {
    requireSupabase.mockReturnValue(makeClient({ authError: new Error('auth network error') }));
    await expect(loadPlayerPickleballHub()).rejects.toThrow('auth network error');
  });

  it('filters public-facing lists to verified+active venues and computes pendingResults and performance', async () => {
    const verifiedComp = { id: 'comp1', venues: { verification_status: 'verified', active: true } };
    const unverifiedComp = { id: 'comp2', venues: { verification_status: 'pending', active: true } };
    const client = makeClient({
      tableResults: {
        profiles: { data: profile, error: null },
        player_ratings: { data: [{ id: 'r1' }], error: null },
        matchmaking_posts: { data: [], error: null },
        competitions: { data: [verifiedComp, unverifiedComp], error: null },
        venue_programs: {
          data: [
            { id: 'p1', venues: { verification_status: 'verified', active: true } },
            { id: 'p2', venues: { verification_status: 'verified', active: false } },
          ],
          error: null,
        },
        player_memberships: { data: [{ id: 'mem1' }], error: null },
        membership_products: { data: [{ id: 'prod1', venues: { verification_status: 'verified', active: true } }], error: null },
        matches: { data: [MATCH_VERIFIED, MATCH_PENDING], error: null },
        team_challenges: { data: [{ id: 'ch1' }], error: null },
        teams: { data: [{ id: 'team1' }], error: null },
      },
    });
    requireSupabase.mockReturnValue(client);

    const hub = await loadPlayerPickleballHub();

    expect(hub.userId).toBe('u1');
    expect(hub.competitions).toEqual([verifiedComp]);
    expect(hub.programs).toEqual([{ id: 'p1', venues: { verification_status: 'verified', active: true } }]);
    expect(hub.products).toEqual([{ id: 'prod1', venues: { verification_status: 'verified', active: true } }]);
    expect(hub.pendingResults.map((m) => m.id)).toEqual(['m2']);
    expect(hub.performance).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'Format', label: 'doubles', played: 1, won: 1, winRate: 100 }),
      expect.objectContaining({ dimension: 'Venue', label: 'Court Central', played: 1, won: 1, winRate: 100 }),
      expect.objectContaining({ dimension: 'Court', label: 'Court 1', played: 1, won: 1, winRate: 100 }),
      expect.objectContaining({ dimension: 'Partner', label: 'Ben Cruz', played: 1, won: 1, winRate: 100 }),
      expect.objectContaining({ dimension: 'Opponent', label: 'Opp1', played: 1, won: 1, winRate: 100 }),
      expect.objectContaining({ dimension: 'Opponent', label: 'Opp2', played: 1, won: 1, winRate: 100 }),
    ]));
  });

  it('throws the first failing query error', async () => {
    const client = makeClient({
      tableResults: {
        profiles: { data: profile, error: null },
        player_ratings: { data: null, error: new Error('ratings denied') },
      },
    });
    requireSupabase.mockReturnValue(client);
    await expect(loadPlayerPickleballHub()).rejects.toThrow('ratings denied');
  });
});

describe('currentUser (exercised through publishMatchRequest)', () => {
  it('propagates the underlying auth error', async () => {
    requireSupabase.mockReturnValue(makeClient({ authError: new Error('token expired') }));
    await expect(publishMatchRequest({ kind: 'open', startsAt: 't1', area: 'Makati' })).rejects.toThrow('token expired');
  });

  it('throws a friendly sign-in error when there is no user', async () => {
    requireSupabase.mockReturnValue(makeClient({ user: null }));
    await expect(publishMatchRequest({ kind: 'open', startsAt: 't1', area: 'Makati' })).rejects.toThrow('Sign in to use competitive features.');
  });

  it('inserts the matchmaking post as the signed-in user once auth succeeds', async () => {
    const client = makeClient({ tableResults: { matchmaking_posts: { data: { id: 'post1' }, error: null } } });
    requireSupabase.mockReturnValue(client);
    const result = await publishMatchRequest({ kind: 'open', format: 'singles', startsAt: 't1', area: 'Makati', venueId: 'v1', minimumRating: 3, maximumRating: 5, note: 'hi', teamId: 't1' });
    expect(result).toEqual({ id: 'post1' });
  });

  it('propagates an insert error', async () => {
    const client = makeClient({ tableResults: { matchmaking_posts: { data: null, error: new Error('slot taken') } } });
    requireSupabase.mockReturnValue(client);
    await expect(publishMatchRequest({ kind: 'open', startsAt: 't1', area: 'Makati' })).rejects.toThrow('slot taken');
  });
});

describe('requireVerifiedPublishingVenue (exercised through createVenueProgram)', () => {
  const baseArgs = { venueId: 'v1', name: 'Clinic', kind: 'clinic', startsAt: 't1', endsAt: 't2', capacity: 10 };

  it('throws the sign-in error before ever checking the venue when nobody is signed in', async () => {
    requireSupabase.mockReturnValue(makeClient({ user: null }));
    await expect(createVenueProgram(baseArgs)).rejects.toThrow('Sign in to use competitive features.');
  });

  it('rejects a missing venue id', async () => {
    const client = makeClient({});
    requireSupabase.mockReturnValue(client);
    await expect(createVenueProgram({ ...baseArgs, venueId: null })).rejects.toThrow('Choose a verified venue.');
  });

  it('propagates a venue lookup error', async () => {
    const client = makeClient({ tableResults: { venues: { data: null, error: new Error('rls denied') } } });
    requireSupabase.mockReturnValue(client);
    await expect(createVenueProgram(baseArgs)).rejects.toThrow('rls denied');
  });

  it('rejects when the venue is not found, not verified, or not active', async () => {
    const client = makeClient({ tableResults: { venues: { data: null, error: null } } });
    requireSupabase.mockReturnValue(client);
    await expect(createVenueProgram(baseArgs)).rejects.toThrow('This venue must be verified and active before you can publish.');
  });

  it('creates the program once the venue is confirmed verified and active', async () => {
    const client = makeClient({
      tableResults: {
        venues: { data: { id: 'v1' }, error: null },
        venue_programs: { data: { id: 'prog1', name: 'Clinic' }, error: null },
      },
    });
    requireSupabase.mockReturnValue(client);
    const result = await createVenueProgram(baseArgs);
    expect(result).toEqual({ id: 'prog1', name: 'Clinic' });
  });
});

describe('loadOrganizerPickleballHub (unwrap behavior)', () => {
  it('returns an empty shape without querying the database when there are no venues', async () => {
    const client = makeClient({});
    requireSupabase.mockReturnValue(client);
    const result = await loadOrganizerPickleballHub([]);
    expect(result).toEqual({ programs: [], competitions: [], competitionMatches: [], products: [], analytics: null });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('unwraps each query\'s data, defaulting a null payload to an empty array', async () => {
    const client = makeClient({
      tableResults: {
        venue_programs: { data: null, error: null },
        competitions: { data: [{ id: 'c1' }], error: null },
        matches: { data: [{ id: 'm1' }], error: null },
        membership_products: { data: [{ id: 'p1' }], error: null },
      },
    });
    requireSupabase.mockReturnValue(client);
    const result = await loadOrganizerPickleballHub([{ id: 'v1' }]);
    expect(result).toEqual({ programs: [], competitions: [{ id: 'c1' }], competitionMatches: [{ id: 'm1' }], products: [{ id: 'p1' }] });
  });

  it('throws the error from a failing query instead of returning partial data', async () => {
    const client = makeClient({
      tableResults: { venue_programs: { data: null, error: new Error('programs denied') } },
    });
    requireSupabase.mockReturnValue(client);
    await expect(loadOrganizerPickleballHub([{ id: 'v1' }])).rejects.toThrow('programs denied');
  });
});

describe('createCompetition', () => {
  const baseDivision = { format: 'doubles', participantDivision: 'open', skillCategory: 'novice', entryType: 'player' };
  const baseArgs = { venueId: 'v1', name: 'Cup', kind: 'tournament', startsOn: '2026-09-01', divisions: [baseDivision] };

  it('rejects when there are no divisions, without ever calling requireSupabase', async () => {
    await expect(createCompetition({ ...baseArgs, divisions: [] })).rejects.toThrow('Add at least one competition division.');
    expect(requireSupabase).not.toHaveBeenCalled();
  });

  it('rejects an invalid division format', async () => {
    await expect(createCompetition({ ...baseArgs, divisions: [{ ...baseDivision, format: 'triples' }] })).rejects.toThrow('Division format must be singles or doubles.');
  });

  it('rejects an invalid participant division', async () => {
    await expect(createCompetition({ ...baseArgs, divisions: [{ ...baseDivision, participantDivision: 'kids' }] })).rejects.toThrow('Choose a valid participant division.');
  });

  it('rejects an invalid skill category', async () => {
    await expect(createCompetition({ ...baseArgs, divisions: [{ ...baseDivision, skillCategory: 'pro' }] })).rejects.toThrow('Choose a valid skill category.');
  });

  it('rejects an invalid entry type', async () => {
    await expect(createCompetition({ ...baseArgs, divisions: [{ ...baseDivision, entryType: 'club' }] })).rejects.toThrow('Choose player or team entries.');
  });

  it('requires a verified, active venue before creating the competition', async () => {
    const client = makeClient({ tableResults: { venues: { data: null, error: null } } });
    requireSupabase.mockReturnValue(client);
    await expect(createCompetition(baseArgs)).rejects.toThrow('This venue must be verified and active before you can publish.');
  });

  it('creates the competition with its divisions via rpc and returns the created row when no cover image is given', async () => {
    const rpc = jest.fn(async () => ({ data: [{ id: 'comp1', name: 'Cup' }], error: null }));
    const client = makeClient({ tableResults: { venues: { data: { id: 'v1' }, error: null } }, rpc });
    requireSupabase.mockReturnValue(client);
    const result = await createCompetition(baseArgs);
    expect(rpc).toHaveBeenCalledWith('create_competition_with_divisions', {
      p_venue_id: 'v1', p_name: 'Cup', p_kind: 'tournament', p_starts_on: '2026-09-01', p_ends_on: null,
      p_rules: null, p_visibility: 'public', p_divisions: [baseDivision],
    });
    expect(result).toEqual({ id: 'comp1', name: 'Cup' });
    expect(saveCompetitionCover).not.toHaveBeenCalled();
  });

  it('uploads the cover image and returns the updated row when a cover image is supplied', async () => {
    const rpc = jest.fn(async () => ({ data: [{ id: 'comp1' }], error: null }));
    const client = makeClient({ tableResults: { venues: { data: { id: 'v1' }, error: null } }, rpc });
    requireSupabase.mockReturnValue(client);
    saveCompetitionCover.mockResolvedValue({ id: 'comp1', cover_image_url: 'https://x/y.jpg' });
    const result = await createCompetition({ ...baseArgs, coverImage: 'file://local.jpg' });
    expect(saveCompetitionCover).toHaveBeenCalledWith('comp1', 'file://local.jpg');
    expect(result).toEqual({ id: 'comp1', cover_image_url: 'https://x/y.jpg' });
  });

  it('propagates an rpc error', async () => {
    const client = makeClient({
      tableResults: { venues: { data: { id: 'v1' }, error: null } },
      rpc: jest.fn(async () => ({ data: null, error: new Error('duplicate name') })),
    });
    requireSupabase.mockReturnValue(client);
    await expect(createCompetition(baseArgs)).rejects.toThrow('duplicate name');
  });
});

describe('competition constant enumerations', () => {
  it('exposes the expected frozen lists', () => {
    expect(COMPETITION_FORMATS).toEqual(['singles', 'doubles']);
    expect(Object.isFrozen(COMPETITION_FORMATS)).toBe(true);
    expect(COMPETITION_PARTICIPANT_DIVISIONS).toEqual(['open', 'women', 'men', 'mixed']);
    expect(COMPETITION_SKILL_CATEGORIES).toEqual(['open', 'novice', 'intermediate', 'advanced']);
    expect(COMPETITION_ENTRY_TYPES).toEqual(['player', 'team']);
  });
});

describe('loadCompetitionDivisionDetail', () => {
  it('queries Supabase directly', async () => {
    const client = makeClient({ tableResults: { competition_divisions: { data: { id: 'div1' }, error: null } } });
    requireSupabase.mockReturnValue(client);
    const result = await loadCompetitionDivisionDetail('div1');
    expect(result).toEqual({ id: 'div1' });
  });

  it('propagates a fetch error', async () => {
    const client = makeClient({ tableResults: { competition_divisions: { data: null, error: new Error('not found') } } });
    requireSupabase.mockReturnValue(client);
    await expect(loadCompetitionDivisionDetail('div1')).rejects.toThrow('not found');
  });
});

describe('closeMatchRequest', () => {
  it('closes an open request owned by the caller', async () => {
    const client = makeClient({ tableResults: { matchmaking_posts: { data: { id: 'post1', status: 'closed' }, error: null } } });
    requireSupabase.mockReturnValue(client);
    const result = await closeMatchRequest('post1');
    expect(result).toEqual({ id: 'post1', status: 'closed' });
  });

  it('throws when the request is no longer open', async () => {
    const client = makeClient({ tableResults: { matchmaking_posts: { data: null, error: null } } });
    requireSupabase.mockReturnValue(client);
    await expect(closeMatchRequest('post1')).rejects.toThrow('This play request is no longer open.');
  });

  it('requires a signed-in user', async () => {
    requireSupabase.mockReturnValue(makeClient({ user: null }));
    await expect(closeMatchRequest('post1')).rejects.toThrow('Sign in to use competitive features.');
  });
});

describe('closeOpenMatchRequests', () => {
  it('returns the closed post ids, defaulting to an empty array', async () => {
    const client = makeClient({ tableResults: { matchmaking_posts: { data: null, error: null } } });
    requireSupabase.mockReturnValue(client);
    expect(await closeOpenMatchRequests()).toEqual([]);
  });

  it('propagates a server error', async () => {
    const client = makeClient({ tableResults: { matchmaking_posts: { data: null, error: new Error('nope') } } });
    requireSupabase.mockReturnValue(client);
    await expect(closeOpenMatchRequests()).rejects.toThrow('nope');
  });
});

describe('respondTeamChallenge', () => {
  it('accepts or declines a pending challenge', async () => {
    const client = makeClient({ tableResults: { team_challenges: { data: { id: 'ch1', status: 'accepted' }, error: null } } });
    requireSupabase.mockReturnValue(client);
    const result = await respondTeamChallenge('ch1', true);
    expect(result).toEqual({ id: 'ch1', status: 'accepted' });
  });

  it('propagates an error', async () => {
    const client = makeClient({ tableResults: { team_challenges: { data: null, error: new Error('already resolved') } } });
    requireSupabase.mockReturnValue(client);
    await expect(respondTeamChallenge('ch1', false)).rejects.toThrow('already resolved');
  });
});

describe('getAcceptedTeamChallenges', () => {
  it('returns accepted challenges for the team, defaulting to an empty array', async () => {
    const client = makeClient({ tableResults: { team_challenges: { data: null, error: null } } });
    requireSupabase.mockReturnValue(client);
    expect(await getAcceptedTeamChallenges('team1')).toEqual([]);
  });

  it('propagates an error', async () => {
    const client = makeClient({ tableResults: { team_challenges: { data: null, error: new Error('denied') } } });
    requireSupabase.mockReturnValue(client);
    await expect(getAcceptedTeamChallenges('team1')).rejects.toThrow('denied');
  });
});

describe('createTeamChallenge', () => {
  it('requires a signed-in user', async () => {
    requireSupabase.mockReturnValue(makeClient({ user: null }));
    await expect(createTeamChallenge({ challengerTeamId: 't1', challengedTeamId: 't2', startsAt: 'x' })).rejects.toThrow('Sign in to use competitive features.');
  });

  it('creates a challenge proposed by the signed-in user', async () => {
    const client = makeClient({ tableResults: { team_challenges: { data: { id: 'ch1' }, error: null } } });
    requireSupabase.mockReturnValue(client);
    const result = await createTeamChallenge({ challengerTeamId: 't1', challengedTeamId: 't2', startsAt: 'x', venueId: 'v1', format: 'singles', privacy: 'public', note: 'gl' });
    expect(result).toEqual({ id: 'ch1' });
  });

  it('propagates an insert error', async () => {
    const client = makeClient({ tableResults: { team_challenges: { data: null, error: new Error('team busy') } } });
    requireSupabase.mockReturnValue(client);
    await expect(createTeamChallenge({ challengerTeamId: 't1', challengedTeamId: 't2', startsAt: 'x' })).rejects.toThrow('team busy');
  });
});

describe('startMembershipCheckout', () => {
  it('returns checkout data on success', async () => {
    const client = makeClient({ invoke: jest.fn(async () => ({ data: { checkout_url: 'https://pay/x' }, error: null })) });
    requireSupabase.mockReturnValue(client);
    const result = await startMembershipCheckout('mem1', 'gcash');
    expect(client.functions.invoke).toHaveBeenCalledWith('create-checkout-session', { body: { membership_id: 'mem1', payment_method_type: 'gcash', platform: 'ios' } });
    expect(result.checkout_url).toBe('https://pay/x');
  });

  it('throws the function error message when the invoke itself fails', async () => {
    const client = makeClient({ invoke: jest.fn(async () => ({ data: null, error: { message: 'network down' } })) });
    requireSupabase.mockReturnValue(client);
    await expect(startMembershipCheckout('mem1', 'card')).rejects.toThrow('network down');
  });

  it('throws a fallback message when the checkout function errors without a message', async () => {
    const client = makeClient({ invoke: jest.fn(async () => ({ data: null, error: {} })) });
    requireSupabase.mockReturnValue(client);
    await expect(startMembershipCheckout('mem1', 'card')).rejects.toThrow('Could not start membership checkout.');
  });

  it('throws the provider reason when checkout succeeds transport-wise but returns no checkout url', async () => {
    const client = makeClient({ invoke: jest.fn(async () => ({ data: { error: 'provider declined' }, error: null })) });
    requireSupabase.mockReturnValue(client);
    await expect(startMembershipCheckout('mem1', 'card')).rejects.toThrow('provider declined');
  });

  it('throws a fallback message when checkout is unavailable without a stated reason', async () => {
    const client = makeClient({ invoke: jest.fn(async () => ({ data: {}, error: null })) });
    requireSupabase.mockReturnValue(client);
    await expect(startMembershipCheckout('mem1', 'card')).rejects.toThrow('Membership checkout is unavailable right now.');
  });
});

describe('createMembershipProduct', () => {
  it('requires a verified, active venue', async () => {
    const client = makeClient({ tableResults: { venues: { data: null, error: null } } });
    requireSupabase.mockReturnValue(client);
    await expect(createMembershipProduct({ venueId: 'v1', name: 'Monthly', kind: 'monthly', price: 1000 })).rejects.toThrow('This venue must be verified and active before you can publish.');
  });

  it('creates the product once the venue is verified', async () => {
    const client = makeClient({
      tableResults: { venues: { data: { id: 'v1' }, error: null }, membership_products: { data: { id: 'prod1' }, error: null } },
    });
    requireSupabase.mockReturnValue(client);
    const result = await createMembershipProduct({ venueId: 'v1', name: 'Monthly', kind: 'monthly', price: 1000 });
    expect(result).toEqual({ id: 'prod1' });
  });

  it('propagates an insert error', async () => {
    const client = makeClient({
      tableResults: { venues: { data: { id: 'v1' }, error: null }, membership_products: { data: null, error: new Error('duplicate') } },
    });
    requireSupabase.mockReturnValue(client);
    await expect(createMembershipProduct({ venueId: 'v1', name: 'Monthly', kind: 'monthly', price: 1000 })).rejects.toThrow('duplicate');
  });
});

describe('venueAnalyticsCsv (pure formatter)', () => {
  it('builds a quoted CSV of every analytics row and escapes embedded quotes', () => {
    const analytics = {
      from: '2026-08-01', to: '2026-08-31', bookings: 40, cancelledBookings: 2, cancellationRate: 5,
      grossRevenue: 50000, bookedCourtHours: 80, uniquePlayers: 30, openPlaySessions: 6, returningPlayers: 12,
      courtUtilization: 70, peakHour: '6 PM', openPlayAttendance: 55, programRegistrations: 9,
    };
    const csv = venueAnalyticsCsv('Peakle "Main" Courts', analytics);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"Venue","Peakle ""Main"" Courts"');
    expect(lines).toContain('"Cancellation rate","5%"');
    expect(lines).toContain('"Bookings","40"');
    expect(lines).toContain('"Court utilization","70%"');
    expect(lines.length).toBe(15);
  });

  it('renders a missing value as an empty quoted string instead of "undefined"/"null"', () => {
    const analytics = { from: null, to: undefined, bookings: 5 };
    const csv = venueAnalyticsCsv('V', analytics);
    expect(csv).toContain('"From",""');
    expect(csv).toContain('"To",""');
  });

  it('renders missing percentage fields as empty rather than "null%"/"undefined%"', () => {
    const analytics = { cancellationRate: null, courtUtilization: undefined };
    const csv = venueAnalyticsCsv('V', analytics);
    expect(csv).toContain('"Cancellation rate",""');
    expect(csv).toContain('"Court utilization",""');
  });
});

describe('simple rpc-backed competition/team-match actions', () => {
  const cases = [
    { label: 'updatePickleballPrivacy', fn: () => updatePickleballPrivacy({ profileVisibility: 'public', availabilityVisibility: 'friends', matchingEnabled: true }), rpcName: 'update_competitive_privacy', rpcArgs: { p_profile_visibility: 'public', p_availability_visibility: 'friends', p_matching_enabled: true } },
    { label: 'claimMatchRequest', fn: () => claimMatchRequest('post1'), rpcName: 'claim_matchmaking_post', rpcArgs: { p_post_id: 'post1' } },
    { label: 'confirmMatchResult', fn: () => confirmMatchResult('m1', true, 'looks right'), rpcName: 'confirm_match_result', rpcArgs: { p_match_id: 'm1', p_confirm: true, p_note: 'looks right' } },
    { label: 'joinProgram', fn: () => joinProgram('prog1'), rpcName: 'register_for_program', rpcArgs: { p_program_id: 'prog1' } },
    { label: 'joinCompetition', fn: () => joinCompetition('comp1', 'div1', 'team1'), rpcName: 'register_for_competition_division', rpcArgs: { p_competition_id: 'comp1', p_division_id: 'div1', p_team_id: 'team1' } },
    { label: 'requestMembership', fn: () => requestMembership('prod1'), rpcName: 'request_membership_product', rpcArgs: { p_product_id: 'prod1' } },
    { label: 'seedTournamentBracket', fn: () => seedTournamentBracket('comp1', 'div1'), rpcName: 'seed_tournament_division_bracket_ready', rpcArgs: { p_competition_id: 'comp1', p_division_id: 'div1' } },
    { label: 'reviewCompetitionEntry', fn: () => reviewCompetitionEntry('entry1', true), rpcName: 'review_competition_entry', rpcArgs: { p_entry_id: 'entry1', p_approve: true } },
    { label: 'updateCompetitionDetails', fn: () => updateCompetitionDetails({ competitionId: 'comp1', name: 'Cup', startsOn: '2026-09-01', endsOn: '2026-09-02', visibility: 'private', rules: 'be nice' }), rpcName: 'update_competition_details', rpcArgs: { p_competition_id: 'comp1', p_name: 'Cup', p_starts_on: '2026-09-01', p_ends_on: '2026-09-02', p_visibility: 'private', p_rules: 'be nice' } },
    { label: 'setCompetitionStatus', fn: () => setCompetitionStatus('comp1', 'active'), rpcName: 'set_competition_status', rpcArgs: { p_competition_id: 'comp1', p_status: 'active' } },
    { label: 'setCompetitionDivisionStatus', fn: () => setCompetitionDivisionStatus('div1', 'closed'), rpcName: 'set_competition_division_status', rpcArgs: { p_division_id: 'div1', p_status: 'closed' } },
    { label: 'updateCompetitionDivisionDetails', fn: () => updateCompetitionDivisionDetails({ divisionId: 'div1', name: 'Div A', capacity: '16', feeAmount: '500', feeBasis: 'team' }), rpcName: 'update_competition_division_details', rpcArgs: { p_division_id: 'div1', p_name: 'Div A', p_capacity: 16, p_fee_amount: 500, p_fee_basis: 'team' } },
    { label: 'scheduleCompetitionMatch', fn: () => scheduleCompetitionMatch({ competitionId: 'comp1', divisionId: 'div1', homeEntryId: 'e1', awayEntryId: 'e2', scheduledAt: 't1', bracketMatchId: 'bm1' }), rpcName: 'schedule_competition_match', rpcArgs: { p_competition_id: 'comp1', p_division_id: 'div1', p_home_entry_id: 'e1', p_away_entry_id: 'e2', p_scheduled_at: 't1', p_bracket_match_id: 'bm1' } },
    { label: 'recordCompetitionMatchResult', fn: () => recordCompetitionMatchResult('m1', '11', '7'), rpcName: 'record_competition_match_result', rpcArgs: { p_match_id: 'm1', p_home_score: 11, p_away_score: 7 } },
    { label: 'activateMembership', fn: () => activateMembership('mem1'), rpcName: 'activate_player_membership', rpcArgs: { p_membership_id: 'mem1' } },
    { label: 'loadVenueAnalytics', fn: () => loadVenueAnalytics('v1', '2026-08-01', '2026-08-31'), rpcName: 'get_venue_pickleball_analytics', rpcArgs: { p_venue_id: 'v1', p_from: '2026-08-01', p_to: '2026-08-31' } },
    { label: 'getTeamMatch', fn: () => getTeamMatch('team1'), rpcName: 'get_team_match', rpcArgs: { p_team_id: 'team1' } },
    { label: 'startTeamMatch', fn: () => startTeamMatch('chal1', 'u2'), rpcName: 'start_team_match', rpcArgs: { p_challenge_id: 'chal1', p_scorer_id: 'u2' } },
    { label: 'handoffTeamMatchScorer', fn: () => handoffTeamMatchScorer('m1', 'u2'), rpcName: 'handoff_team_match_scorer', rpcArgs: { p_match_id: 'm1', p_scorer_id: 'u2' } },
    { label: 'recordTeamMatchRally', fn: () => recordTeamMatchRally('m1', 1), rpcName: 'record_team_match_rally', rpcArgs: { p_match_id: 'm1', p_winning_side: 1 } },
    { label: 'undoTeamMatchRally', fn: () => undoTeamMatchRally('m1'), rpcName: 'undo_team_match_rally', rpcArgs: { p_match_id: 'm1' } },
    { label: 'completeTeamMatchGame', fn: () => completeTeamMatchGame('m1', 11, 7), rpcName: 'complete_team_match_game', rpcArgs: { p_match_id: 'm1', p_home_score: 11, p_away_score: 7 } },
    { label: 'completeTeamMatch', fn: () => completeTeamMatch('m1'), rpcName: 'complete_team_match', rpcArgs: { p_match_id: 'm1' } },
  ];

  it.each(cases)('$label sends the expected rpc name and arguments, returning the server data', async ({ fn, rpcName, rpcArgs }) => {
    const rpc = jest.fn(async () => ({ data: { ok: true }, error: null }));
    requireSupabase.mockReturnValue(makeClient({ rpc }));
    const result = await fn();
    expect(rpc).toHaveBeenCalledWith(rpcName, rpcArgs);
    expect(result).toEqual({ ok: true });
  });

  it.each(cases)('$label propagates a server error', async ({ fn }) => {
    requireSupabase.mockReturnValue(makeClient({ rpc: jest.fn(async () => ({ data: null, error: new Error('server rejected') })) }));
    await expect(fn()).rejects.toThrow('server rejected');
  });
});
