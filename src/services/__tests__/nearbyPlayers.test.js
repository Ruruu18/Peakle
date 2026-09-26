import { requireSupabase } from '../../lib/supabase';
import {
  distanceLabel,
  INVITE_WINDOW_MS,
  publishPresence,
  stopPresence,
  listNearbyOnlinePlayers,
  sendMatchInvite,
  listMatchInvites,
  respondToMatchInvite,
  leaveMatchInvite,
  removeMatchInvitee,
  startNearbyLiveMatch,
  getNearbyLiveMatch,
  getActiveNearbyLiveMatchId,
  updateNearbyLiveMatch,
  handoffNearbyLiveScorer,
  cancelMatchInvite,
  searchRegisteredPlayers,
} from '../nearbyPlayers';

jest.mock('../../lib/supabase', () => ({ requireSupabase: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('distanceLabel', () => {
  it('returns "Nearby" for non-finite or negative distances', () => {
    expect(distanceLabel(NaN)).toBe('Nearby');
    expect(distanceLabel(undefined)).toBe('Nearby');
    expect(distanceLabel(Infinity)).toBe('Nearby');
    expect(distanceLabel(-5)).toBe('Nearby');
  });

  it('shows "Less than 10 m" under 10 meters (distance < 0.01 km)', () => {
    expect(distanceLabel(0)).toBe('Less than 10 m');
    expect(distanceLabel(0.0099)).toBe('Less than 10 m');
  });

  it('rounds to the nearest 10 m between 10 m and 1 km, flooring at 10 m', () => {
    expect(distanceLabel(0.01)).toBe('10 m');
    expect(distanceLabel(0.5)).toBe('500 m');
    expect(distanceLabel(0.99)).toBe('990 m');
  });

  it('shows one decimal of kilometers from 1 km up to (not including) 100 km', () => {
    expect(distanceLabel(1)).toBe('1.0 km');
    expect(distanceLabel(45.27)).toBe('45.3 km');
    expect(distanceLabel(99.9)).toBe('99.9 km');
  });

  it('rounds to whole kilometers at 100 km and above', () => {
    expect(distanceLabel(100)).toBe('100 km');
    expect(distanceLabel(150.4)).toBe('150 km');
  });
});

describe('listNearbyOnlinePlayers', () => {
  it('returns an empty list without querying when the location is invalid', async () => {
    const client = { rpc: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await listNearbyOnlinePlayers({})).toEqual([]);
    expect(await listNearbyOnlinePlayers({ latitude: 1, longitude: NaN })).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('calls nearby_online_players with the given location and radius, defaulting radius to 25 km', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [], error: null })) };
    requireSupabase.mockReturnValue(client);
    await listNearbyOnlinePlayers({ latitude: 14.5, longitude: 121.0 }, 10);
    expect(client.rpc).toHaveBeenCalledWith('nearby_online_players', { p_latitude: 14.5, p_longitude: 121.0, p_radius_km: 10 });

    await listNearbyOnlinePlayers({ latitude: 1, longitude: 2 });
    expect(client.rpc.mock.calls[1][1].p_radius_km).toBe(25);
  });

  it('propagates a query error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('rpc failed') })) });
    await expect(listNearbyOnlinePlayers({ latitude: 1, longitude: 2 })).rejects.toThrow('rpc failed');
  });

  it('formats initials from a multi-word display name, capped at two characters', async () => {
    const client = { rpc: jest.fn(async () => ({
      data: [{ id: 'p1', display_name: 'ana maria cruz', avatar_url: null, skill_rating: 4.2, distance_km: 2, availability: 'available', last_seen_at: 't' }],
      error: null,
    })) };
    requireSupabase.mockReturnValue(client);
    const [player] = await listNearbyOnlinePlayers({ latitude: 1, longitude: 2 });
    expect(player.initials).toBe('AM');
  });

  it('falls back to "P" initials and "Unrated" skill when the row has no name or rating', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ id: 'p1', display_name: null, skill_rating: null, distance_km: 1 }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const [player] = await listNearbyOnlinePlayers({ latitude: 1, longitude: 2 });
    expect(player.initials).toBe('P');
    expect(player.rating).toBe('Unrated');
  });

  it('combines local and remote location accuracy via hypot, rounding up', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ id: 'p1', distance_km: 1, location_accuracy_m: 30 }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const [player] = await listNearbyOnlinePlayers({ latitude: 1, longitude: 2, accuracy: 40 });
    // hypot(40, 30) = 50 exactly
    expect(player.distanceAccuracyM).toBe(50);
    expect(player.distanceAccuracy).toBe('50 m');
  });

  it('uses whichever side has an accuracy figure when the other is missing', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ id: 'p1', distance_km: 1, location_accuracy_m: 1200 }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const [player] = await listNearbyOnlinePlayers({ latitude: 1, longitude: 2 });
    expect(player.distanceAccuracyM).toBe(1200);
    expect(player.distanceAccuracy).toBe('1.2 km');
  });

  it('leaves the accuracy fields null when neither side reports one', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ id: 'p1', distance_km: 1 }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const [player] = await listNearbyOnlinePlayers({ latitude: 1, longitude: 2 });
    expect(player.distanceAccuracyM).toBeNull();
    expect(player.distanceAccuracy).toBeNull();
  });

  it('floors the accuracy label at 5 m', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ id: 'p1', distance_km: 1, location_accuracy_m: 1 }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const [player] = await listNearbyOnlinePlayers({ latitude: 1, longitude: 2 });
    expect(player.distanceAccuracy).toBe('5 m');
  });

  it('maps distance_km through distanceLabel for the display field', async () => {
    const client = { rpc: jest.fn(async () => ({ data: [{ id: 'p1', distance_km: 45.27 }], error: null })) };
    requireSupabase.mockReturnValue(client);
    const [player] = await listNearbyOnlinePlayers({ latitude: 1, longitude: 2 });
    expect(player.distance).toBe('45.3 km');
    expect(player.distanceKm).toBe(45.27);
  });
});

describe('publishPresence', () => {
  it('does nothing when the user id or location is missing/invalid', async () => {
    const client = { from: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await publishPresence(null, { latitude: 1, longitude: 2 })).toBeUndefined();
    expect(await publishPresence('u1', { latitude: NaN, longitude: 2 })).toBeUndefined();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('upserts presence with clamped accuracy and returns the row on success', async () => {
    const single = jest.fn(async () => ({ data: { user_id: 'u1', is_visible: true, availability: 'available', last_seen_at: 'now' }, error: null }));
    const select = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select }));
    const from = jest.fn(() => ({ upsert }));
    requireSupabase.mockReturnValue({ from });

    const result = await publishPresence('u1', { latitude: 14, longitude: 121, accuracy: 999999 }, { visible: true, availability: 'available' });

    expect(from).toHaveBeenCalledWith('player_presence');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', latitude: 14, longitude: 121, is_visible: true, availability: 'available', accuracy_m: 50000 }),
      { onConflict: 'user_id' },
    );
    expect(result.user_id).toBe('u1');
  });

  it('retries without accuracy_m when the column does not exist yet (pre-migration compatibility)', async () => {
    const singleOk = jest.fn(async () => ({ data: { user_id: 'u1', is_visible: true }, error: null }));
    const singleFail = jest.fn(async () => ({ data: null, error: { code: 'PGRST204', message: 'accuracy_m column not found' } }));
    const select = jest.fn()
      .mockReturnValueOnce({ single: singleFail })
      .mockReturnValueOnce({ single: singleOk });
    const upsert = jest.fn(() => ({ select }));
    const from = jest.fn(() => ({ upsert }));
    requireSupabase.mockReturnValue({ from });

    const result = await publishPresence('u1', { latitude: 14, longitude: 121, accuracy: 10 });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[1][0]).not.toHaveProperty('accuracy_m');
    expect(result.user_id).toBe('u1');
  });

  it('throws an unrelated upsert error without retrying', async () => {
    const single = jest.fn(async () => ({ data: null, error: new Error('rls violation') }));
    const select = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select }));
    requireSupabase.mockReturnValue({ from: () => ({ upsert }) });
    await expect(publishPresence('u1', { latitude: 1, longitude: 2 })).rejects.toThrow('rls violation');
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('throws a friendly error when the returned row is not actually visible', async () => {
    const single = jest.fn(async () => ({ data: { user_id: 'u1', is_visible: false }, error: null }));
    const select = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select }));
    requireSupabase.mockReturnValue({ from: () => ({ upsert }) });
    await expect(publishPresence('u1', { latitude: 1, longitude: 2 })).rejects.toThrow('Peakle could not publish your nearby-player visibility.');
  });
});

describe('stopPresence', () => {
  it('does nothing when there is no user id', async () => {
    const client = { from: jest.fn() };
    requireSupabase.mockReturnValue(client);
    await stopPresence(null);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('sets availability to offline without touching visibility by default', async () => {
    const eq = jest.fn(async () => ({ error: null }));
    const update = jest.fn(() => ({ eq }));
    requireSupabase.mockReturnValue({ from: () => ({ update }) });
    await stopPresence('u1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ availability: 'offline' }));
    expect(update.mock.calls[0][0]).not.toHaveProperty('is_visible');
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('also disables visibility when disable is requested', async () => {
    const eq = jest.fn(async () => ({ error: null }));
    const update = jest.fn(() => ({ eq }));
    requireSupabase.mockReturnValue({ from: () => ({ update }) });
    await stopPresence('u1', { disable: true });
    expect(update.mock.calls[0][0]).toMatchObject({ is_visible: false });
  });

  it('propagates an update error', async () => {
    const eq = jest.fn(async () => ({ error: new Error('nope') }));
    requireSupabase.mockReturnValue({ from: () => ({ update: () => ({ eq }) }) });
    await expect(stopPresence('u1')).rejects.toThrow('nope');
  });
});

function buildInviteSendClient({ authUser = { id: 'me' }, authError = null, staleInvites = [], staleError = null, cancelError = null, sendResult = { data: { id: 'inv1' }, error: null } } = {}) {
  const rpc = jest.fn(async (fnName) => {
    if (fnName === 'cancel_match_invite') return { data: null, error: cancelError };
    if (fnName === 'send_match_invite') return sendResult;
    return { data: null, error: null };
  });
  const lte = jest.fn(async () => ({ data: staleInvites, error: staleError }));
  const eq3 = jest.fn(() => ({ lte }));
  const eq2 = jest.fn(() => ({ eq: eq3 }));
  const eq1 = jest.fn(() => ({ eq: eq2 }));
  const select = jest.fn(() => ({ eq: eq1 }));
  const from = jest.fn(() => ({ select }));
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: authUser }, error: authError })) },
    from,
    rpc,
    _lte: lte,
  };
}

describe('sendMatchInvite', () => {
  const NOW = Date.parse('2026-08-19T12:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws when there is no signed-in user', async () => {
    const client = buildInviteSendClient({ authUser: null });
    requireSupabase.mockReturnValue(client);
    await expect(sendMatchInvite('r1', {})).rejects.toThrow('Sign in to invite a player.');
  });

  it('propagates an auth lookup error', async () => {
    const client = buildInviteSendClient({ authError: new Error('token expired') });
    requireSupabase.mockReturnValue(client);
    await expect(sendMatchInvite('r1', {})).rejects.toThrow('token expired');
  });

  it('looks up stale pending invites using the exact 60s cutoff from INVITE_WINDOW_MS, then sends the new invite', async () => {
    const client = buildInviteSendClient({ staleInvites: [] });
    requireSupabase.mockReturnValue(client);
    await sendMatchInvite('r1', { format: 'doubles' });
    expect(client._lte).toHaveBeenCalledWith('created_at', new Date(NOW - INVITE_WINDOW_MS).toISOString());
    expect(client.rpc).toHaveBeenCalledWith('send_match_invite', { p_recipient_id: 'r1', p_match_payload: { format: 'doubles' } });
  });

  it('cancels every stale invite before sending the new one', async () => {
    const client = buildInviteSendClient({ staleInvites: [{ id: 'old1' }, { id: 'old2' }] });
    requireSupabase.mockReturnValue(client);
    await sendMatchInvite('r1', {});
    expect(client.rpc).toHaveBeenCalledWith('cancel_match_invite', { p_invite_id: 'old1' });
    expect(client.rpc).toHaveBeenCalledWith('cancel_match_invite', { p_invite_id: 'old2' });
    expect(client.rpc).toHaveBeenLastCalledWith('send_match_invite', expect.anything());
  });

  it('propagates a stale-lookup error without sending a new invite', async () => {
    const client = buildInviteSendClient({ staleError: new Error('lookup failed') });
    requireSupabase.mockReturnValue(client);
    await expect(sendMatchInvite('r1', {})).rejects.toThrow('lookup failed');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('propagates a cancellation error and never sends the new invite', async () => {
    const client = buildInviteSendClient({ staleInvites: [{ id: 'old1' }], cancelError: new Error('cancel failed') });
    requireSupabase.mockReturnValue(client);
    await expect(sendMatchInvite('r1', {})).rejects.toThrow('cancel failed');
    expect(client.rpc).not.toHaveBeenCalledWith('send_match_invite', expect.anything());
  });

  it('propagates a send error', async () => {
    const client = buildInviteSendClient({ sendResult: { data: null, error: new Error('send failed') } });
    requireSupabase.mockReturnValue(client);
    await expect(sendMatchInvite('r1', {})).rejects.toThrow('send failed');
  });
});

function buildInviteListClient({ authUser = { id: 'me' }, authError = null, incomingData = [], incomingError = null, outgoingData = [], outgoingError = null } = {}) {
  const queueResults = [
    { data: incomingData, error: incomingError },
    { data: outgoingData, error: outgoingError },
  ];
  let call = 0;
  const gteCalls = [];
  const from = jest.fn(() => {
    const idx = call;
    call += 1;
    const order = jest.fn(async () => queueResults[idx]);
    const gte = jest.fn((...args) => { gteCalls.push(args); return { order }; });
    const eq = jest.fn(() => ({ gte }));
    const select = jest.fn(() => ({ eq }));
    return { select };
  });
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user: authUser }, error: authError })) },
    from,
    _gteCalls: gteCalls,
  };
}

describe('listMatchInvites (the 60s pending / 15-minute history window logic)', () => {
  const NOW = Date.parse('2026-08-19T12:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns empty defaults when signed out, instead of throwing', async () => {
    const client = buildInviteListClient({ authUser: null });
    requireSupabase.mockReturnValue(client);
    await expect(listMatchInvites()).resolves.toEqual({ incoming: [], outgoing: [], joinedInvite: null, removedInvite: null });
  });

  it('queries both directions using the 15-minute joined-invite history cutoff', async () => {
    const client = buildInviteListClient({});
    requireSupabase.mockReturnValue(client);
    await listMatchInvites();
    const historyCutoff = new Date(NOW - 15 * 60 * 1000).toISOString();
    expect(client._gteCalls[0]).toEqual(['created_at', historyCutoff]);
    expect(client._gteCalls[1]).toEqual(['created_at', historyCutoff]);
  });

  it('keeps a pending invite created within the last 60 seconds as "incoming" but drops an older pending one', async () => {
    const fresh = { status: 'pending', created_at: new Date(NOW - 30 * 1000).toISOString() };
    const stale = { status: 'pending', created_at: new Date(NOW - 90 * 1000).toISOString() };
    const client = buildInviteListClient({ incomingData: [fresh, stale] });
    requireSupabase.mockReturnValue(client);
    const result = await listMatchInvites();
    expect(result.incoming).toEqual([fresh]);
  });

  it('surfaces an accepted invite as joinedInvite even once it has aged out of the 60s pending window', async () => {
    const accepted = { status: 'accepted', created_at: new Date(NOW - 5 * 60 * 1000).toISOString() };
    const client = buildInviteListClient({ incomingData: [accepted] });
    requireSupabase.mockReturnValue(client);
    const result = await listMatchInvites();
    expect(result.joinedInvite).toEqual(accepted);
    expect(result.incoming).toEqual([]);
  });

  it('surfaces a removal only when it is the most recent invite event for the recipient', async () => {
    const removed = { status: 'removed', created_at: new Date(NOW - 60 * 1000).toISOString() };
    const client = buildInviteListClient({ incomingData: [removed] });
    requireSupabase.mockReturnValue(client);
    const result = await listMatchInvites();
    expect(result.removedInvite).toEqual(removed);
  });

  it('does not surface a removal once a newer joinedInvite exists', async () => {
    const joined = { status: 'accepted', created_at: new Date(NOW - 10 * 1000).toISOString() };
    const removed = { status: 'removed', created_at: new Date(NOW - 60 * 1000).toISOString() };
    const client = buildInviteListClient({ incomingData: [joined, removed] });
    requireSupabase.mockReturnValue(client);
    const result = await listMatchInvites();
    expect(result.joinedInvite).toEqual(joined);
    expect(result.removedInvite).toBeNull();
  });

  it('only treats the first (most recent) incoming row as a removal candidate, ignoring an older removed row further down the list', async () => {
    const notLatest = { status: 'pending', created_at: new Date(NOW - 5 * 1000).toISOString() };
    const removedButNotFirst = { status: 'removed', created_at: new Date(NOW - 60 * 1000).toISOString() };
    const client = buildInviteListClient({ incomingData: [notLatest, removedButNotFirst] });
    requireSupabase.mockReturnValue(client);
    const result = await listMatchInvites();
    expect(result.removedInvite).toBeNull();
  });

  it('propagates an error from either the incoming or outgoing query', async () => {
    const client = buildInviteListClient({ outgoingError: new Error('outgoing failed') });
    requireSupabase.mockReturnValue(client);
    await expect(listMatchInvites()).rejects.toThrow('outgoing failed');
  });

  it('returns outgoing rows as-is', async () => {
    const outgoing = [{ id: 'o1', status: 'pending' }];
    const client = buildInviteListClient({ outgoingData: outgoing });
    requireSupabase.mockReturnValue(client);
    const result = await listMatchInvites();
    expect(result.outgoing).toEqual(outgoing);
  });
});

describe('simple rpc-backed invite/match actions', () => {
  const cases = [
    { label: 'respondToMatchInvite', fn: () => respondToMatchInvite('inv1', true), rpcName: 'respond_match_invite', rpcArgs: { p_invite_id: 'inv1', p_accept: true } },
    { label: 'leaveMatchInvite', fn: () => leaveMatchInvite('inv1'), rpcName: 'leave_match_invite', rpcArgs: { p_invite_id: 'inv1' } },
    { label: 'removeMatchInvitee', fn: () => removeMatchInvitee('inv1'), rpcName: 'remove_match_invitee', rpcArgs: { p_invite_id: 'inv1' } },
    { label: 'cancelMatchInvite', fn: () => cancelMatchInvite('inv1'), rpcName: 'cancel_match_invite', rpcArgs: { p_invite_id: 'inv1' } },
    { label: 'handoffNearbyLiveScorer', fn: () => handoffNearbyLiveScorer('m1', 'u2'), rpcName: 'handoff_nearby_live_scorer', rpcArgs: { p_match_id: 'm1', p_scorer_id: 'u2' } },
  ];

  it.each(cases)('$label sends the right rpc args and returns the data', async ({ fn, rpcName, rpcArgs }) => {
    const rpc = jest.fn(async () => ({ data: { ok: true }, error: null }));
    requireSupabase.mockReturnValue({ rpc });
    const result = await fn();
    expect(rpc).toHaveBeenCalledWith(rpcName, rpcArgs);
    expect(result).toEqual({ ok: true });
  });

  it.each(cases)('$label propagates a server error', async ({ fn }) => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('boom') })) });
    await expect(fn()).rejects.toThrow('boom');
  });
});

describe('startNearbyLiveMatch', () => {
  it('sends setup, configuration, initial state, and scorer to start_nearby_live_match', async () => {
    const rpc = jest.fn(async () => ({ data: { id: 'match1' }, error: null }));
    requireSupabase.mockReturnValue({ rpc });
    const result = await startNearbyLiveMatch({ setupId: 's1', configuration: { format: 'singles' }, initialState: { score: 0 }, scorerId: 'u1' });
    expect(rpc).toHaveBeenCalledWith('start_nearby_live_match', {
      p_setup_id: 's1', p_configuration: { format: 'singles' }, p_initial_state: { score: 0 }, p_scorer_id: 'u1',
    });
    expect(result).toEqual({ id: 'match1' });
  });

  it('propagates an error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('failed') })) });
    await expect(startNearbyLiveMatch({})).rejects.toThrow('failed');
  });
});

describe('getActiveNearbyLiveMatchId', () => {
  function mockQuery(result) {
    const chain = {};
    ['select', 'in', 'gte', 'order', 'limit'].forEach((name) => { chain[name] = jest.fn(() => chain); });
    chain.maybeSingle = jest.fn(async () => result);
    const from = jest.fn(() => chain);
    requireSupabase.mockReturnValue({ from });
    return { from, chain };
  }

  it('returns the most recently updated live or paused session regardless of invite age', async () => {
    const { from, chain } = mockQuery({ data: { id: 'm9' }, error: null });
    expect(await getActiveNearbyLiveMatchId()).toBe('m9');
    expect(from).toHaveBeenCalledWith('nearby_live_matches');
    expect(chain.in).toHaveBeenCalledWith('status', ['live', 'paused']);
    expect(chain.order).toHaveBeenCalledWith('updated_at', { ascending: false });
  });

  it('returns null when there is no active session and propagates errors', async () => {
    mockQuery({ data: null, error: null });
    expect(await getActiveNearbyLiveMatchId()).toBeNull();
    mockQuery({ data: null, error: new Error('boom') });
    await expect(getActiveNearbyLiveMatchId()).rejects.toThrow('boom');
  });
});

describe('getNearbyLiveMatch', () => {
  it('returns null without querying when there is no match id', async () => {
    const client = { from: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await getNearbyLiveMatch(null)).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('fetches the match by id', async () => {
    const maybeSingle = jest.fn(async () => ({ data: { id: 'm1' }, error: null }));
    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));
    requireSupabase.mockReturnValue({ from });
    const result = await getNearbyLiveMatch('m1');
    expect(from).toHaveBeenCalledWith('nearby_live_matches');
    expect(eq).toHaveBeenCalledWith('id', 'm1');
    expect(result).toEqual({ id: 'm1' });
  });

  it('propagates a fetch error', async () => {
    const maybeSingle = jest.fn(async () => ({ data: null, error: new Error('not found') }));
    requireSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) });
    await expect(getNearbyLiveMatch('m1')).rejects.toThrow('not found');
  });
});

describe('updateNearbyLiveMatch', () => {
  it('sends match id, expected revision, state, and status', async () => {
    const rpc = jest.fn(async () => ({ data: { revision: 2 }, error: null }));
    requireSupabase.mockReturnValue({ rpc });
    const result = await updateNearbyLiveMatch('m1', 1, { score: 5 }, 'completed');
    expect(rpc).toHaveBeenCalledWith('update_nearby_live_match', {
      p_match_id: 'm1', p_expected_revision: 1, p_state: { score: 5 }, p_status: 'completed',
    });
    expect(result).toEqual({ revision: 2 });
  });

  it('defaults status to null when not given', async () => {
    const rpc = jest.fn(async () => ({ data: {}, error: null }));
    requireSupabase.mockReturnValue({ rpc });
    await updateNearbyLiveMatch('m1', 1, {});
    expect(rpc.mock.calls[0][1].p_status).toBeNull();
  });

  it('propagates an error', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('stale revision') })) });
    await expect(updateNearbyLiveMatch('m1', 1, {})).rejects.toThrow('stale revision');
  });
});

describe('searchRegisteredPlayers', () => {
  it('does not call supabase for queries shorter than 2 characters', async () => {
    const client = { rpc: jest.fn() };
    requireSupabase.mockReturnValue(client);
    expect(await searchRegisteredPlayers(' a ')).toEqual([]);
    expect(await searchRegisteredPlayers(undefined)).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('searches every registered player by trimmed name and maps rows without distance', async () => {
    const client = { rpc: jest.fn(async () => ({
      data: [
        { id: 'p1', display_name: 'Maria Santos', avatar_url: 'm.png', skill_rating: 3.5, home_area: 'Manila' },
        { id: 'p2', display_name: null, avatar_url: null, skill_rating: null, home_area: null },
      ],
      error: null,
    })) };
    requireSupabase.mockReturnValue(client);
    const result = await searchRegisteredPlayers('  mar ');
    expect(client.rpc).toHaveBeenCalledWith('search_registered_players', { p_query: 'mar' });
    expect(result[0]).toEqual({ id: 'p1', name: 'Maria Santos', avatar: 'm.png', initials: 'MS', rating: 3.5, area: 'Manila', isSearchResult: true, color: '#1C6B66' });
    expect(result[1]).toMatchObject({ name: 'Peakle player', rating: 'Unrated', area: null, isSearchResult: true });
    expect(result[0]).not.toHaveProperty('distanceKm');
  });

  it('propagates RPC errors', async () => {
    requireSupabase.mockReturnValue({ rpc: jest.fn(async () => ({ data: null, error: new Error('missing function') })) });
    await expect(searchRegisteredPlayers('maria')).rejects.toThrow('missing function');
  });
});
